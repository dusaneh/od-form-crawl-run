import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  crawlTargetsWithPlaywright,
  validatePlaywrightTarget,
} from "./playwright-crawler.mjs";
import { analyzeCrawl, openAIConfiguration } from "./openai-analysis.mjs";
import { updateArtifactLineage } from "./artifact-lineage.mjs";
import {
  DEFAULT_TRAVERSAL_SETTINGS,
  normalizeTraversalSettings,
} from "./traversal-settings.mjs";
import { generatedReconScriptFor } from "./recon-scripts/registry.mjs";
import { executeApprovedForm } from "./approved-execution.mjs";
import {
  decideFormApproval,
  listFormRecords,
  readFormRecord,
  registerCrawledForms,
} from "./form-registry.mjs";
import { loadEnvFile } from "./env.mjs";
import { createFormWeaveDatabase } from "./postgres/database.mjs";
import { selectRetainedEvidence } from "./evidence-retention.mjs";
import { buildRunnerJourney } from "./report-runner-journey.mjs";
import { summarizeLlmTelemetry } from "./audit/llm-telemetry.mjs";
import {
  mayExecuteHostedTarget,
} from "../production/access-policy.mjs";

const localDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(localDirectory, "..");

loadEnvFile(path.join(projectRoot, ".env"));

const hosted = process.env.FORMWEAVE_HOSTED === "1";
const postgresUri = process.env.DATABASE_URL || process.env.POSTGRES_URI;
const port = Number.parseInt(process.env.FORMWEAVE_API_PORT || "8787", 10);
const host = process.env.FORMWEAVE_API_HOST || "127.0.0.1";
const filesystemDataRoot = path.resolve(
  projectRoot,
  process.env.FORMWEAVE_DATA_DIR || "data"
);
const requestedStorage = String(process.env.FORMWEAVE_STORAGE || "").toLowerCase();
const postgresEnabled =
  requestedStorage === "postgres" ||
  (!requestedStorage && Boolean(postgresUri));
if (requestedStorage === "postgres" && !postgresUri) {
  throw new Error(
    "FORMWEAVE_STORAGE=postgres requires DATABASE_URL or POSTGRES_URI.",
  );
}
const dataRoot = postgresEnabled
  ? path.resolve(
      projectRoot,
      process.env.FORMWEAVE_CACHE_DIR || ".formweave-cache",
    )
  : filesystemDataRoot;
const runsRoot = path.join(dataRoot, "runs");
const formsRoot = path.join(dataRoot, "forms");
const executionsRoot = path.join(dataRoot, "executions");
const generatedScriptsRoot = path.join(dataRoot, "generated-scripts");
const database = postgresEnabled
  ? await createFormWeaveDatabase(postgresUri)
  : null;

function isLoopbackUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
}

const publicCaptureHosts = new Set([
  "testforms.dbolab.io",
  "common-35f0c1409e9f.herokuapp.com",
]);

