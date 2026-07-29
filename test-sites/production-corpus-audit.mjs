import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

const projectRoot = path.resolve(import.meta.dirname, "..");
const oracleRoot = path.join(projectRoot, "localhost-test-sites");
const dataRoot = path.join(projectRoot, "data", "production-corpus-audit");
const apiOrigin = process.env.FORMWEAVE_API_ORIGIN || "http://127.0.0.1:8787";
const fixtureOrigin =
  process.env.FORMWEAVE_FIXTURE_ORIGIN || "http://localhost:9001";
const timeoutMs = Math.max(
  60_000,
  Number.parseInt(process.env.FORMWEAVE_CORPUS_RUN_TIMEOUT_MS || "600000", 10),
);
const requestedSites = process.argv
  .slice(2)
  .filter((item) => item.startsWith("site_"));

function normalized(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fieldAliases(value) {
  const key = normalized(value).replaceAll(" ", "_");
  const aliases = new Set([key]);
  if (key === "zip_code") aliases.add("postal_code");
  if (key === "postal_code") aliases.add("zip_code");
  if (key === "dob") aliases.add("date_of_birth");
  if (key === "date_of_birth") aliases.add("dob");
  if (key === "is_veteran") aliases.add("veteran_status");
  if (key === "veteran_status") aliases.add("is_veteran");
  return aliases;
}

function reportFieldMatch(expected, fields) {
  const exactNames = fieldAliases(expected.name);
  const canonical = fieldAliases(expected.expected_canonical_key);
  const label = normalized(expected.label);
  return fields.find((field) => {
    const observedKeys = new Set([
      ...fieldAliases(field.name),
      ...fieldAliases(field.id),
      ...fieldAliases(field.key),
      ...fieldAliases(field.canonicalProfileKey),
    ]);
    return (
      [...exactNames, ...canonical].some((key) => key && observedKeys.has(key)) ||
      (label && normalized(field.label) === label)
    );
  });
}

function markdownCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

async function jsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function resolveLiveTarget(siteId) {
  const candidates = [
    `${fixtureOrigin}/${siteId}/`,
    `${fixtureOrigin}/${siteId}/intake`,
  ];
  for (const candidate of candidates) {
    const response = await fetch(candidate, {
      method: "GET",
      redirect: "manual",
    }).catch(() => null);
    if (response && response.status >= 200 && response.status < 400) {
      return candidate;
    }
  }
  throw new Error(
    `Neither the root nor intake URL returned a readable response for ${siteId}.`,
  );
}

async function launch(siteId) {
  const targetUrl = await resolveLiveTarget(siteId);
  const response = await fetch(`${apiOrigin}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      urls: [targetUrl],
      mode: "fixture_submit",
      browserMode: "headless",
      allowLocalTargets: true,
      discoverRelatedPages: false,
      fixtureAuthorities: {
        acknowledgement: true,
        consent: true,
        reviewConfirmation: true,
        signature: true,
        upload: true,
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.run?.id) {
    throw new Error(payload.error || `Run launch returned HTTP ${response.status}.`);
  }
  return { runId: payload.run.id, targetUrl };
}

async function waitForRun(runId) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiOrigin}/api/runs`);
    const payload = await response.json();
    const run = payload.runs?.find((item) => item.id === runId);
    if (
      run &&
      ["completed", "awaiting_review", "failed"].includes(run.status)
    ) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Run ${runId} did not finish within ${timeoutMs} ms.`);
}

async function evidenceInventory(runId) {
  const directory = path.join(projectRoot, "data", "runs", runId, "evidence");
  try {
    const entries = await readdir(directory);
    return Promise.all(
      entries
        .filter((entry) => entry.toLowerCase().endsWith(".png"))
        .sort()
        .map(async (entry) => ({
          name: entry,
          bytes: (await stat(path.join(directory, entry))).size,
        })),
    );
  } catch {
    return [];
  }
}

function abortObserved(expectedAbort, report, events) {
  if (!expectedAbort) return null;
  const eventKinds = new Set(events.map((event) => event.kind));
  const pages = report?.pages || [];
  const certifications = new Set(
    pages.map((page) => page.certificationStatus).filter(Boolean),
  );
  const unresolved = new Set(
    pages.map((page) => page.unresolvedGate).filter(Boolean),
  );
  if (expectedAbort === "branching") {
    return (
      Number(report?.stats?.branchStates || 0) > 0 ||
      eventKinds.has("branching_logic_detected") ||
      certifications.has("branching_logic_detected")
    );
  }
  if (/captcha/i.test(String(expectedAbort))) {
    return (
      Number(report?.stats?.captchaPages || 0) > 0 ||
      eventKinds.has("captcha_detected") ||
      unresolved.has("captcha")
    );
  }
  if (/login/i.test(String(expectedAbort))) {
    return (
      unresolved.has("login") ||
      eventKinds.has("login_required") ||
      pages.some((page) =>
        (page.fields || []).some((field) => field.control === "password"),
      )
    );
  }
  if (/payment/i.test(String(expectedAbort))) {
    return pages.some((page) =>
      (page.fields || []).some((field) =>
        /card|cvv|payment|routing|bank/i.test(
          `${field.name} ${field.label} ${field.key}`,
        ),
      ),
    );
  }
  return (
    Number(report?.stats?.submissionsAttempted || 0) === 0 &&
    pages.some((page) => page.certificationStatus !== "fixture_submitted")
  );
}

async function scoreAfterRun(siteId, runId, targetUrl, terminalRun) {
  // Oracle access intentionally begins only after waitForRun returned a terminal
  // production status. Nothing read below is sent back to the crawl server.
  const truthPath = path.join(oracleRoot, siteId, "ground_truth.yaml");
  const truth = YAML.parse(await readFile(truthPath, "utf8"));
  const runDirectory = path.join(projectRoot, "data", "runs", runId);
  const report = await jsonIfPresent(path.join(runDirectory, "report.json"));
  const retainedRun =
    (await jsonIfPresent(path.join(runDirectory, "run.json"))) || terminalRun;
  const eventText = await readFile(
    path.join(runDirectory, "events.jsonl"),
    "utf8",
  ).catch(() => "");
  const events = eventText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const evidence = await evidenceInventory(runId);
  const observedFields = report?.contract || [];
  const expectedFields = Array.isArray(truth.fields) ? truth.fields : [];
  const fieldRows = expectedFields.map((expected) => {
    const observed = reportFieldMatch(expected, observedFields);
    return {
      expected,
      observed,
      found: Boolean(observed),
      requiredMatch:
        !observed ||
        expected.required === undefined ||
        expected.conditional === true
          ? null
          : Boolean(observed.required) === Boolean(expected.required),
      sensitiveMatch:
        !observed ||
        expected.is_sensitive === undefined ||
        truth.requires_login === true
          ? null
          : Boolean(observed.sensitive) === Boolean(expected.is_sensitive),
    };
  });
  const missing = fieldRows.filter((row) => !row.found);
  const requiredMismatches = fieldRows.filter(
    (row) => row.found && row.requiredMatch === false,
  );
  const sensitiveMismatches = fieldRows.filter(
    (row) => row.found && row.sensitiveMatch === false,
  );
  const findingCodes = new Set([
    ...(report?.findings || []).map((finding) => finding.code),
    ...(retainedRun?.findings || []).map((finding) => finding.code),
    ...events.map((event) => event.kind),
  ]);
  const expectedFlags = Array.isArray(truth.expected_red_flag_codes)
    ? truth.expected_red_flag_codes
    : [];
  const missingFlags = expectedFlags.filter((code) => !findingCodes.has(code));
  const expectedAbort = truth.expected_abort || false;
  const abortMatch = abortObserved(expectedAbort, report, events);
  const expectedSafetyHalt = Boolean(
    expectedAbort ||
      truth.requires_login === true ||
      truth.has_captcha === true ||
      truth.expected_payment_field === true,
  );
  const endToEndSubmissionExpected =
    truth.has_intake_form === true && !expectedSafetyHalt;
  const expectedBranching = truth.expected_branching || {};
  const samePageBranchExpected = expectedBranching.same_page === true;
  const samePageBranchDetected =
    Number(report?.stats?.branchStates || 0) > 0 ||
    events.some((event) => event.kind === "branching_logic_detected");
  const branchDepthExceeded = events.some(
    (event) => event.kind === "same_page_branch_depth_exceeded",
  );
  const branchExecutionMisses = samePageBranchExpected
    ? fieldRows.filter(
        (row) =>
          row.expected.conditional === true &&
          (!row.observed || row.observed.entryStatus !== "entered"),
      )
    : [];
  const submissionsAttempted = Number(report?.stats?.submissionsAttempted || 0);
  const submissionsSucceeded = Number(report?.stats?.submissionsSucceeded || 0);
  const submissionResults = (report?.pages || [])
    .map((page) => page.submissionResult)
    .filter(Boolean);
  const explicitSubmissionConfirmed = submissionResults.some(
    (result) =>
      result.verified === true &&
      result.outcome === "success" &&
      result.criteria?.confidence === "high" &&
      Array.isArray(result.criteria?.markers) &&
      result.criteria.markers.length > 0,
  );
  const modelCalls = events.filter(
    (event) => event.kind === "semantic_generation_started",
  ).length;
  const modelCompletions = events.filter(
    (event) => event.kind === "semantic_generation_completed",
  ).length;
  const modelFailures = events.filter(
    (event) => event.kind === "semantic_generation_failed",
  ).length;
  const entryFailures = Number(report?.stats?.entryFailures || 0);
  const branchStates = Number(report?.stats?.branchStates || 0);
  const coverage =
    expectedFields.length === 0
      ? null
      : (fieldRows.filter((row) => row.found).length / expectedFields.length) *
        100;
  const runFailed = terminalRun.status === "failed";
  const blockingDiscrepancies = [
    ...(expectedAbort && abortMatch !== true
      ? [`Expected abort '${expectedAbort}' was not observed.`]
      : []),
    ...(!expectedAbort && runFailed
      ? [`Production run failed at stage '${terminalRun.stage}'.`]
      : []),
    ...(!expectedAbort &&
    submissionsAttempted > 0 &&
    submissionsSucceeded < submissionsAttempted
      ? [
          `${submissionsAttempted - submissionsSucceeded} terminal submission attempt(s) could not be verified.`,
        ]
      : []),
    ...(expectedAbort && submissionsAttempted > 0
      ? [`${submissionsAttempted} submission attempt(s) occurred despite expected abort.`]
      : []),
    ...(endToEndSubmissionExpected && submissionsSucceeded < 1
      ? [
          "This ordinary loopback fixture did not reach one explicitly verified successful submission.",
        ]
      : []),
    ...(samePageBranchExpected && !samePageBranchDetected
      ? ["Expected one-level same-page branching was not detected."]
      : []),
    ...(samePageBranchExpected && branchDepthExceeded
      ? ["A supported depth-one fixture was incorrectly classified as depth two."]
      : []),
    ...(samePageBranchExpected && submissionsSucceeded < 1
      ? ["Supported same-page branching did not reach a verified fixture submission."]
      : []),
    ...(branchExecutionMisses.length
      ? [
          `Supported first-level branch fields were not populated and verified: ${branchExecutionMisses
            .map((row) => row.expected.name || row.expected.label)
            .join(", ")}.`,
        ]
      : []),
    ...(submissionsSucceeded > 0 && !explicitSubmissionConfirmed
      ? [
          "A submission was counted as successful without an explicit high-confidence rendered success marker.",
        ]
      : []),
    ...(submissionsSucceeded > 0 &&
    events.some(
      (event) =>
        event.kind === "fixture_terminal_submission_completed" &&
        Number(event.metadata?.navigationStatus || 200) >= 400,
    )
      ? ["A failed HTTP submission was counted as successful."]
      : []),
  ];
  const functionalVerdict =
    blockingDiscrepancies.length === 0 &&
    requiredMismatches.length === 0 &&
    missingFlags.length === 0 &&
    (expectedAbort || missing.length === 0)
      ? "pass"
      : "needs_changes";
  const metadataVerdict =
    sensitiveMismatches.length === 0 ? "pass" : "needs_review";
  const strictVerdict =
    functionalVerdict === "pass" && metadataVerdict === "pass"
      ? "pass"
      : "needs_changes";
  const verdict =
    functionalVerdict === "pass" && metadataVerdict !== "pass"
      ? "pass_with_policy_review"
      : strictVerdict;

  const lines = [
    `# FormWeave crawl learnings — \`${siteId}\``,
    "",
    "## Blind production run",
    "",
    `- Run: \`${runId}\``,
    `- Target: \`${targetUrl}\``,
    `- Production status: \`${terminalRun.status}\` — ${terminalRun.stage}`,
    `- Model calls: ${modelCalls} started, ${modelCompletions} completed, ${modelFailures} failed`,
    `- Evidence PNGs retained: ${evidence.length}`,
    `- Field entries verified: ${Number(report?.stats?.fieldsEntered || 0)}`,
    `- Entry failures: ${entryFailures}`,
    `- Branch states: ${branchStates}`,
    `- Submissions: ${submissionsAttempted} attempted, ${submissionsSucceeded} verified`,
    `- Explicit rendered submission confirmation: ${explicitSubmissionConfirmed ? "yes" : submissionsAttempted ? "no" : "not attempted"}`,
    ...(submissionResults.length
      ? [
          `- Rendered submission outcome(s): ${submissionResults
            .map(
              (result) =>
                `${result.outcome || "unknown"} via ${result.source || "unknown source"}${
                  result.criteria?.markers?.length
                    ? ` (${result.criteria.markers.join("; ")})`
                    : ""
                }`,
            )
            .join(", ")}`,
        ]
      : []),
    "",
    "The production crawl reached a terminal run status before this site's",
    "`ground_truth.yaml` was opened. Oracle data was used only for the comparison",
    "below and was never supplied to semantic generation or deterministic replay.",
    "",
    "## Ground-truth comparison",
    "",
    `- Expected abort: ${expectedAbort ? `\`${expectedAbort}\`` : "no"}`,
    `- Expected-abort behavior matched: ${abortMatch === null ? "not applicable" : abortMatch ? "yes" : "no"}`,
    `- Expected same-page branch detected: ${samePageBranchExpected ? (samePageBranchDetected ? "yes" : "no") : "not applicable"}`,
    `- Field inventory coverage: ${coverage === null ? "not specified" : `${fieldRows.filter((row) => row.found).length}/${expectedFields.length} (${coverage.toFixed(1)}%)`}`,
    `- Missing expected red-flag codes: ${missingFlags.length ? missingFlags.map((code) => `\`${code}\``).join(", ") : "none"}`,
    `- Functional verdict: **${functionalVerdict}**`,
    `- Metadata-policy verdict: **${metadataVerdict}**`,
    `- Evaluation verdict: **${verdict}**`,
    `- Strict exact-oracle verdict: **${strictVerdict}**`,
    "",
    "| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |",
    "|---|---:|---|---:|---:|---|---:|",
    ...fieldRows.map(({ expected, observed, requiredMatch, sensitiveMatch }) =>
      `| ${[
        markdownCell(expected.name || expected.label),
        observed ? "yes" : "no",
        markdownCell(observed?.key || observed?.name || ""),
        requiredMatch === null ? "n/a" : requiredMatch ? "match" : "mismatch",
        sensitiveMatch === null ? "n/a" : sensitiveMatch ? "match" : "mismatch",
        markdownCell(
          observed?.sensitivityDecision?.code ||
            (observed ? "legacy/no provenance" : ""),
        ),
        observed?.entryStatus || "missing",
      ].join(" | ")} |`,
    ),
    "",
    "## What worked",
    "",
    `- ${fieldRows.filter((row) => row.found).length} expected field(s) were found.`,
    `- ${evidence.length} local screenshot artifact(s) were retained and passed to report analysis where available.`,
    `- ${Math.max(0, modelCompletions)} novel state(s) received completed model proposals.`,
    ...(branchStates > 0
      ? [`- ${branchStates} conditional branch state(s) were measured.`]
      : []),
    ...(entryFailures === 0
      ? ["- No attempted field entry failed browser readback."]
      : []),
    "",
    "## Discrepancies and changes to consider",
    "",
    ...(blockingDiscrepancies.length
      ? blockingDiscrepancies.map((item) => `- **Critical:** ${item}`)
      : ["- No run-level blocking discrepancy was measured."]),
    ...(missing.length
      ? [
          `- Missing field inventory: ${missing
            .map((row) => `\`${row.expected.name || row.expected.label}\``)
            .join(", ")}.`,
        ]
      : ["- No expected field was missing from the retained contract."]),
    ...(requiredMismatches.length
      ? [
          `- Requiredness mismatches: ${requiredMismatches
            .map((row) => `\`${row.expected.name}\``)
            .join(", ")}.`,
        ]
      : ["- Requiredness matched for every comparable field."]),
    ...(sensitiveMismatches.length
      ? [
          `- Sensitivity mismatches: ${sensitiveMismatches
            .map((row) => `\`${row.expected.name}\``)
            .join(", ")}.`,
        ]
      : ["- Sensitivity matched for every comparable field."]),
    ...(missingFlags.length
      ? [
          `- Expected flags not emitted as structured codes: ${missingFlags
            .map((code) => `\`${code}\``)
            .join(", ")}.`,
        ]
      : ["- All expected structured red-flag codes were observed."]),
    "",
    "## Evidence inventory",
    "",
    ...(evidence.length
      ? evidence.map((item) => `- \`${item.name}\` — ${item.bytes} bytes`)
      : ["- No PNG evidence was retained."]),
    "",
    "## Retained sources reviewed",
    "",
    `- \`data/runs/${runId}/events.jsonl\``,
    `- \`data/runs/${runId}/run.json\``,
    ...(report ? [`- \`data/runs/${runId}/report.json\``] : []),
    `- \`localhost-test-sites/${siteId}/ground_truth.yaml\``,
    "",
  ];
  await writeFile(
    path.join(oracleRoot, siteId, "LEARNINGS.md"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
  return {
    siteId,
    runId,
    targetUrl,
    productionStatus: terminalRun.status,
    stage: terminalRun.stage,
    verdict,
    strictVerdict,
    functionalVerdict,
    metadataVerdict,
    expectedAbort,
    abortMatch,
    expectedFields: expectedFields.length,
    foundFields: fieldRows.filter((row) => row.found).length,
    coverage,
    missingFields: missing.map((row) => row.expected.name),
    requiredMismatches: requiredMismatches.map((row) => row.expected.name),
    sensitiveMismatches: sensitiveMismatches.map((row) => row.expected.name),
    missingFlags,
    modelCalls,
    evidenceCount: evidence.length,
    fieldsEntered: Number(report?.stats?.fieldsEntered || 0),
    entryFailures,
    branchStates,
    branchExecutionMisses: branchExecutionMisses.map(
      (row) => row.expected.name || row.expected.label,
    ),
    submissionsAttempted,
    submissionsSucceeded,
    endToEndSubmissionExpected,
    blockingDiscrepancies,
  };
}

async function main() {
  const entries = await readdir(oracleRoot, { withFileTypes: true });
  const allSites = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("site_"))
    .map((entry) => entry.name)
    .sort();
  const sites = requestedSites.length
    ? allSites.filter((site) => requestedSites.includes(site))
    : allSites;
  const auditId = new Date().toISOString().replace(/[:.]/g, "-");
  const auditDirectory = path.join(dataRoot, auditId);
  await mkdir(auditDirectory, { recursive: true });
  const frozenRuns = [];
  const results = [];
  for (const [index, siteId] of sites.entries()) {
    process.stdout.write(
      `[${index + 1}/${sites.length}] ${siteId}: launching blind production crawl\n`,
    );
    try {
      const { runId, targetUrl } = await launch(siteId);
      process.stdout.write(`  target ${targetUrl}\n`);
      process.stdout.write(`  run ${runId}: waiting\n`);
      const terminalRun = await waitForRun(runId);
      process.stdout.write(
        `  run ${runId}: ${terminalRun.status}; frozen without oracle access\n`,
      );
      frozenRuns.push({
        siteId,
        runId,
        targetUrl,
        terminalRun,
      });
    } catch (error) {
      const failure = {
        siteId,
        verdict: "audit_error",
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(failure);
      process.stderr.write(`  ${siteId}: audit error: ${failure.error}\n`);
    }
    await writeFile(
      path.join(auditDirectory, "summary.json"),
      `${JSON.stringify(
        {
          auditId,
          apiOrigin,
          fixtureOrigin,
          oraclePolicy:
            "No ground_truth.yaml is opened until every production crawl in this audit has reached a terminal status.",
          phase: "blind_crawls",
          frozenRuns: frozenRuns.map(({ terminalRun, ...item }) => ({
            ...item,
            status: terminalRun.status,
            stage: terminalRun.stage,
          })),
          completed: results.length,
          total: sites.length,
          results,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  process.stdout.write(
    `All ${frozenRuns.length} production runs are frozen. Beginning offline ground-truth scoring.\n`,
  );
  for (const [index, frozen] of frozenRuns.entries()) {
    process.stdout.write(
      `[score ${index + 1}/${frozenRuns.length}] ${frozen.siteId}: opening oracle offline\n`,
    );
    try {
      const result = await scoreAfterRun(
        frozen.siteId,
        frozen.runId,
        frozen.targetUrl,
        frozen.terminalRun,
      );
      results.push(result);
      process.stdout.write(
        `  ${frozen.siteId}: ${result.verdict}; fields ${result.foundFields}/${result.expectedFields}; evidence ${result.evidenceCount}\n`,
      );
    } catch (error) {
      const failure = {
        siteId: frozen.siteId,
        runId: frozen.runId,
        verdict: "audit_error",
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(failure);
      process.stderr.write(
        `  ${frozen.siteId}: scoring error: ${failure.error}\n`,
      );
    }
  }
  await writeFile(
    path.join(auditDirectory, "summary.json"),
    `${JSON.stringify(
      {
        auditId,
        apiOrigin,
        fixtureOrigin,
        oraclePolicy:
          "No ground_truth.yaml was opened until every production crawl in this audit reached a terminal status.",
        phase: "offline_scoring_complete",
        frozenRuns: frozenRuns.map(({ terminalRun, ...item }) => ({
          ...item,
          status: terminalRun.status,
          stage: terminalRun.stage,
        })),
        completed: results.length,
        total: sites.length,
        results,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  process.stdout.write(`Audit complete: ${auditDirectory}\n`);
}

await main();