function fixtureCaptureEndpoint(rawBaseUrl, action) {
  let baseUrl;
  try {
    baseUrl = new URL(String(rawBaseUrl || ""));
  } catch {
    throw Object.assign(
      new Error("captureBaseUrl must be a valid registered test-site URL."),
      { statusCode: 400 },
    );
  }
  const loopback = isLoopbackUrl(baseUrl.href);
  const registeredPublicHost = publicCaptureHosts.has(
    baseUrl.hostname.toLowerCase(),
  );
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    (!loopback && !registeredPublicHost) ||
    (hosted && loopback) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash ||
    !/^\/site_[a-z0-9_]+\/?$/i.test(baseUrl.pathname)
  ) {
    throw Object.assign(
      new Error(
        "Submission capture is restricted to registered testforms hosts and local /site_* fixtures.",
      ),
      { statusCode: 400 },
    );
  }
  const suffix = {
    latest: "/submissions/latest",
    list: "/submissions",
    clear: "/submissions",
  }[action];
  if (!suffix) {
    throw Object.assign(
      new Error("action must be latest, list, or clear."),
      { statusCode: 400 },
    );
  }
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}${suffix}`;
  return {
    endpoint: baseUrl,
    needsRoutingCookie:
      baseUrl.hostname.toLowerCase() ===
        "common-35f0c1409e9f.herokuapp.com" ||
      (loopback && baseUrl.port === "5000"),
  };
}

async function fixtureRoutingCookie(endpoint) {
  const selector = new URL("/?subdomain=testforms", endpoint.origin);
  const response = await fetch(selector, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/(?:^|,\s*)(_subdomain=[^;,\s]+)/i);
  if (!match) {
    throw new Error("The dispatcher did not return its testforms routing cookie.");
  }
  return match[1];
}

async function proxyFixtureCapture(request) {
  try {
    const payload = await bodyJson(request);
    const action = String(payload.action || "");
    const target = fixtureCaptureEndpoint(payload.captureBaseUrl, action);
    const routingCookie = target.needsRoutingCookie
      ? await fixtureRoutingCookie(target.endpoint)
      : "";
    const response = await fetch(target.endpoint, {
      method: action === "clear" ? "DELETE" : "GET",
      headers: {
        accept: "application/json",
        ...(routingCookie ? { cookie: routingCookie } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: apiHeaders(request, {
        "content-type":
          response.headers.get("content-type") ||
          "application/json; charset=utf-8",
      }),
    });
  } catch (error) {
    return jsonResponse(
      request,
      {
        error: error instanceof Error ? error.message : String(error),
        code:
          Number(error?.statusCode) === 400
            ? "invalid_capture_target"
            : "capture_api_unavailable",
      },
      Number(error?.statusCode) || 502,
    );
  }
}

async function reconScriptResolverForRun(run) {
  void run;
  return generatedReconScriptFor;
}
const logsRoot = path.join(dataRoot, "logs");
const aggregateLogPath = path.join(logsRoot, "crawler.jsonl");
const operationalAuditPath = path.join(logsRoot, "operational-audit.jsonl");
const settingsPath = path.join(dataRoot, "settings.json");
const MAX_CONCURRENT_BROWSER_RUNS = 1;
const runningTasks = new Map();
const runningExecutions = new Map();
const activeBrowserRuns = new Map();
const runActors = new Map();
const executionActors = new Map();

function browserCapacityResponse(request) {
  const active = activeBrowserRuns.values().next().value;
  return jsonResponse(
    request,
    {
      error:
        "Another browser run is already in progress. Wait for it to finish before starting a new run.",
      code: "crawl_capacity_reached",
      limit: MAX_CONCURRENT_BROWSER_RUNS,
      activeRun: active || null,
    },
    429,
  );
}

function reserveBrowserRun(id, kind) {
  if (activeBrowserRuns.size >= MAX_CONCURRENT_BROWSER_RUNS) return false;
  activeBrowserRuns.set(id, { id, kind });
  return true;
}

function releaseBrowserRun(id) {
  activeBrowserRuns.delete(id);
}

await Promise.all([
  mkdir(runsRoot, { recursive: true }),
  mkdir(formsRoot, { recursive: true }),
  mkdir(executionsRoot, { recursive: true }),
  mkdir(logsRoot, { recursive: true }),
  mkdir(generatedScriptsRoot, { recursive: true }),
]);
if (database) {
  await database.materializeScriptRegistry(generatedScriptsRoot);
}

async function readTraversalSettings() {
  if (database) {
    const stored = await database.getSettings();
    if (stored) {
      return {
        ...normalizeTraversalSettings(stored),
        ...(stored.updatedAt ? { updatedAt: stored.updatedAt } : {}),
      };
    }
    const settings = {
      ...DEFAULT_TRAVERSAL_SETTINGS,
      updatedAt: new Date().toISOString(),
    };
    await database.putSettings(settings);
    return settings;
  }
  try {
    const stored = await readJson(settingsPath);
    return {
      ...normalizeTraversalSettings(stored),
      ...(stored.updatedAt ? { updatedAt: stored.updatedAt } : {}),
    };
  } catch {
    const settings = {
      ...DEFAULT_TRAVERSAL_SETTINGS,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(settingsPath, settings);
    return settings;
  }
}

async function writeTraversalSettings(value) {
  const settings = {
    ...normalizeTraversalSettings(value),
    updatedAt: new Date().toISOString(),
  };
  if (database) await database.putSettings(settings);
  else await writeJson(settingsPath, settings);
  return settings;
}

function runDirectory(runId) {
  if (!/^run_[a-z0-9]+$/i.test(runId)) throw new Error("Invalid run id.");
  return path.join(runsRoot, runId);
}

function artifactsFor(runId) {
  const directory = runDirectory(runId);
  return {
    runDirectory: directory,
    report: database
      ? `postgres://run/${encodeURIComponent(runId)}/report`
      : path.join(directory, "report.json"),
    events: database
      ? `postgres://run/${encodeURIComponent(runId)}/events`
      : path.join(directory, "events.jsonl"),
    pagesDirectory: path.join(directory, "pages"),
    evidenceDirectory: path.join(directory, "evidence"),
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonIfAvailable(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function retainedPlanForReport(report) {
  const artifact = report.pages
    .map((page) => page.generatedArtifact)
    .find(
      (candidate) =>
        candidate?.path &&
        ["generated_and_published", "retained_replay"].includes(
          candidate.lifecycle,
        )
  );
  if (!artifact) return null;
  try {
    const artifactPath =
      database && artifact.artifactId && artifact.scriptVersion
        ? path.join(
            generatedScriptsRoot,
            artifact.artifactId,
            `v${artifact.scriptVersion}`,
          )
        : artifact.path;
    const source = await readFile(
      path.join(artifactPath, "generated.mjs"),
      "utf8"
    );
    const encoded = source.match(
      /Buffer\.from\("([A-Za-z0-9_-]+)",\s*"base64url"\)/
    )?.[1];
    if (!encoded) return null;
    return {
      artifact,
      plan: JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    };
  } catch {
    return null;
  }
}

async function evidenceImageFacts(evidence) {
  if (!evidence?.screenshotArtifact) {
    return { sha256: "", byteLength: 0 };
  }
  if (database && String(evidence.screenshotArtifact).startsWith("postgres://")) {
    try {
      const artifactUrl = new URL(evidence.screenshotArtifact);
      const segments = artifactUrl.pathname
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
      const stored = await database.getObject(
        artifactUrl.hostname,
        segments.shift(),
        segments.join("/"),
      );
      return stored
        ? { sha256: stored.sha256, byteLength: stored.byteLength }
        : { sha256: "", byteLength: 0 };
    } catch {
      return { sha256: "", byteLength: 0 };
    }
  }
  try {
    const bytes = await readFile(evidence.screenshotArtifact);
    return {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.byteLength,
    };
  } catch {
    return { sha256: "", byteLength: 0 };
  }
}

function evidenceForProposal(allEvidence, proposalId) {
  if (!proposalId) return null;
  const sourcePrefix = `generated:${proposalId}@`;
  return (
    allEvidence.find((candidate) =>
      (candidate.values || []).some((value) =>
        String(value.source || "").startsWith(sourcePrefix)
      )
    ) || null
  );
}

async function latestGeneratedFormManifest(generatedRoot) {
  const formScriptRoot = path.join(generatedRoot, "form-script");
  const directories = (
    await readdir(formScriptRoot, { withFileTypes: true }).catch(() => [])
  ).filter((entry) => entry.isDirectory());
  const manifests = (
    await Promise.all(
      directories.map((entry) =>
        readJsonIfAvailable(
          path.join(formScriptRoot, entry.name, "manifest.json")
        )
      )
    )
  ).filter(Boolean);
  return (
    manifests.sort(
      (left, right) =>
        Number(right.scriptVersion || 0) - Number(left.scriptVersion || 0) ||
        Number(Boolean(right.submissionAssessmentId)) -
          Number(Boolean(left.submissionAssessmentId))
    )[0] || {}
  );
}

async function retainedArchitectureExchangesFor(report) {
  const retained = await retainedPlanForReport(report);
  if (!retained?.plan?.states?.length) return [];
  const allEvidence = report.pages
    .flatMap((page) => page.stateEvidence || [])
    .sort((left, right) => left.sequence - right.sequence);
  const primaryEvidence = allEvidence.filter((state) =>
    [
      "populated",
      "branch_variant_populated",
      "pre_advance",
      "blocked_final",
    ].includes(state.kind)
  );
  const exchanges = [];

  for (let index = 0; index < retained.plan.states.length; index += 1) {
    const state = retained.plan.states[index];
    const evidence =
      evidenceForProposal(allEvidence, state.proposalId) ||
      primaryEvidence[index];
    const sensingEvidence =
      index === 0
        ? evidence
        : allEvidence
            .filter(
              (candidate) =>
                candidate.sequence < (evidence?.sequence || Number.MAX_SAFE_INTEGER) &&
                candidate.kind === "post_advance"
            )
            .at(-1);
    const resultEvidence = allEvidence.find(
      (candidate) =>
        candidate.sequence === (evidence?.sequence || 0) + 1 &&
        ["post_advance", "submitted"].includes(candidate.kind)
    );
    const imageFacts = await evidenceImageFacts(sensingEvidence || evidence);
    const fields = (state.fields || []).map((field) => ({
      key: field.key,
      label: field.label,
      control: field.controlType,
      required: Boolean(field.required),
      testValue: field.testValue,
      selectors: field.selectors || [],
      actionKind: field.actuate ? "field_actuation" : "not_proposed",
      safetyDisposition: field.actuate
        ? field.safetyAuthority || "accepted_model_action"
        : field.skipReason || "not_proposed",
    }));
    const verifiedKeys = new Set(
      (evidence?.values || []).map((value) => value.fieldKey)
    );
    const terminal = state.progression?.kind === "terminal_submit";
    const submitted = resultEvidence?.kind === "submitted";
    const skippedFields = fields.filter(
      (field) => field.actionKind !== "field_actuation"
    );

    exchanges.push({
      sequence: index + 1,
      stateKey: state.state?.key || `retained_state_${index + 1}`,
      label:
        state.state?.description ||
        evidence?.label ||
        `Retained state ${index + 1}`,
      route: state.state?.route || "",
      status:
        terminal && report.executionMode === "fixture_submit" && !submitted
          ? "failed"
          : "verified",
      decisionTiming: "retained_prior_run",
      sensing: {
        from: "Executor + physics toolbox (current replay)",
        to: "Stored script matcher",
        observedAt: evidence?.capturedAt || "",
        url: evidence?.url || "",
        title: evidence?.title || "",
        heading: state.state?.description || "",
        controlsObserved: fields.length,
        actionsObserved: state.progression ? 1 : 0,
        sectionsObserved: state.sections?.length || 0,
        guidanceObserved: state.guidance?.length || 0,
        accessibilityCharacters: 0,
        priorStates: index,
        existingContractFields: fields.length,
        screenshotSha256: imageFacts.sha256,
        screenshotBytes: imageFacts.byteLength,
        evidence: (sensingEvidence || evidence)?.evidence || "",
      },
      semantics: {
        from: "Semantic layer (original generation run)",
        to: "Retained generated form script",
        proposalId: state.proposalId || "",
        model: state.model || retained.plan.provenance?.[index]?.model || "",
        promptVersion:
          state.promptVersion ||
          retained.plan.provenance?.[index]?.promptVersion ||
          "",
        responseId: retained.plan.provenance?.[index]?.responseId || "",
        durationMs: 0,
        attempts: 0,
        fieldsProposed: fields.length,
        sectionsProposed: state.sections?.length || 0,
        guidanceProposed: state.guidance?.length || 0,
        actionsProposed:
          fields.filter((field) => field.actionKind === "field_actuation").length +
          (state.progression ? 1 : 0),
        progression: state.progression,
        acceptedActions:
          fields.filter((field) => field.actionKind === "field_actuation").length +
          (state.progression ? 1 : 0),
        rejectedActions: skippedFields.map((field) => ({
          code: field.safetyDisposition,
          detail: `${field.label} remained non-actuating in the retained script.`,
          proposalId: state.proposalId || "",
        })),
        safe: true,
      },
      script: {
        from: "Retained generated script",
        to: "Executor role (current replay)",
        artifactId: retained.artifact.artifactId,
        scriptVersion: retained.artifact.scriptVersion,
        sourceHash: retained.plan.provenance?.[index]?.sourceHash || "",
        completeSourceHash: retained.artifact.sourceHash,
        storedPath: retained.artifact.path,
        fields,
        progression: {
          key: state.progression?.key || "",
          kind: state.progression?.kind || "",
          label: state.progression?.label || "",
          selectors: state.progression?.selectors || [],
        },
      },
      execution: {
        from: "Executor + physics toolbox (current replay)",
        to: "Result envelope + evidence UI",
        mode: report.executionMode || "probe",
        fieldsAttempted: fields.filter(
          (field) => field.actionKind === "field_actuation"
        ).length,
        fieldsVerified: verifiedKeys.size,
        fieldsSkipped: Math.max(0, fields.length - verifiedKeys.size),
        fieldFailures: fields.filter(
          (field) =>
            field.required &&
            !verifiedKeys.has(field.key) &&
            field.actionKind === "field_actuation"
        ).length,
        progressionOutcome: terminal
          ? submitted
            ? "terminal_submission_verified"
            : "terminal_boundary_reached"
          : resultEvidence
            ? "state_transition_verified"
            : "transition_evidence_unavailable",
        observedStateIdentity: evidence?.fingerprint || "",
        evidence: [sensingEvidence, evidence, resultEvidence]
          .filter(Boolean)
          .map((item) => ({
            id: item.id,
            kind: item.kind,
            label: item.label,
            url: item.evidence,
            values: item.values?.length || 0,
          })),
      },
    });
  }
  return exchanges;
}

async function architectureExchangesFor(runId, report) {
  const generatedRoot = path.join(runDirectory(runId), "generated");
  if (database) {
    await database.materializeObjects({
      ownerType: "run",
      ownerId: runId,
      destination: generatedRoot,
      keyPrefix: "generated/",
    });
  }
  const semanticRoot = path.join(generatedRoot, "semantic-generation");
  const statePlanRoot = path.join(generatedRoot, "state-plans");
  const semanticDirectories = (await readdir(semanticRoot, { withFileTypes: true }).catch(
    () => []
  ))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^state_\d+(?:_.+_variant)?$/i.test(entry.name)
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  if (semanticDirectories.length === 0) {
    return retainedArchitectureExchangesFor(report);
  }

  const allEvidence = report.pages
    .flatMap((page) => page.stateEvidence || [])
    .sort((left, right) => left.sequence - right.sequence);
  const primaryEvidence = allEvidence.filter((state) =>
    [
      "populated",
      "branch_variant_populated",
      "pre_advance",
      "blocked_final",
    ].includes(state.kind)
  );
  const formManifest = await latestGeneratedFormManifest(generatedRoot);

  const exchanges = [];
  for (let index = 0; index < semanticDirectories.length; index += 1) {
    const directoryName = semanticDirectories[index].name;
    const semanticDirectory = path.join(semanticRoot, directoryName);
    const planDirectory = path.join(statePlanRoot, directoryName);
    const [observation, proposal, provenance, safety, stateManifest] =
      await Promise.all([
        readJsonIfAvailable(path.join(semanticDirectory, "generation-input.json")),
        readJsonIfAvailable(path.join(semanticDirectory, "proposal.json")),
        readJsonIfAvailable(path.join(semanticDirectory, "provenance.json")),
        readJsonIfAvailable(path.join(semanticDirectory, "safety.json")),
        readJsonIfAvailable(path.join(planDirectory, "manifest.json")),
      ]);
    if (!observation || !proposal || !provenance || !safety) continue;

    const evidence =
      evidenceForProposal(allEvidence, proposal.proposalId) ||
      primaryEvidence[index];
    const sensingEvidence =
      observation.runtimeBranchScope
        ? allEvidence
            .filter(
              (candidate) =>
                candidate.sequence < (evidence?.sequence || Number.MAX_SAFE_INTEGER) &&
                candidate.kind === "choice_probe"
            )
            .at(-1)
        : index === 0
        ? evidence
        : allEvidence
            .filter(
              (candidate) =>
                candidate.sequence < (evidence?.sequence || Number.MAX_SAFE_INTEGER) &&
                candidate.kind === "post_advance"
            )
            .at(-1);
    const resultEvidence = allEvidence.find(
      (candidate) =>
        candidate.sequence === (evidence?.sequence || 0) + 1 &&
        ["post_advance", "submitted"].includes(candidate.kind)
    );
    const acceptedById = new Map(
      (safety.acceptedActions || []).map((action) => [
        action.proposalId,
        action,
      ])
    );
    const actionsByTarget = new Map(
      (proposal.proposedActions || []).map((action) => [action.targetKey, action])
    );
    const selectorsByField = new Map(
      (proposal.mechanics?.fieldTargets || []).map((target) => [
        target.fieldKey,
        target.selectors,
      ])
    );
    const fields = (proposal.fields || []).map((field) => {
      const action = actionsByTarget.get(field.key);
      return {
        key: field.key,
        label: field.rawLabel,
        control: field.controlType,
        required: field.required,
        testValue: action?.value ?? field.testValue,
        selectors: selectorsByField.get(field.key) || [],
        actionKind: action?.kind || "not_proposed",
        safetyDisposition: action
          ? acceptedById.has(action.proposalId)
            ? acceptedById.get(action.proposalId).fixtureAuthority
              ? `accepted_fixture_${acceptedById.get(action.proposalId).fixtureAuthority}`
              : "accepted"
            : "rejected"
          : "not_proposed",
      };
    });
    const verifiedKeys = new Set(
      (evidence?.values || []).map((value) => value.fieldKey)
    );
    const terminal = proposal.state?.progression?.kind === "terminal_submit";
    const submitted = resultEvidence?.kind === "submitted";
    const progressionFact = (observation.actions || []).find(
      (action) =>
        action.factId === proposal.mechanics?.progressionTarget?.sourceFactId,
    );
    const branchTrigger = observation.runtimeBranchScope?.trigger || null;

    exchanges.push({
      sequence: index + 1,
      stateKey: proposal.state?.key || stateManifest?.stateKey || directoryName,
      label: proposal.state?.description || observation.heading || observation.title,
      route: proposal.state?.normalizedRoute || observation.normalizedRoute,
      status:
        terminal && !submitted && report.executionMode === "fixture_submit"
          ? "failed"
          : "verified",
      decisionTiming: "generated_this_run",
      condition: branchTrigger
        ? {
            fieldKey: branchTrigger.fieldKey || "",
            value: branchTrigger.value,
          }
        : null,
      sensing: {
        from: "Executor + physics toolbox (run-local role)",
        to: "Semantic layer",
        observedAt: observation.observedAt,
        url: observation.url,
        title: observation.title,
        heading: observation.heading,
        controlsObserved: observation.controls?.length || 0,
        actionsObserved: observation.actions?.length || 0,
        sectionsObserved: observation.sections?.length || 0,
        guidanceObserved: observation.guidance?.length || 0,
        accessibilityCharacters: String(
          observation.accessibilitySnapshot || ""
        ).length,
        priorStates: observation.priorStates?.length || 0,
        existingContractFields: observation.existingContract?.fields?.length || 0,
        screenshotSha256: observation.screenshot?.sha256 || "",
        screenshotBytes: observation.screenshot?.byteLength || 0,
        evidence: sensingEvidence?.evidence || evidence?.evidence || "",
      },
      semantics: {
        from: "Semantic layer",
        to: "D2-shaped contract + generated-script role",
        proposalId: proposal.proposalId,
        model: provenance.model,
        promptVersion: provenance.promptVersion,
        responseId: provenance.responseId,
        durationMs: provenance.durationMs,
        attempts: provenance.attempts,
        fieldsProposed: proposal.fields?.length || 0,
        sectionsProposed: proposal.sections?.length || 0,
        guidanceProposed: proposal.guidance?.length || 0,
        actionsProposed: proposal.proposedActions?.length || 0,
        progression: proposal.state?.progression,
        acceptedActions: safety.acceptedActions?.length || 0,
        rejectedActions: safety.rejections || [],
        safe: safety.safe,
      },
      script: {
        from: "Generated script (run-local role)",
        to: "Executor role",
        artifactId: formManifest.artifactId || report.pages[0]?.reconScriptId || "",
        scriptVersion:
          formManifest.scriptVersion ||
          stateManifest?.scriptVersion ||
          report.pages[0]?.reconScriptVersion ||
          0,
        sourceHash: stateManifest?.sourceHash || "",
        completeSourceHash: formManifest.sourceHash || "",
        storedPath: planDirectory,
        fields,
        progression: {
          key: proposal.state?.progression?.key || "",
          kind: proposal.state?.progression?.kind || "",
          label: progressionFact?.rawText || "",
          selectors: proposal.mechanics?.progressionTarget?.selectors || [],
        },
      },
      execution: {
        from: "Executor + physics toolbox (run-local role)",
        to: "Result envelope + evidence UI",
        mode: report.executionMode || "probe",
        fieldsAttempted: fields.filter(
          (field) => field.actionKind === "field_actuation"
        ).length,
        fieldsVerified: verifiedKeys.size,
        fieldsSkipped: Math.max(0, fields.length - verifiedKeys.size),
        fieldFailures: fields.filter(
          (field) =>
            field.required &&
            !verifiedKeys.has(field.key) &&
            field.actionKind === "field_actuation"
        ).length,
        progressionOutcome: terminal
          ? submitted
            ? "terminal_submission_verified"
            : "terminal_boundary_reached"
          : resultEvidence
            ? "state_transition_verified"
            : "transition_evidence_unavailable",
        observedStateIdentity: evidence?.fingerprint || "",
        evidence: [sensingEvidence, evidence, resultEvidence]
          .filter(Boolean)
          .map((item) => ({
            id: item.id,
            kind: item.kind,
            label: item.label,
            url: item.evidence,
            values: item.values?.length || 0,
          })),
      },
    });
  }
  return exchanges;
}

async function enrichedReportFor(runId) {
  const report = database
    ? await database.getReport(runId)
    : await readJson(artifactsFor(runId).report);
  if (!report) throw new Error("Report not found.");
  const architectureExchanges = await architectureExchangesFor(runId, report);
  const generated = await retainedPlanForReport(report);
  return {
    ...report,
    architectureExchanges,
    runnerJourney: buildRunnerJourney(
      report,
      architectureExchanges,
      generated?.plan || null,
    ),
  };
}

function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) =>
        !/^(?:key|api.?key|openai.?key|token|secret|authorization|base64|image|password|credential)$/i.test(
          key
        )
    )
  );
}

function auditMetadata(value, depth = 0) {
  if (depth > 6) return "[depth-limited]";
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => auditMetadata(item, depth + 1));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/^(?:password|secret|token|authorization|credential|api.?key|value|values|test.?value|data|input.?data|request.?body|payload|base64|image)$/i.test(
            key,
          ),
      )
      .map(([key, nested]) => [key, auditMetadata(nested, depth + 1)]),
  );
}

function actorFromRequest(request) {
  const mechanism = String(
    request.headers.get("x-formweave-auth-mechanism") || "",
  ).toLowerCase();
  const principal = String(
    request.headers.get("x-formweave-auth-principal") || "",
  ).trim();
  const role = String(
    request.headers.get("x-formweave-auth-role") || "",
  ).toLowerCase();
  const scopes = String(
    request.headers.get("x-formweave-auth-scopes") || "",
  )
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (hosted && mechanism === "bearer" && principal) {
    return {
      actorType: "api_token",
      actorId: principal,
      mechanism,
      role,
      scopes,
    };
  }
  if (hosted && ["basic", "session"].includes(mechanism) && principal) {
    return {
      actorType: "user",
      actorId: principal,
      mechanism,
      role,
      scopes,
    };
  }
  return {
    actorType: hosted ? "unknown" : "local",
    actorId: hosted ? null : "local-direct",
    mechanism: hosted ? "missing" : "local",
    role: hosted ? "" : "local",
    scopes: [],
  };
}

function mayExecuteTarget(request, targetUrl) {
  if (!hosted) return true;
  const actor = actorFromRequest(request);
  return mayExecuteHostedTarget(
    {
      mechanism: actor.mechanism,
      principal: actor.actorId,
      role: actor.role,
      scopes: actor.scopes,
    },
    targetUrl,
  );
}

function externalTargetForbidden(request) {
  return jsonResponse(
    request,
    {
      error:
        "Only the designated administrator may crawl or run forms outside https://testforms.dbolab.io.",
      code: "external_target_access_required",
    },
    403,
  );
}

async function appendOperationalAudit(event, eventKey = randomUUID()) {
  const normalized = {
    occurredAt: event.occurredAt || new Date().toISOString(),
    category: event.category || "api",
    severity: event.severity || "info",
    eventType: event.eventType || "unspecified",
    outcome: event.outcome || "observed",
    actorType: event.actorType || "unknown",
    actorId: event.actorId || null,
    scopeType: event.scopeType || null,
    scopeId: event.scopeId || null,
    parentScopeType: event.parentScopeType || null,
    parentScopeId: event.parentScopeId || null,
    message: String(event.message || "").slice(0, 4_000),
    metadata: auditMetadata(safeMetadata(event.metadata)),
  };
  if (database) {
    return database.appendAuditEvent(normalized, eventKey);
  }
  await appendFile(
    operationalAuditPath,
    `${JSON.stringify({ eventKey, ...normalized })}\n`,
    "utf8",
  );
  return eventKey;
}

async function operationalAuditDashboard({
  hours = 24,
  limit = 200,
  category = "",
  severity = "",
  actorId = "",
  loginHours = 24 * 90,
  loginLimit = 100,
} = {}) {
  if (database) {
    return database.auditDashboard({
      hours,
      limit,
      category,
      severity,
      actorId,
      loginHours,
      loginLimit,
    });
  }
  const boundedHours = Math.min(
    24 * 365 * 5,
    Math.max(1, Number(hours) || 24),
  );
  const boundedLimit = Math.min(500, Math.max(1, Number(limit) || 200));
  const boundedLoginHours = Math.min(
    24 * 365 * 5,
    Math.max(1, Number(loginHours) || 24 * 90),
  );
  const boundedLoginLimit = Math.min(
    500,
    Math.max(1, Number(loginLimit) || 100),
  );
  const allowedActorId = String(actorId || "").trim().slice(0, 320);
  const cutoff = Date.now() - boundedHours * 60 * 60 * 1_000;
  const source = await readFile(operationalAuditPath, "utf8").catch(() => "");
  const retainedEvents = source
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .sort(
      (left, right) =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    );
  const windowEvents = retainedEvents.filter(
    (event) => Date.parse(event.occurredAt || "") >= cutoff,
  );
  const all = windowEvents.filter(
    (event) =>
      (!category || event.category === category) &&
      (!severity || event.severity === severity) &&
      (!allowedActorId || event.actorId === allowedActorId),
  );
  const count = (predicate) => all.filter(predicate).length;
  const byCategory = Object.entries(
    all.reduce((output, event) => {
      output[event.category] = (output[event.category] || 0) + 1;
      return output;
    }, {}),
  ).map(([name, value]) => ({ category: name, count: value }));
  const actors = new Map();
  for (const event of all) {
    if (!event.actorId) continue;
    const key = `${event.actorType}:${event.actorId}`;
    const current = actors.get(key) || {
      actorType: event.actorType,
      actorId: event.actorId,
      count: 0,
      lastSeenAt: event.occurredAt,
    };
    current.count += 1;
    actors.set(key, current);
  }
  const llmTelemetry = summarizeLlmTelemetry(
    windowEvents.filter(
      (event) =>
        event.category === "llm" &&
        (!allowedActorId || event.actorId === allowedActorId),
    ),
  );
  const loginCutoff = Date.now() - boundedLoginHours * 60 * 60 * 1_000;
  const loginHistory = retainedEvents
    .filter(
      (event) =>
        Date.parse(event.occurredAt || "") >= loginCutoff &&
        event.category === "authentication" &&
        (!allowedActorId || event.actorId === allowedActorId),
    )
    .slice(0, boundedLoginLimit);
  const availableUsers = [
    ...new Set(
      retainedEvents
        .filter((event) => event.actorType === "user" && event.actorId)
        .map((event) => event.actorId),
    ),
  ]
    .sort()
    .map((userActorId) => ({
      actorId: userActorId,
      displayName: userActorId,
    }));
  return {
    generatedAt: new Date().toISOString(),
    windowHours: boundedHours,
    filters: {
      category: category || null,
      severity: severity || null,
      actorId: allowedActorId || null,
      limit: boundedLimit,
      loginHours: boundedLoginHours,
      loginLimit: boundedLoginLimit,
    },
    summary: {
      total: all.length,
      successes: count((event) => event.severity === "success"),
      warnings: count((event) => event.severity === "warning"),
      failures: count((event) => event.severity === "error"),
      loginSuccesses: count(
        (event) =>
          event.category === "authentication" &&
          event.outcome === "succeeded",
      ),
      loginFailures: count(
        (event) =>
          event.category === "authentication" &&
          ["failed", "locked"].includes(event.outcome),
      ),
      crawlsCompleted: count(
        (event) =>
          event.category === "crawl" && event.outcome === "completed",
      ),
      crawlsFailed: count(
        (event) =>
          event.category === "crawl" && event.severity === "error",
      ),
      executionsCompleted: count(
        (event) =>
          event.category === "execution" && event.outcome === "completed",
      ),
      executionsFailed: count(
        (event) =>
          event.category === "execution" && event.severity === "error",
      ),
    },
    byCategory,
    topActors: [...actors.values()]
      .sort((left, right) => right.count - left.count)
      .slice(0, 12),
    availableUsers,
    loginSummary: {
      successes: loginHistory.filter(
        (event) => event.outcome === "succeeded",
      ).length,
      failures: loginHistory.filter((event) =>
        ["failed", "locked"].includes(event.outcome),
      ).length,
    },
    loginHistory,
    llmTelemetry,
    events: all.slice(0, boundedLimit),
  };
}

const criticalRunAudit = new Map([
  ["run_created", ["info", "started"]],
  ["browser_launched", ["success", "browser_started"]],
  ["semantic_generation_completed", ["success", "model_completed"]],
  ["generated_script_published", ["success", "script_published"]],
  ["crawl_form_ids_assigned", ["success", "forms_registered"]],
  ["fixture_terminal_submission_completed", ["success", "submitted"]],
  ["field_entry_failed", ["warning", "field_failed"]],
  ["semantic_proposal_schema_rejected", ["warning", "repairing"]],
  ["captcha_handoff_required", ["warning", "blocked"]],
  ["generated_script_not_published", ["error", "failed"]],
  ["generated_script_replay_failed", ["error", "failed"]],
  ["browser_page_failed", ["error", "failed"]],
  ["fixture_terminal_submission_unverified", ["error", "failed"]],
  ["crawl_needs_review", ["warning", "needs_review"]],
  ["crawl_disqualified", ["warning", "disqualified"]],
  ["crawl_failed", ["error", "failed"]],
  ["crawl_interrupted", ["error", "failed"]],
  ["crawl_completed", ["success", "completed"]],
  ["operator_request_review", ["info", "needs_review"]],
]);

const llmRunAudit = new Map([
  [
    "semantic_generation_completed",
    ["semantic_state_generation", "completed", "success"],
  ],
  [
    "semantic_generation_failed",
    ["semantic_state_generation", "failed", "error"],
  ],
  [
    "dynamics_assessment_completed",
    ["dynamics_classification", "completed", "success"],
  ],
  [
    "dynamics_assessment_failed",
    ["dynamics_classification", "failed", "error"],
  ],
  [
    "submission_result_assessment_completed",
    ["submission_result_assessment", "completed", "success"],
  ],
  [
    "submission_result_assessment_failed",
    ["submission_result_assessment", "failed", "error"],
  ],
  ["openai_analysis_completed", ["crawl_analysis", "completed", "success"]],
  ["openai_analysis_failed", ["crawl_analysis", "failed", "error"]],
]);

async function auditLlmRunEvent(runId, kind, message, metadata) {
  const disposition = llmRunAudit.get(kind);
  if (!disposition) return;
  const actor = runActors.get(runId) || {
    actorType: "system",
    actorId: null,
  };
  const timedOut =
    disposition[1] === "failed" &&
    /(?:abort|timed?\s*out|timeout)/i.test(
      String(metadata?.error || message || ""),
    );
  const outcome = timedOut ? "timed_out" : disposition[1];
  await appendOperationalAudit({
    category: "llm",
    severity: timedOut ? "error" : disposition[2],
    eventType: `llm.${disposition[0]}.${outcome}`,
    outcome,
    ...actor,
    scopeType: "run",
    scopeId: runId,
    message: timedOut
      ? `${disposition[0].replaceAll("_", " ")} timed out.`
      : message,
    metadata: {
      callType: disposition[0],
      durationMs: Number(metadata?.durationMs) || null,
      model: metadata?.model || null,
      promptVersion: metadata?.promptVersion || null,
      attempts: metadata?.attempts || null,
      sequence: metadata?.sequence || null,
      transitionKind: metadata?.transitionKind || null,
    },
  });
}

async function auditCriticalRunEvent(runId, kind, message, metadata) {
  const disposition = criticalRunAudit.get(kind);
  if (!disposition) return;
  const actor = runActors.get(runId) || {
    actorType: "system",
    actorId: null,
  };
  await appendOperationalAudit({
    category: "crawl",
    severity: disposition[0],
    eventType: `crawl.${kind}`,
    outcome: disposition[1],
    ...actor,
    scopeType: "run",
    scopeId: runId,
    message,
    metadata,
  });
}

async function logEvent(runId, kind, message, metadata = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    runId,
    kind,
    message,
    metadata: safeMetadata(metadata),
  };
  if (database) {
    await database.appendEvent("run", runId, event);
  } else {
    const line = `${JSON.stringify(event)}\n`;
    await mkdir(runDirectory(runId), { recursive: true });
    await Promise.all([
      appendFile(path.join(runDirectory(runId), "events.jsonl"), line, "utf8"),
      appendFile(aggregateLogPath, line, "utf8"),
    ]);
  }
  console.log(
    `[${event.timestamp}] ${runId} ${kind}: ${message}`,
    Object.keys(event.metadata).length ? event.metadata : ""
  );
  await auditCriticalRunEvent(
    runId,
    kind,
    message,
    event.metadata,
  ).catch((error) =>
    console.error(`Could not persist critical crawl audit for ${runId}:`, error),
  );
  await auditLlmRunEvent(runId, kind, message, event.metadata).catch((error) =>
    console.error(`Could not persist LLM telemetry for ${runId}:`, error),
  );
}

function apiHeaders(request, extra = {}) {
  const origin = request.headers.get("origin");
  const allowed =
    !origin ||
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);
  return {
    "access-control-allow-origin": allowed && origin ? origin : "http://localhost:3000",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
  };
}

function jsonResponse(request, value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: apiHeaders(request, {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    }),
  });
}

async function bodyJson(request, maxBytes = 100_000) {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("Request body is too large.");
  return text ? JSON.parse(text) : {};
}

async function listRuns() {
  if (database) return database.listRuns();
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const runs = [];
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^run_[a-z0-9]+$/i.test(entry.name))
      .map(async (entry) => {
        try {
          runs.push(await readJson(path.join(runsRoot, entry.name, "run.json")));
        } catch {
          // An incomplete directory is ignored but remains available for inspection.
        }
      })
  );
  return runs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function initialRun(
  id,
  urls,
  name,
  mode,
  browserMode,
  allowLocalTargets,
  fixtureAuthorities,
  traversalSettings,
  initiatedBy,
  now
) {
  const nodes = urls.map((url, index) => ({
    id: `target_${String(index + 1).padStart(2, "0")}`,
    step: String(index + 1).padStart(2, "0"),
    title: new URL(url).hostname,
    subtitle: "Queued for browser render",
    fingerprint: "pending",
    status: index === 0 ? "active" : "queued",
    fields: 0,
    branches: 0,
    x: 34 + index * 224,
    y: 146,
    evidence: "",
    evidenceAvailable: false,
    sourceUrl: url,
    sensitiveMasks: 0,
    notes: ["The target has been queued for a real local browser render."],
  }));
  return {
    id,
    crawlId: id,
    name,
    targetUrl: urls[0],
    urls,
    status: "running",
    stage: "Queued for local browser crawl",
    progress: 2,
    mode,
    submit: mode === "fixture_submit",
    browserMode,
    allowLocalTargets,
    discoverRelatedPages: false,
    componentAuthorities: fixtureAuthorities,
    fixtureAuthorities,
    traversalSettings,
    nodes,
    edges: [],
    findings: [
      {
        id: `${id}_queued`,
        tone: "info",
        code: "crawl_queued",
        title: "Local crawl queued",
        detail: `${urls.length} target${urls.length === 1 ? "" : "s"} will be rendered and extracted. Control actuation is permitted only when an LLM-generated script is available.`,
        time: "now",
      },
    ],
    contract: [],
    liveTraversal: {
      activeStateId: "working",
      currentLabel: "Preparing the first rendered state",
      states: [],
      currentFields: [],
      flags: [],
      eventsSeen: 0,
    },
    reportAvailable: false,
    analysisStatus: "pending",
    artifacts: artifactsFor(id),
    synthetic: false,
    liveApproved: false,
    initiatedBy,
    createdAt: now,
    updatedAt: now,
  };
}

async function saveRun(run) {
  if (database) await database.putRun(run);
  else await writeJson(path.join(runDirectory(run.id), "run.json"), run);
}

async function updateRun(run, patch) {
  Object.assign(run, patch, { updatedAt: new Date().toISOString() });
  await saveRun(run);
}

function liveFieldFromEvent(metadata, failed = false) {
  return {
    fieldKey: String(metadata.fieldKey || metadata.label || "unknown"),
    label: String(metadata.label || metadata.fieldKey || "Unlabelled field"),
    control: String(metadata.control || "control"),
    source: String(metadata.source || "recon script"),
    status: failed ? "failed" : "verified",
    required: Boolean(metadata.required),
    sensitive: Boolean(metadata.sensitive),
    consent: Boolean(metadata.consent),
    adminAssisted: Boolean(metadata.adminAssisted),
    upload: Boolean(metadata.upload),
    sectionText: String(metadata.sectionText || ""),
    formId: String(metadata.formId || ""),
    classification: metadata.classification || "deterministic",
    rationale: String(metadata.rationale || ""),
    ...(failed ? { error: String(metadata.error || "Field verification failed.") } : {}),
    updatedAt: new Date().toISOString(),
  };
}

async function updateLiveTraversal(run, kind, message, metadata = {}) {
  if (!run.liveTraversal) {
    run.liveTraversal = {
      activeStateId: "working",
      currentLabel: "Examining rendered form state",
      states: [],
      currentFields: [],
      flags: [],
      eventsSeen: 0,
    };
  }
  const live = run.liveTraversal;
  live.eventsSeen += 1;
  if (kind === "recon_script_selected") {
    live.scriptId = String(metadata.id || "");
    live.scriptVersion = Number(metadata.version || 0);
    live.currentLabel = "Recon script selected";
  } else if (kind === "state_wait_completed") {
    live.currentLabel = String(metadata.reason || "Examining stable browser state");
  } else if (kind === "field_entry_completed" || kind === "field_entry_failed") {
    const field = liveFieldFromEvent(metadata, kind === "field_entry_failed");
    const existing = live.currentFields.findIndex(
      (candidate) => candidate.fieldKey === field.fieldKey
    );
    if (existing >= 0) live.currentFields[existing] = field;
    else live.currentFields.push(field);
    live.currentLabel =
      kind === "field_entry_failed"
        ? `Verification failed: ${field.label}`
        : `Verified field: ${field.label}`;
    if (kind === "field_entry_failed") {
      live.flags.push({
        tone: "danger",
        code: "field_verification_failed",
        label: field.label,
        detail: field.error,
      });
    }
  } else if (kind === "state_evidence_captured") {
    const values = Array.isArray(metadata.values) ? metadata.values : [];
    const fields = values.map((value) => ({
      ...liveFieldFromEvent(value, false),
      status: "verified",
    }));
    const failedFields = live.currentFields.filter(
      (field) => field.status === "failed"
    );
    for (const field of failedFields) {
      if (!fields.some((candidate) => candidate.fieldKey === field.fieldKey)) {
        fields.push(field);
      }
    }
    const stateFlags = [...live.flags];
    const hasDanger = stateFlags.some((flag) => flag.tone === "danger");
    const kindLabel = String(metadata.kind || "state");
    const state = {
      id: String(metadata.stateId || `state_${live.states.length + 1}`),
      sequence: Number(metadata.sequence || live.states.length + 1),
      kind: kindLabel,
      label: message.replace(/^Captured [^:]+ evidence:\s*/i, "").replace(/\.$/, ""),
      description:
        kindLabel === "branch"
          ? "A conditional choice was actuated, allowed to settle, and captured."
          : kindLabel === "blocked_final"
            ? "The populated form reached the terminal boundary; submission remained blocked."
            : "The rendered state was examined, populated where declared, verified, and captured.",
      url: String(metadata.url || run.targetUrl),
      fingerprint: String(metadata.fingerprint || ""),
      fieldsVisible: Number(metadata.fieldsVisible || 0),
      valuesCount: values.length,
      status: hasDanger ? "failed" : "verified",
      fields,
      flags: stateFlags,
      capturedAt: new Date().toISOString(),
    };
    const existing = live.states.findIndex((candidate) => candidate.id === state.id);
    if (existing >= 0) live.states[existing] = state;
    else live.states.push(state);
    live.activeStateId = state.id;
    live.currentFields = fields;
    live.flags = [];
    live.currentLabel = `State ${state.sequence} verified`;
  } else if (
    kind === "captcha_handoff_required" ||
    kind === "automation_action_failed"
  ) {
    live.flags.push({
      tone: "danger",
      code: kind,
      label:
        kind === "captcha_handoff_required"
          ? "Human verification blocked traversal"
          : "Automatic action failed",
      detail: message,
    });
    live.currentLabel = message;
  } else if (kind === "automation_action_completed") {
    live.flags.push({
      tone: "neutral",
      code: String(metadata.category || "automatic_action"),
      label: String(metadata.label || "Predictable obstacle traversed"),
      detail: String(metadata.strategy || ""),
    });
    live.currentLabel = message;
  }
  live.states = live.states.slice(-30);
  live.currentFields = live.currentFields.slice(-250);
  live.flags = live.flags.slice(-20);
  await updateRun(run, { liveTraversal: live });
}

function extensionFor(contentType) {
  if (/jpe?g/i.test(contentType || "")) return ".jpg";
  if (/webp/i.test(contentType || "")) return ".webp";
  return ".png";
}

async function persistGeneratedScripts(output) {
  if (!database) return;
  const seen = new Set();
  for (const page of output.pages || []) {
    const artifact = page.generatedArtifact;
    if (
      !artifact?.path ||
      !artifact?.artifactId ||
      !Number.isInteger(Number(artifact.scriptVersion))
    ) {
      continue;
    }
    const key = `${artifact.artifactId}@${artifact.scriptVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await database.importScriptDirectory(artifact.path, {
      artifactId: artifact.artifactId,
      version: Number(artifact.scriptVersion),
    });
  }
}

async function persistRunGeneratedCache(runId) {
  if (!database) return;
  await database.importDirectory({
    ownerType: "run",
    ownerId: runId,
    directory: path.join(runDirectory(runId), "generated"),
    keyPrefix: "generated/",
  });
}

async function executeCrawl(run) {
  const startedAt = run.createdAt;
  const artifacts = artifactsFor(run.id);
  try {
    await logEvent(
      run.id,
      "crawl_started",
      `Rendering ${run.urls.length} public target${run.urls.length === 1 ? "" : "s"} in local Chromium.`,
      { browserMode: run.browserMode, executionMode: run.mode }
    );
    await updateRun(run, {
      progress: 8,
      stage: `Launching ${run.browserMode === "headful" ? "visible" : "headless"} local Chromium`,
    });

    const reconScriptResolver = await reconScriptResolverForRun(run);
    const output = await crawlTargetsWithPlaywright(run.urls, run.id, {
      browserMode: run.browserMode || "headless",
      executionMode: run.mode || "probe",
      fixtureAuthorities: run.fixtureAuthorities || {},
      allowLoopback: Boolean(run.allowLocalTargets),
      enableGeneratedTraversal: Boolean(
        (process.env.OPENAI_KEY || process.env.OPENAI_API_KEY) &&
          process.env.FORMWEAVE_DISABLE_OPENAI !== "1"
      ),
      artifactRunDirectory: artifacts.runDirectory,
      generatedScriptRoot: generatedScriptsRoot,
      traversalSettings: run.traversalSettings,
      reconScriptResolver,
      onProgress: async ({ pages, queued }) => {
        await updateRun(run, {
          progress: Math.min(78, 12 + pages * 6),
          stage: `Rendered ${pages} page${pages === 1 ? "" : "s"} · ${queued} queued`,
        });
        await logEvent(run.id, "crawl_progress", "Browser crawl batch completed.", {
          pages,
          queued,
        });
      },
      onBrowserEvent: async (kind, message, metadata = {}) => {
        await logEvent(run.id, kind, message, metadata);
        await updateLiveTraversal(run, kind, message, metadata);
        if (
          database &&
          /(?:generated_script.*stored|semantic|choice_coverage|dynamics)/i.test(
            kind,
          )
        ) {
          await persistRunGeneratedCache(run.id);
        }
        if (
          database &&
          kind === "generated_script_published" &&
          metadata.id &&
          Number.isInteger(Number(metadata.version))
        ) {
          await database.importScriptDirectory(
            path.join(
              generatedScriptsRoot,
              String(metadata.id),
              `v${Number(metadata.version)}`,
            ),
            {
              artifactId: String(metadata.id),
              version: Number(metadata.version),
            },
          );
        }
      },
    });
    await persistGeneratedScripts(output);
    const fetchedBeforePersistence = output.pages.filter((page) => !page.error);
    const visibleFieldsBeforePersistence = output.contract.filter(
      (field) => !field.hidden
    );
    const qualityFailure =
      fetchedBeforePersistence.length === 0
        ? "All target fetches or rendered-DOM extractions failed."
        : visibleFieldsBeforePersistence.length === 0
          ? "The crawl found zero visible fields belonging to a real form."
          : "";
    if (qualityFailure) {
      const finding = {
        id: `${run.id}_quality_floor`,
        tone: "danger",
        code: "quality_floor",
        title: "No durable artifact produced",
        detail: qualityFailure,
        time: "now",
      };
      await updateRun(run, {
        status: "failed",
        stage: "Artifact quality floor failed",
        progress: 100,
        findings: [...output.findings, finding],
        nodes: output.nodes,
        edges: output.edges,
        contract: output.contract,
        reportAvailable: false,
        analysisStatus: "skipped",
      });
      await logEvent(
        run.id,
        "crawl_failed",
        "The Phase 1 quality floor rejected the capture; no report or evidence artifact was persisted.",
        { failureCode: "quality_floor", detail: qualityFailure }
      );
      return;
    }
    if (!database) {
      await Promise.all([
        mkdir(artifacts.pagesDirectory, { recursive: true }),
        mkdir(artifacts.evidenceDirectory, { recursive: true }),
      ]);
    }
    await updateRun(run, {
      progress: 82,
      stage: database
        ? "Persisting evidence to PostgreSQL"
        : "Persisting local evidence",
    });

    let screenshotsCaptured = 0;
    const reportPages = [];
    for (let index = 0; index < output.pages.length; index += 1) {
      const page = output.pages[index];
      const node = output.nodes[index];
      const pageNumber = String(index + 1).padStart(2, "0");
      let htmlArtifact;
      let screenshotArtifact;
      const retainedStateEvidence = selectRetainedEvidence(
        page.stateEvidence || [],
        {
          halted:
            Boolean(page.error) ||
            Boolean(page.haltReason) ||
            Number(page.entryFailures || 0) > 0 ||
            page.certificationStatus === "could_not_test",
        },
      );
      const hasKeyMomentScreenshot = retainedStateEvidence.some(
        (state) => state.screenshot,
      );
      const retainedEvidenceIds = new Set(
        retainedStateEvidence.map((state) => `${node.id}_${state.id}`),
      );
      for (const candidate of output.nodes) {
        if (
          candidate.id.startsWith(`${node.id}_`) &&
          !retainedEvidenceIds.has(candidate.id)
        ) {
          candidate.evidence = "";
          candidate.evidenceAvailable = false;
        }
      }

      if (page.html) {
        const objectKey = `pages/page_${pageNumber}.html`;
        if (database) {
          htmlArtifact = (
            await database.putObject({
              ownerType: "run",
              ownerId: run.id,
              objectKey,
              bytes: Buffer.from(page.html, "utf8"),
              contentType: "text/html; charset=utf-8",
              metadata: { finalUrl: page.finalUrl },
            })
          ).uri;
        } else {
          htmlArtifact = path.join(
            artifacts.pagesDirectory,
            `page_${pageNumber}.html`,
          );
          await writeFile(htmlArtifact, page.html, "utf8");
        }
        await logEvent(run.id, "html_stored", `Stored rendered HTML for ${page.finalUrl}.`, {
          path: htmlArtifact,
          bytes: page.bytesFetched,
        });
      }
      if (page.screenshot && !hasKeyMomentScreenshot) {
        const evidenceName = `${node.id}${extensionFor(page.screenshotContentType)}`;
        if (database) {
          screenshotArtifact = (
            await database.putObject({
              ownerType: "run",
              ownerId: run.id,
              objectKey: `evidence/${evidenceName}`,
              bytes: page.screenshot,
              contentType: page.screenshotContentType || "image/png",
              metadata: {
                evidenceId: node.id,
                provider: page.screenshotProvider || "unknown",
              },
            })
          ).uri;
        } else {
          screenshotArtifact = path.join(
            artifacts.evidenceDirectory,
            evidenceName,
          );
          await writeFile(screenshotArtifact, page.screenshot);
        }
        screenshotsCaptured += 1;
        node.evidence = `/api/runs/${encodeURIComponent(run.id)}/evidence/${encodeURIComponent(node.id)}`;
        node.evidenceAvailable = true;
        await logEvent(
          run.id,
          "evidence_captured",
          `Stored screenshot evidence for ${page.finalUrl}.`,
          {
            path: screenshotArtifact,
            provider: page.screenshotProvider || "unknown",
          }
        );
      } else {
        node.evidence = "";
        node.evidenceAvailable = false;
      }

      const reportStateEvidence = [];
      node.stateEvidence = [];
      for (const state of retainedStateEvidence) {
        const evidenceId = `${node.id}_${state.id}`;
        const stateArtifact = path.join(
          artifacts.evidenceDirectory,
          `${evidenceId}${extensionFor(state.screenshotContentType)}`
        );
        let storedStateArtifact = stateArtifact;
        if (state.screenshot) {
          if (database) {
            storedStateArtifact = (
              await database.putObject({
                ownerType: "run",
                ownerId: run.id,
                objectKey: `evidence/${evidenceId}${extensionFor(
                  state.screenshotContentType,
                )}`,
                bytes: state.screenshot,
                contentType: state.screenshotContentType || "image/png",
                metadata: {
                  evidenceId,
                  stateId: state.id,
                  kind: state.kind,
                },
              })
            ).uri;
          } else {
            await writeFile(stateArtifact, state.screenshot);
          }
          screenshotsCaptured += 1;
        }
        const {
          screenshot: stateScreenshot,
          sensingScreenshots: stateSensingScreenshots,
          ...serializableState
        } = state;
        void stateScreenshot;
        void stateSensingScreenshots;
        const storedState = {
          ...serializableState,
          evidence: `/api/runs/${encodeURIComponent(run.id)}/evidence/${encodeURIComponent(evidenceId)}`,
          evidenceAvailable: Boolean(state.screenshot),
          screenshotArtifact: state.screenshot
            ? storedStateArtifact
            : undefined,
        };
        reportStateEvidence.push(storedState);
        node.stateEvidence.push(storedState);
        const stateNode = output.nodes.find(
          (candidate) => candidate.id === evidenceId
        );
        if (stateNode) {
          stateNode.evidence = storedState.evidence;
          stateNode.evidenceAvailable = Boolean(state.screenshot);
        }
        await logEvent(
          run.id,
          "state_evidence_stored",
          `Stored ${state.kind.replaceAll("_", " ")} evidence for ${page.finalUrl}.`,
          {
            stateId: state.id,
            evidenceId,
            path: storedStateArtifact,
            values: state.values.length,
          }
        );
      }

      const {
        screenshot,
        sensingScreenshots,
        html,
        stateEvidence,
        ...reportPage
      } = page;
      void screenshot;
      void sensingScreenshots;
      void html;
      void stateEvidence;
      reportPages.push({
        ...reportPage,
        stateEvidence: reportStateEvidence,
        htmlArtifact,
        screenshotArtifact,
      });
    }

    const fetchedPages = output.pages.filter((page) => !page.error);
    const finishedAt = new Date().toISOString();
    const stats = {
      pagesAttempted: output.pages.length,
      pagesFetched: fetchedPages.length,
      formsFound: fetchedPages.reduce((sum, page) => sum + page.forms, 0),
      fieldsFound: output.contract.filter((field) => !field.hidden).length,
      screenshotsCaptured,
      bytesFetched: fetchedPages.reduce((sum, page) => sum + page.bytesFetched, 0),
      automationActions: output.pages.reduce(
        (sum, page) => sum + (page.automationActions?.length || 0),
        0
      ),
      stateExaminations: output.pages.reduce(
        (sum, page) => sum + (page.stateExaminations || 0),
        0
      ),
      blockedWriteRequests: output.pages.reduce(
        (sum, page) => sum + (page.blockedWriteRequests || 0),
        0
      ),
      allowedReadLikeRequests: output.pages.reduce(
        (sum, page) => sum + (page.allowedReadLikeRequests || 0),
        0
      ),
      captchaPages: output.pages.filter((page) => page.captchaDetected).length,
      statesCaptured: reportPages.reduce(
        (sum, page) => sum + (page.stateEvidence?.length || 0),
        0
      ),
      fieldsEntered: output.pages.reduce(
        (sum, page) => sum + (page.fieldsEntered || 0),
        0
      ),
      entryFailures: output.pages.reduce(
        (sum, page) => sum + (page.entryFailures || 0),
        0
      ),
      branchStates: output.pages.reduce(
        (sum, page) => sum + (page.branchStates || 0),
        0
      ),
      submissionsAttempted: output.pages.reduce(
        (sum, page) => sum + (page.submissionsAttempted || 0),
        0
      ),
      submissionsSucceeded: output.pages.reduce(
        (sum, page) => sum + (page.submissionsSucceeded || 0),
        0
      ),
      startedAt,
      finishedAt,
    };
    await updateRun(run, {
      progress: 88,
      stage: "Analyzing crawl with OpenAI",
      nodes: output.nodes,
      edges: output.edges,
      findings: output.findings,
      contract: output.contract,
      stats,
    });
    const analysis = await analyzeCrawl(output.pages, (kind, message, metadata) =>
      logEvent(run.id, kind, message, metadata)
    );

    const analysisFindings = analysis.keyFindings.map((finding, index) => ({
      id: `${run.id}_analysis_${index}`,
      code: "openai_analysis",
      time: "now",
      ...finding,
    }));
    const findings = [...output.findings, ...analysisFindings];
    if (analysis.status === "failed") {
      findings.push({
        id: `${run.id}_analysis_failed`,
        tone: "warning",
        code: "openai_analysis_failed",
        title: "AI enrichment unavailable",
        detail: analysis.error,
        time: "now",
      });
    }

    const report = {
      id: run.id,
      crawlId: run.id,
      generatedAt: finishedAt,
      targets: run.urls,
      stats,
      pages: reportPages,
      contract: output.contract,
      findings,
      browserMode: run.browserMode,
      renderEngine: "playwright-chromium",
      executionMode: run.mode,
      fixtureAuthorities: run.fixtureAuthorities || {},
      discoverRelatedPages: false,
      traversalSettings: run.traversalSettings,
      evidencePolicy: {
        version: 2,
        mode: "key_moments",
        retainedMoments: [
          "pre_action",
          "pre_action_branch",
          "post_action",
          "terminal_result",
          "failure_boundary",
          "observation_fallback",
        ],
        transientModelScreenshotsPersisted: false,
        detail:
          "The report retains transition, terminal, and failure proof. Model-sensing and successful option-probe screenshots are transient.",
      },
      analysis,
      artifacts,
    };
    const lineage = await updateArtifactLineage(report, dataRoot, { database });
    report.lineage = lineage;
    findings.push({
      id: `${run.id}_lineage`,
      tone: lineage.requiresReview ? "warning" : "info",
      code: lineage.requiresReview ? "drift_fingerprint" : "artifact_lineage",
      title:
        lineage.outcome === "structural_change"
          ? `Structural drift created version ${lineage.version}`
          : `Artifact lineage ${lineage.outcome}`,
      detail: `${lineage.normalizedUrl} · version ${lineage.version}`,
      time: "now",
    });
    const formDefinitions = await registerCrawledForms({
      formsRoot,
      run,
      report,
      database,
    });
    await logEvent(
      run.id,
      "crawl_form_ids_assigned",
      `Assigned ${formDefinitions.length} crawl-scoped form id${formDefinitions.length === 1 ? "" : "s"}.`,
      {
        formIds: formDefinitions.map((definition) => definition.formId),
      },
    );
    if (database) await database.putReport(run.id, report);
    else await writeJson(artifacts.report, report);
    const allFailed = fetchedPages.length === 0;
    const disqualified = output.pages.some(
      (page) =>
        page.captchaDetected ||
        /captcha|login|credential/i.test(page.unresolvedGate || "") ||
        /captcha|login|credential/i.test(page.haltReason || ""),
    );
    const submissionNeedsReview = output.pages.some(
      (page) =>
        Number(page.submissionsAttempted || 0) >
          Number(page.submissionsSucceeded || 0) ||
        (page.submissionResult &&
          page.submissionResult.verified !== true)
    );
    const needsReview = output.pages.some(
      (page) =>
        (!disqualified && page.unresolvedGate) ||
        page.certificationStatus === "could_not_test" ||
        page.certificationStatus === "script_missing"
    ) || submissionNeedsReview;
    const requiresReview =
      needsReview ||
      (lineage.requiresReview && run.mode !== "fixture_submit");
    await updateRun(run, {
      status: allFailed
        ? "failed"
        : disqualified
          ? "disqualified"
        : requiresReview
          ? "awaiting_review"
          : "completed",
      stage: allFailed
        ? "Crawl failed"
        : disqualified
          ? "Form disqualified by CAPTCHA or required login"
        : requiresReview
          ? output.pages.some(
              (page) => page.certificationStatus === "script_missing"
            )
            ? "Observation complete · generated script required"
            : submissionNeedsReview
              ? "Submission outcome requires review"
              : "Scripted traversal needs human review"
          : "Crawl complete",
      progress: 100,
      findings,
      reportAvailable: true,
      analysisStatus: analysis.status,
      formIds: formDefinitions.map((definition) => definition.formId),
    });
    await logEvent(
      run.id,
      allFailed
        ? "crawl_failed"
        : disqualified
          ? "crawl_disqualified"
        : requiresReview
          ? "crawl_needs_review"
          : "crawl_completed",
      allFailed
        ? "Every target failed; the report and logs were retained."
        : `Stored ${stats.fieldsFound} visible fields, ${screenshotsCaptured} screenshots, and the complete report ${database ? "in PostgreSQL" : "locally"}.${disqualified ? " The form is disqualified from approval and execution." : requiresReview ? " The artifact requires review." : ""}`,
      { report: artifacts.report }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The local crawl failed unexpectedly.";
    const finding = {
      id: `${run.id}_local_failed`,
      tone: "danger",
      code: "fetch_failed",
      title: "Local crawl failed",
      detail: message,
      time: "now",
    };
    await updateRun(run, {
      status: "failed",
      stage: "Crawl failed",
      progress: 100,
      findings: [...run.findings, finding],
      analysisStatus: "failed",
    });
    await logEvent(run.id, "crawl_failed", message);
  } finally {
    if (database) {
      await database
        .importDirectory({
          ownerType: "run",
          ownerId: run.id,
          directory: artifacts.runDirectory,
          exclude: new Set(["run.json", "report.json", "events.jsonl"]),
        })
        .catch((error) =>
          console.error(
            `Could not persist run-local generated artifacts for ${run.id}:`,
            error,
          ),
        );
    }
    runningTasks.delete(run.id);
    releaseBrowserRun(run.id);
    runActors.delete(run.id);
  }
}

async function createRun(request) {
  const payload = await bodyJson(request);
  const suppliedUrls = Array.isArray(payload.urls) ? payload.urls : [];
  const rawUrls = suppliedUrls
    .map((url) => String(url).trim())
    .filter(Boolean);
  if (!rawUrls.length) {
    return jsonResponse(
      request,
      {
        error: "Exactly one public starting URL is required.",
        code: "single_target_required",
      },
      400,
    );
  }
  if (rawUrls.length !== 1) {
    return jsonResponse(
      request,
      {
        error:
          "A crawl accepts exactly one starting URL and produces one selected form journey.",
        code: "single_target_required",
      },
      400,
    );
  }
  if (!mayExecuteTarget(request, rawUrls[0])) {
    return externalTargetForbidden(request);
  }
  if (payload.discoverRelatedPages === true) {
    return jsonResponse(
      request,
      {
        error:
          "Related-page discovery is disabled. The LLM may select one observed action from the starting page to reach one resource-access form.",
        code: "related_page_discovery_disabled",
      },
      400,
    );
  }
  let urls;
  const allowLocalTargets =
    !hosted &&
    (payload.allowLocalTargets === true ||
      process.env.FORMWEAVE_ALLOW_LOCAL_TARGETS === "1");
  try {
    urls = [
      ...new Set(
        rawUrls.map((url) =>
          validatePlaywrightTarget(url, {
            allowLoopback: allowLocalTargets,
          })
        )
      ),
    ];
  } catch (error) {
    return jsonResponse(
      request,
      { error: error instanceof Error ? error.message : "A target URL is invalid." },
      400
    );
  }

  const id = `run_${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const now = new Date().toISOString();
  const name =
    String(payload.name || "").trim().slice(0, 120) ||
    `${new URL(urls[0]).hostname.replace(/^www\./, "")} crawl`;
  const browserMode = payload.browserMode === "headful" ? "headful" : "headless";
  if (hosted && browserMode === "headful") {
    return jsonResponse(
      request,
      {
        error:
          "Headful Chromium is available only on a developer workstation. Use headless mode in the hosted service.",
        code: "hosted_headful_unsupported",
      },
      400,
    );
  }
  if (
    payload.mode &&
    !["probe", "dry_run", "fixture_submit"].includes(payload.mode)
  ) {
    return jsonResponse(
      request,
      {
        error:
          "Execution mode must be probe; legacy fixture_submit is the only supported compatibility alias.",
      },
      400
    );
  }
  if (payload.submit !== undefined && typeof payload.submit !== "boolean") {
    return jsonResponse(
      request,
      {
        error: "submit must be a boolean.",
      },
      400,
    );
  }
  if (payload.mode === "fixture_submit" && payload.submit === false) {
    return jsonResponse(
      request,
      {
        error:
          "Conflicting crawl boundary: legacy fixture_submit mode cannot be combined with submit=false.",
      },
      400,
    );
  }
  const submitDuringCrawl =
    payload.submit === true || payload.mode === "fixture_submit";
  const executionMode =
    submitDuringCrawl ? "fixture_submit" : "probe";
  const requestedAuthorities =
    payload.componentAuthorities &&
    typeof payload.componentAuthorities === "object"
      ? payload.componentAuthorities
      : payload.fixtureAuthorities &&
          typeof payload.fixtureAuthorities === "object"
        ? payload.fixtureAuthorities
        : {};
  const fixtureAuthorities = Object.fromEntries(
    [
      "acknowledgement",
      "consent",
      "reviewConfirmation",
      "signature",
      "upload",
    ].map((key) => [
      key,
      requestedAuthorities[key] === true,
    ])
  );
  if (
    executionMode === "fixture_submit" &&
    (!(process.env.OPENAI_KEY || process.env.OPENAI_API_KEY) ||
      process.env.FORMWEAVE_DISABLE_OPENAI === "1")
  ) {
    return jsonResponse(
      request,
      {
        error:
          "Crawl-time submission is disabled because no LLM-generated script can be produced. Configure OPENAI_KEY or OPENAI_API_KEY first.",
        code: "script_missing",
      },
      409
    );
  }
  if (!reserveBrowserRun(id, "crawl")) {
    return browserCapacityResponse(request);
  }
  try {
    const traversalSettings = await readTraversalSettings();
    const initiatedBy = actorFromRequest(request);
    const run = initialRun(
      id,
      urls,
      name,
      executionMode,
      browserMode,
      allowLocalTargets,
      fixtureAuthorities,
      traversalSettings,
      initiatedBy,
      now
    );
    runActors.set(id, initiatedBy);
    await mkdir(runDirectory(id), { recursive: true });
    await saveRun(run);
    await logEvent(
      id,
      "run_created",
      database
        ? "Created a PostgreSQL-backed local crawl."
        : "Created a filesystem-backed local crawl.",
      {
      targets: urls.length,
      browserMode,
      executionMode,
      liveApproved: false,
      allowLocalTargets,
      discoverRelatedPages: false,
      fixtureAuthorities,
      traversalSettingsVersion: traversalSettings.version,
      },
    );
    const task = executeCrawl(run);
    runningTasks.set(id, task);
    return jsonResponse(request, { run }, 201);
  } catch (error) {
    runningTasks.delete(id);
    releaseBrowserRun(id);
    runActors.delete(id);
    throw error;
  }
}

async function serveFile(request, filePath, contentType, downloadName) {
  try {
    const body = await readFile(filePath);
    const disposition = downloadName
      ? `attachment; filename="${downloadName.replaceAll('"', "")}"`
      : "inline";
    return new Response(body, {
      headers: apiHeaders(request, {
        "content-type": contentType,
        "content-disposition": disposition,
      }),
    });
  } catch {
    return jsonResponse(request, { error: "Artifact is unavailable." }, 404);
  }
}

function serveBytes(request, body, contentType, downloadName) {
  const disposition = downloadName
    ? `attachment; filename="${downloadName.replaceAll('"', "")}"`
    : "inline";
  return new Response(body, {
    headers: apiHeaders(request, {
      "content-type": contentType,
      "content-disposition": disposition,
    }),
  });
}

function executionDirectory(executionId) {
  if (!/^exec_[a-z0-9]+$/i.test(String(executionId || ""))) {
    throw new Error("Invalid execution id.");
  }
  return path.join(executionsRoot, executionId);
}

async function readExecution(executionId) {
  if (database) {
    const record = await database.getExecution(executionId);
    if (!record) throw new Error("Execution not found.");
    return record;
  }
  return readJson(path.join(executionDirectory(executionId), "execution.json"));
}

async function writeExecution(record) {
  if (database) await database.putExecution(record);
  else {
    await writeJson(
      path.join(executionDirectory(record.executionId), "execution.json"),
      record,
    );
  }
}

async function logExecutionEvent(executionId, kind, message, metadata = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    executionId,
    kind,
    message,
    metadata: safeMetadata(metadata),
  };
  if (database) {
    await database.appendEvent("execution", executionId, event);
  } else {
    await appendFile(
      path.join(executionDirectory(executionId), "events.jsonl"),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );
  }
  const actor = executionActors.get(executionId) || {
    actorType: "system",
    actorId: null,
  };
  const final = kind === "approved_execution_completed";
  const failed =
    kind === "approved_execution_failed" ||
    kind === "field_entry_failed" ||
    kind === "approved_write_blocked" ||
    (final && event.metadata.status === "failed");
  const important =
    final ||
    failed ||
    [
      "approved_execution_created",
      "approved_execution_browser_started",
      "fixture_terminal_submission_completed",
      "fixture_terminal_submission_unverified",
    ].includes(kind);
  if (important) {
    await appendOperationalAudit({
      category: "execution",
      severity: failed
        ? final || kind === "approved_execution_failed"
          ? "error"
          : "warning"
        : final || kind.includes("completed")
          ? "success"
          : "info",
      eventType: `execution.${kind}`,
      outcome: final
        ? event.metadata.status === "completed"
          ? "completed"
          : "failed"
        : failed
          ? "failed"
          : kind === "approved_execution_created"
            ? "started"
            : "observed",
      ...actor,
      scopeType: "execution",
      scopeId: executionId,
      parentScopeType: event.metadata.formId ? "form" : null,
      parentScopeId: event.metadata.formId || null,
      message,
      metadata: event.metadata,
    }).catch((error) =>
      console.error(
        `Could not persist critical execution audit for ${executionId}:`,
        error,
      ),
    );
  }
}

async function executeApprovedRun(record, form, inputData) {
  try {
    const result = await executeApprovedForm({
      targetUrl: form.targetUrl,
      scriptPath: database
        ? path.join(
            generatedScriptsRoot,
            form.script.artifactId,
            `v${form.script.scriptVersion}`,
          )
        : form.script.path,
      inputData,
      submit: record.submit,
      browserMode: record.browserMode,
      traversalSettings: form.traversalSettings,
      onEvent: (kind, message, metadata) =>
        logExecutionEvent(record.executionId, kind, message, metadata),
    });
    Object.assign(record, {
      status: result.status,
      outcome: result.outcome,
      failureCode: result.failureCode,
      detail: result.detail,
      issues: result.issues,
      fieldsAttempted: result.fieldsAttempted,
      fieldsVerified: result.fieldsVerified,
      fieldsFailed: result.fieldsFailed,
      submitted: result.submitted,
      submissionResult: result.submissionResult,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await writeExecution(record);
    await logExecutionEvent(
      record.executionId,
      "approved_execution_completed",
      result.status === "completed"
        ? "Approved execution completed."
        : "Approved execution reached a failed terminal outcome.",
      {
        formId: record.formId,
        status: result.status,
        outcome: result.outcome,
        failureCode: result.failureCode,
        fieldsAttempted: result.fieldsAttempted,
        fieldsVerified: result.fieldsVerified,
        fieldsFailed: result.fieldsFailed,
        submitted: result.submitted,
        submissionVerified: result.submissionResult?.verified === true,
      },
    );
  } catch (error) {
    Object.assign(record, {
      status: "failed",
      outcome: "execution_error",
      failureCode: "execution_error",
      detail: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await writeExecution(record);
    await logExecutionEvent(
      record.executionId,
      "approved_execution_failed",
      "Approved execution failed before completion.",
      { error: record.detail },
    );
  } finally {
    runningExecutions.delete(record.executionId);
    releaseBrowserRun(record.executionId);
    executionActors.delete(record.executionId);
  }
}

async function createApprovedRun(request, formId) {
  let form;
  try {
    form = await readFormRecord(formsRoot, formId, database);
  } catch {
    return jsonResponse(request, { error: "Form not found." }, 404);
  }
  if (!mayExecuteTarget(request, form.targetUrl)) {
    return externalTargetForbidden(request);
  }
  if (
    form.status !== "approved" ||
    form.approval?.decision !== "approved"
  ) {
    return jsonResponse(
      request,
      {
        error: "The exact crawl-scoped form id has not been approved.",
        code: "form_not_approved",
      },
      409,
    );
  }
  if (
    form.approval.pinnedScript.sourceHash !== form.script.sourceHash ||
    form.approval.pinnedScript.scriptVersion !== form.script.scriptVersion
  ) {
    return jsonResponse(
      request,
      {
        error: "Approval does not match the form's immutable script version.",
        code: "approval_version_mismatch",
      },
      409,
    );
  }
  const payload = await bodyJson(request, 8_000_000);
  if (!payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
    return jsonResponse(
      request,
      { error: "data is required and must be an object." },
      400,
    );
  }
  if (typeof payload.submit !== "boolean") {
    return jsonResponse(
      request,
      { error: "submit is required and must be true or false." },
      400,
    );
  }
  if (hosted && payload.browserMode === "headful") {
    return jsonResponse(
      request,
      {
        error:
          "Headful Chromium is available only on a developer workstation. Use headless mode in the hosted service.",
        code: "hosted_headful_unsupported",
      },
      400,
    );
  }
  const executionId = `exec_${randomUUID().replaceAll("-", "")}`;
  if (!reserveBrowserRun(executionId, "approved_execution")) {
    return browserCapacityResponse(request);
  }
  const now = new Date().toISOString();
  const initiatedBy = actorFromRequest(request);
  const record = {
    schemaVersion: 1,
    executionId,
    formId,
    approvalId: form.approval.approvalId,
    status: "running",
    outcome: "pending",
    mode: payload.submit ? "approved_live" : "dry_run",
    submit: payload.submit,
    browserMode: payload.browserMode === "headful" ? "headful" : "headless",
    targetUrl: form.targetUrl,
    script: {
      artifactId: form.script.artifactId,
      scriptVersion: form.script.scriptVersion,
      sourceHash: form.script.sourceHash,
    },
    inputFieldKeys: Object.keys(payload.data).sort(),
    sensitiveInputPersisted: false,
    fieldsAttempted: 0,
    fieldsVerified: 0,
    fieldsFailed: 0,
    submitted: false,
    submissionResult: null,
    issues: [],
    failureCode: null,
    detail: "Approved execution queued.",
    initiatedBy,
    createdAt: now,
    updatedAt: now,
  };
  try {
    if (!database) {
      await mkdir(executionDirectory(executionId), { recursive: false });
    }
    executionActors.set(executionId, initiatedBy);
    await writeExecution(record);
    await logExecutionEvent(
      executionId,
      "approved_execution_created",
      "Created an approved execution without persisting input values.",
      {
        formId,
        approvalId: form.approval.approvalId,
        submit: payload.submit,
        inputFieldKeys: record.inputFieldKeys,
      },
    );
    const task = executeApprovedRun(record, form, payload.data);
    runningExecutions.set(executionId, task);
    return jsonResponse(request, { execution: record }, 201);
  } catch (error) {
    runningExecutions.delete(executionId);
    releaseBrowserRun(executionId);
    executionActors.delete(executionId);
    throw error;
  }
}

async function route(request) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: apiHeaders(request) });
  }
  if (url.pathname === "/api/health" && request.method === "GET") {
    const openai = openAIConfiguration();
    const postgres = database ? await database.ping() : null;
    return jsonResponse(request, {
      status: "online",
      runtime: database ? "postgresql" : "local-filesystem",
      ...(!database ? { storageRoot: dataRoot } : {}),
      storage: database
        ? {
            engine: "postgresql",
            database: postgres.database,
            role: postgres.role,
            connected: postgres.connected,
          }
        : {
            engine: "filesystem",
            root: dataRoot,
          },
      openai: {
        configured: openai.configured,
        keySource: openai.keySource,
        model: openai.model,
      },
      browser: {
        engine: "playwright-chromium",
        modes: hosted ? ["headless"] : ["headless", "headful"],
      },
      hosted,
      generationMode:
        process.env.FORMWEAVE_FORCE_FRESH_GENERATION === "1"
          ? "forced_fresh"
          : "reuse_or_generate",
      traversalSettingsVersion: DEFAULT_TRAVERSAL_SETTINGS.version,
      activeCrawls: runningTasks.size,
      activeExecutions: runningExecutions.size,
      activeBrowserRuns: activeBrowserRuns.size,
      browserRunLimit: MAX_CONCURRENT_BROWSER_RUNS,
    });
  }
  if (url.pathname === "/api/ops/audit" && request.method === "GET") {
    const actor = actorFromRequest(request);
    if (actor.actorType !== "user" || actor.role !== "admin") {
      return jsonResponse(
        request,
        {
          error: "Administrator access is required to view audit data.",
          code: "admin_required",
        },
        403,
      );
    }
    return jsonResponse(request, {
      audit: await operationalAuditDashboard({
        hours: url.searchParams.get("hours"),
        limit: url.searchParams.get("limit"),
        category: url.searchParams.get("category") || "",
        severity: url.searchParams.get("severity") || "",
        actorId: url.searchParams.get("actorId") || "",
        loginHours: url.searchParams.get("loginHours"),
        loginLimit: url.searchParams.get("loginLimit"),
      }),
    });
  }
  if (url.pathname === "/api/settings" && request.method === "GET") {
    return jsonResponse(request, {
      settings: await readTraversalSettings(),
      settingsPath: database ? "postgres://settings/traversal" : settingsPath,
    });
  }
  if (url.pathname === "/api/settings" && request.method === "PUT") {
    const payload = await bodyJson(request);
    return jsonResponse(request, {
      settings: await writeTraversalSettings(payload.settings || payload),
      settingsPath: database ? "postgres://settings/traversal" : settingsPath,
    });
  }
  if (
    url.pathname === "/api/fixture-submissions" &&
    request.method === "POST"
  ) {
    return proxyFixtureCapture(request);
  }
  if (url.pathname === "/api/runs" && request.method === "GET") {
    return jsonResponse(request, { runs: await listRuns() });
  }
  if (url.pathname === "/api/runs" && request.method === "POST") {
    return createRun(request);
  }
  if (url.pathname === "/api/forms" && request.method === "GET") {
    return jsonResponse(request, {
      forms: await listFormRecords(formsRoot, database),
    });
  }

  const formMatch = url.pathname.match(/^\/api\/forms\/([^/]+)$/);
  if (formMatch && request.method === "GET") {
    try {
      return jsonResponse(request, {
        form: await readFormRecord(
          formsRoot,
          decodeURIComponent(formMatch[1]),
          database,
        ),
      });
    } catch {
      return jsonResponse(request, { error: "Form not found." }, 404);
    }
  }

  const approvalMatch = url.pathname.match(
    /^\/api\/forms\/([^/]+)\/approval$/,
  );
  if (approvalMatch && request.method === "POST") {
    const formId = decodeURIComponent(approvalMatch[1]);
    const requestActor = actorFromRequest(request);
    try {
      const payload = await bodyJson(request);
      const form = await decideFormApproval({
        formsRoot,
        formId,
        decision: payload.decision,
        actor:
          requestActor.actorType === "local" && payload.actor
            ? payload.actor
            : requestActor.actorId || payload.actor,
        notes: payload.notes,
        database,
      });
      await appendOperationalAudit({
        category: "approval",
        severity:
          form.approval.decision === "approved" ? "success" : "warning",
        eventType: `approval.${form.approval.decision}`,
        outcome: form.approval.decision,
        ...requestActor,
        scopeType: "form",
        scopeId: formId,
        parentScopeType: form.sourceRunId ? "run" : null,
        parentScopeId: form.sourceRunId || null,
        message:
          form.approval.decision === "approved"
            ? "Crawl-scoped form was approved for execution."
            : "Crawl-scoped form was rejected.",
        metadata: {
          approvalId: form.approval.approvalId,
          artifactId: form.approval.pinnedScript.artifactId,
          scriptVersion: form.approval.pinnedScript.scriptVersion,
        },
      }).catch((error) =>
        console.error(`Could not persist approval audit for ${formId}:`, error),
      );
      return jsonResponse(request, { form, approval: form.approval });
    } catch (error) {
      await appendOperationalAudit({
        category: "approval",
        severity: "warning",
        eventType: "approval.failed",
        outcome: "failed",
        ...requestActor,
        scopeType: "form",
        scopeId: formId,
        message: "Form approval request failed.",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => {});
      return jsonResponse(
        request,
        { error: error instanceof Error ? error.message : String(error) },
        error?.statusCode || 404,
      );
    }
  }

  const approvedRunMatch = url.pathname.match(
    /^\/api\/forms\/([^/]+)\/runs$/,
  );
  if (approvedRunMatch && request.method === "POST") {
    return createApprovedRun(
      request,
      decodeURIComponent(approvedRunMatch[1]),
    );
  }

  const executionMatch = url.pathname.match(/^\/api\/executions\/([^/]+)$/);
  if (executionMatch && request.method === "GET") {
    try {
      return jsonResponse(request, {
        execution: await readExecution(
          decodeURIComponent(executionMatch[1]),
        ),
      });
    } catch {
      return jsonResponse(request, { error: "Execution not found." }, 404);
    }
  }

  const evidenceMatch = url.pathname.match(
    /^\/api\/runs\/([^/]+)\/evidence\/([^/]+)$/
  );
  if (evidenceMatch && request.method === "GET") {
    const runId = decodeURIComponent(evidenceMatch[1]);
    const nodeId = decodeURIComponent(evidenceMatch[2]);
    if (!/^page_\d+(?:_[a-z0-9]+)*$/i.test(nodeId)) {
      return jsonResponse(request, { error: "Invalid evidence id." }, 400);
    }
    if (database) {
      const stored = await database.findObject(
        "run",
        runId,
        `evidence/${nodeId}.`,
      );
      if (!stored) {
        return jsonResponse(request, { error: "Evidence is unavailable." }, 404);
      }
      return serveBytes(request, stored.bytes, stored.contentType);
    }
    const directory = artifactsFor(runId).evidenceDirectory;
    const entries = await readdir(directory).catch(() => []);
    const name = entries.find((entry) => entry.startsWith(`${nodeId}.`));
    if (!name) return jsonResponse(request, { error: "Evidence is unavailable." }, 404);
    const extension = path.extname(name).toLowerCase();
    const contentType =
      extension === ".jpg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
    return serveFile(request, path.join(directory, name), contentType);
  }

  const reportMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/report$/);
  if (reportMatch && request.method === "GET") {
    const runId = decodeURIComponent(reportMatch[1]);
    try {
      const report = await enrichedReportFor(runId);
      return jsonResponse(
        request,
        report,
        200,
        url.searchParams.get("download") === "1"
          ? {
              "content-disposition": `attachment; filename="formweave-${runId}-report.json"`,
            }
          : {}
      );
    } catch {
      return jsonResponse(request, { error: "Artifact is unavailable." }, 404);
    }
  }

  const logsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/logs$/);
  if (logsMatch && request.method === "GET") {
    const runId = decodeURIComponent(logsMatch[1]);
    if (database) {
      const events = await database.listEvents("run", runId);
      if (!(await database.getRun(runId))) {
        return jsonResponse(request, { error: "Run not found." }, 404);
      }
      const body =
        events.map((event) => JSON.stringify(event)).join("\n") +
        (events.length ? "\n" : "");
      return serveBytes(
        request,
        body,
        "application/x-ndjson; charset=utf-8",
        url.searchParams.get("download") === "1"
          ? `formweave-${runId}-events.jsonl`
          : undefined,
      );
    }
    return serveFile(
      request,
      artifactsFor(runId).events,
      "application/x-ndjson; charset=utf-8",
      url.searchParams.get("download") === "1"
        ? `formweave-${runId}-events.jsonl`
        : undefined
    );
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && request.method === "GET") {
    const runId = decodeURIComponent(runMatch[1]);
    try {
      const storedRun = database
        ? await database.getRun(runId)
        : await readJson(path.join(runDirectory(runId), "run.json"));
      if (!storedRun) throw new Error("Run not found.");
      return jsonResponse(request, {
        run: storedRun,
      });
    } catch {
      return jsonResponse(request, { error: "Run not found." }, 404);
    }
  }
  if (runMatch && request.method === "PATCH") {
    const runId = decodeURIComponent(runMatch[1]);
    try {
      const run = database
        ? await database.getRun(runId)
        : await readJson(path.join(runDirectory(runId), "run.json"));
      if (!run) throw new Error("Run not found.");
      const payload = await bodyJson(request);
      if (payload.action !== "request_review") {
        return jsonResponse(request, { error: "Unsupported run action." }, 400);
      }
      await updateRun(run, {
        status: "awaiting_review",
        stage: "Human review requested",
      });
      runActors.set(runId, actorFromRequest(request));
      await logEvent(runId, "operator_request_review", "Run sent to human review.");
      runActors.delete(runId);
      return jsonResponse(request, { run });
    } catch {
      return jsonResponse(request, { error: "Run not found." }, 404);
    }
  }

  return jsonResponse(request, { error: "Local API route not found." }, 404);
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const request = new Request(`http://${incoming.headers.host}${incoming.url}`, {
      method: incoming.method,
      headers: incoming.headers,
      body:
        incoming.method === "GET" || incoming.method === "HEAD"
          ? undefined
          : await new Response(incoming).arrayBuffer(),
    });
    const response = await route(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      for await (const chunk of response.body) outgoing.write(chunk);
    }
    outgoing.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local API error.";
    const response = jsonResponse(
      new Request(`http://${incoming.headers.host || `${host}:${port}`}/`),
      { error: message },
      500
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(await response.text());
  }
});

async function reconcileInterruptedRuns() {
  const runs = await listRuns();
  const interrupted = runs.filter((run) => run.status === "running");
  for (const run of interrupted) {
    runActors.set(run.id, run.initiatedBy || {
      actorType: "system",
      actorId: null,
    });
    const finding = {
      id: `${run.id}_interrupted`,
      tone: "danger",
      code: "crawl_interrupted",
      title: "Crawl interrupted by local service restart",
      detail:
        "The local API stopped before this crawl completed. Existing artifacts and logs were preserved; start a new crawl to retry.",
      time: "now",
    };
    await updateRun(run, {
      status: "failed",
      stage: "Interrupted by local service restart",
      progress: 100,
      findings: [...(run.findings || []), finding],
      analysisStatus: "failed",
    });
    await logEvent(
      run.id,
      "crawl_interrupted",
      "Marked an unfinished crawl as interrupted during local API startup."
    );
    runActors.delete(run.id);
  }
  return interrupted.length;
}

const reconciledRuns = await reconcileInterruptedRuns();

server.listen(port, host, () => {
  const openai = openAIConfiguration();
  console.log(`FormWeave local API: http://${host}:${port}`);
  console.log(`Local artifacts: ${dataRoot}`);
  console.log(
    `Browser renderer: local Playwright Chromium · ${
      hosted ? "headless only (hosted mode)" : "headless + headful"
    }`,
  );
  console.log(
    `OpenAI analysis: ${openai.configured ? `configured via ${openai.keySource}` : "not configured"} · ${openai.model}`
  );
  if (reconciledRuns) {
    console.log(
      `Recovered startup state: ${reconciledRuns} interrupted crawl${reconciledRuns === 1 ? "" : "s"} marked failed.`
    );
  }
});
