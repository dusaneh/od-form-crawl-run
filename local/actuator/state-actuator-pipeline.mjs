import { randomUUID } from "node:crypto";

import { hashJson } from "../contracts/artifact-store.mjs";
import { applySemanticRepair } from "../semantic/semantic-repair.mjs";
import {
  generateActuatorBundle,
  generateActuatorRepair,
  generateRepairDiagnosis,
  generateSemanticRepair,
} from "./actuator-generator.mjs";
import { preflightActuator } from "./actuator-preflight.mjs";
import { createActuatorRuntime } from "./actuator-runtime.mjs";
import { assertActuatorBundle } from "./actuator-source.mjs";
import {
  applyActuatorRepair,
  loadActuatorBundle,
  writeActuatorBundle,
} from "./bundle-store.mjs";
import { routeRepair } from "./repair-router.mjs";
import {
  actuatorPrerequisiteObligation,
  actuatorRepairScope,
  actuatorRepairStrategy,
  assertActuatorPrerequisiteObligation,
  assignRepairLineage,
  compareRepairStrategy,
  failurePredicates,
  repeatedFailurePredicates,
} from "./repair-transaction.mjs";

export class StateActuatorPipelineError extends Error {
  constructor(
    message,
    {
      stage,
      issues = [],
      route = null,
      partial = null,
      targetLocalExhausted = false,
    } = {},
  ) {
    super(message);
    this.name = "StateActuatorPipelineError";
    this.code = stage || "actuator_preflight_failed";
    this.failureStage = stage || "actuator_preflight_failed";
    this.issues = issues;
    this.route = route;
    this.partial = partial;
    this.targetLocalExhausted = targetLocalExhausted;
  }
}

function safeId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function semanticCandidateVersion(sequence, revision) {
  return (sequence - 1) * 10 + revision + 1;
}

function bundleVersion(sequence, attempt) {
  return (sequence - 1) * 10 + attempt + 1;
}

function configuredShadowGenerationTimeoutMs() {
  const requested = Number.parseInt(
    process.env.FORMWEAVE_SHADOW_ACTUATOR_TIMEOUT_MS || "30000",
    10,
  );
  return Math.min(Math.max(Number.isFinite(requested) ? requested : 30_000, 5_000), 60_000);
}

function configuredEnforcedGenerationTimeoutMs() {
  const requested = Number.parseInt(
    process.env.FORMWEAVE_ACTUATOR_TIMEOUT_MS || "120000",
    10,
  );
  return Math.min(
    Math.max(Number.isFinite(requested) ? requested : 120_000, 10_000),
    360_000,
  );
}

function configuredRepairBudgetMs() {
  const requested = Number.parseInt(
    process.env.FORMWEAVE_ACTUATOR_REPAIR_BUDGET_MS || "240000",
    10,
  );
  return Math.min(
    Math.max(Number.isFinite(requested) ? requested : 240_000, 30_000),
    900_000,
  );
}

function isModelTransportFailure(error) {
  const corpus = [
    error?.name,
    error?.code,
    error?.message,
    error?.cause?.code,
    error?.cause?.message,
  ]
    .filter(Boolean)
    .join(" ");
  return /AbortError|aborted|fetch failed|network|timed?\s*out|timeout|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(
    corpus,
  );
}

function validatedFieldTargetKeys(validation, semanticProposal, protectedKeys) {
  const protectedSet = new Set(protectedKeys);
  const issueTargets = new Set(
    (validation.issues || []).map((issue) => issue.targetKey),
  );
  return (semanticProposal.fields || [])
    .filter(
      (field) =>
        !protectedSet.has(field.key) && !issueTargets.has(field.key),
    )
    .filter((field) => {
      const rows = (validation.results || []).filter(
        (row) => row.targetKey === field.key,
      );
      return (
        rows.some((row) => row.operation === "set_field") &&
        rows.some((row) => row.operation === "read_field") &&
        rows.every((row) => row.result?.verified === true)
      );
    })
    .map((field) => field.key);
}

const OPTIONAL_TARGET_QUARANTINE_CODES = new Set([
  "locator_unresolved",
  "actuation_unverified",
  "readback_unverified",
  "state_change_unverified",
]);

const BROWSER_FAILURE_PRECEDENCE_CODES = new Set([
  "actuation_unverified",
  "handler_contract_violation",
  "locator_unresolved",
  "readback_unverified",
  "state_change_unverified",
  "validation_blocked",
]);

export function browserFailurePrecedence({
  browserIssues = [],
  repeatedPredicates = [],
  subordinateIssues = [],
} = {}) {
  const repeatedByTarget = new Map();
  for (const predicate of repeatedPredicates || []) {
    const targetKey = String(predicate?.targetKey || "");
    const code = String(predicate?.code || "");
    if (!targetKey || !BROWSER_FAILURE_PRECEDENCE_CODES.has(code)) continue;
    if (!repeatedByTarget.has(targetKey)) repeatedByTarget.set(targetKey, new Set());
    repeatedByTarget.get(targetKey).add(code);
  }
  const winningIssues = (browserIssues || []).filter((issue) => {
    const targetKey = String(issue?.targetKey || "");
    const code = String(issue?.code || "");
    return repeatedByTarget.get(targetKey)?.has(code) === true;
  });
  if (winningIssues.length === 0) {
    return {
      applied: false,
      winningIssues: [],
      subordinateIssues: [...(subordinateIssues || [])],
      targetKeys: [],
      predicateFingerprints: [],
    };
  }
  const targetKeys = [
    ...new Set(winningIssues.map((issue) => String(issue.targetKey || ""))),
  ].filter(Boolean).sort();
  return {
    applied: true,
    winningIssues,
    subordinateIssues: [...(subordinateIssues || [])],
    targetKeys,
    predicateFingerprints: (repeatedPredicates || [])
      .filter((predicate) => targetKeys.includes(String(predicate?.targetKey || "")))
      .map(
        (predicate) =>
          predicate.fingerprint ||
          `${String(predicate.targetKey)}|${String(predicate.code)}`,
      )
      .sort(),
  };
}

export function optionalTargetQuarantine({ semanticProposal, issues = [] }) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return { eligible: false, targetKeys: [], reason: "no_issues" };
  }
  const fields = new Map(
    (semanticProposal?.fields || []).map((field) => [field.key, field]),
  );
  const actionKinds = new Map(
    (semanticProposal?.proposedActions || []).map((action) => [
      action.targetKey,
      action.kind,
    ]),
  );
  const targetKeys = [
    ...new Set(issues.map((issue) => String(issue?.targetKey || ""))),
  ].filter(Boolean).sort();
  if (targetKeys.length === 0) {
    return { eligible: false, targetKeys, reason: "missing_target_key" };
  }
  for (const issue of issues) {
    if (!OPTIONAL_TARGET_QUARANTINE_CODES.has(String(issue?.code || ""))) {
      return {
        eligible: false,
        targetKeys,
        reason: "non_quarantinable_failure_code",
      };
    }
  }
  for (const targetKey of targetKeys) {
    const field = fields.get(targetKey);
    if (!field) {
      return { eligible: false, targetKeys, reason: "non_field_target" };
    }
    if (field.required === true) {
      return { eligible: false, targetKeys, reason: "required_field" };
    }
    if (
      [
        "captcha_interaction",
        "credential_interaction",
        "login_interaction",
        "payment_interaction",
        "terminal_submit",
      ].includes(actionKinds.get(targetKey))
    ) {
      return { eligible: false, targetKeys, reason: "protected_target" };
    }
  }
  return {
    eligible: true,
    targetKeys,
    reason: "optional_target_locally_exhausted",
  };
}

function handlerSignature(bundle, targetKey) {
  const handler = (bundle.handlers || []).find(
    (candidate) =>
      candidate.targetKind === "field" && candidate.targetKey === targetKey,
  );
  if (!handler) return null;
  const actuatorModule = (bundle.modules || []).find(
    (candidate) => candidate.modulePath === handler.modulePath,
  );
  return JSON.stringify({
    operations: handler.operations || [],
    sourceFactIds: handler.sourceFactIds || [],
    sourceHash: actuatorModule?.sourceHash || null,
  });
}

function retainUnchangedCheckpoints(keys, beforeBundle, afterBundle) {
  return new Set(
    [...keys].filter((targetKey) => {
      const before = handlerSignature(beforeBundle, targetKey);
      return before && before === handlerSignature(afterBundle, targetKey);
    }),
  );
}

function semanticFieldSignature(proposal, targetKey) {
  const field = (proposal.fields || []).find((item) => item.key === targetKey);
  const mechanics = (proposal.mechanics?.fieldTargets || []).find(
    (item) => item.fieldKey === targetKey,
  );
  if (!field || !mechanics) return null;
  return hashJson({ field, mechanics });
}

function retainSemanticallyUnchangedCheckpoints(
  keys,
  beforeProposal,
  afterProposal,
  invalidatedTargetKeys,
) {
  const invalidated = new Set(invalidatedTargetKeys || []);
  return new Set(
    [...keys].filter((targetKey) => {
      if (invalidated.has(targetKey)) return false;
      const before = semanticFieldSignature(beforeProposal, targetKey);
      return before && before === semanticFieldSignature(afterProposal, targetKey);
    }),
  );
}

function rebindCertifiedSiblingHandlers({
  targetKeys,
  priorBundle,
  generatedBundle,
  semanticProposal,
}) {
  const candidate = structuredClone(generatedBundle);
  const retained = [];
  for (const targetKey of [...targetKeys].sort()) {
    const priorHandler = (priorBundle.handlers || []).find(
      (handler) =>
        handler.targetKind === "field" && handler.targetKey === targetKey,
    );
    const nextIndex = (candidate.handlers || []).findIndex(
      (handler) =>
        handler.targetKind === "field" && handler.targetKey === targetKey,
    );
    if (!priorHandler || nextIndex < 0) continue;
    const priorModule = (priorBundle.modules || []).find(
      (item) => item.modulePath === priorHandler.modulePath,
    );
    const nextHandler = candidate.handlers[nextIndex];
    const nextModuleIndex = candidate.modules.findIndex(
      (item) => item.modulePath === nextHandler.modulePath,
    );
    if (!priorModule || nextModuleIndex < 0) continue;
    if (
      candidate.handlers.some(
        (handler, index) =>
          index !== nextIndex && handler.handlerId === priorHandler.handlerId,
      )
    ) {
      continue;
    }
    if (
      candidate.modules.some(
        (item, index) =>
          index !== nextModuleIndex && item.modulePath === priorModule.modulePath,
      )
    ) {
      continue;
    }
    candidate.handlers[nextIndex] = structuredClone(priorHandler);
    candidate.modules[nextModuleIndex] = structuredClone(priorModule);
    retained.push(targetKey);
  }
  candidate.semanticCandidateHash = hashJson(semanticProposal);
  const checked = assertActuatorBundle({
    bundle: candidate,
    semanticProposal,
  });
  return {
    bundle: candidate,
    bundleHash: checked.bundleHash,
    retainedTargetKeys: retained,
  };
}

function certificationScope(plan, proposal) {
  const progressionOwned = plan?.variantOnly !== true;
  return {
    kind: progressionOwned ? "complete_state" : "branch_variant_delta",
    fieldTargetKeys: (proposal.fields || []).map((field) => field.key).sort(),
    progressionOwned,
    progressionTargetKey: progressionOwned
      ? proposal.state?.progression?.key || null
      : null,
    progressionDelegatedTo: progressionOwned ? null : "parent_state",
  };
}

async function storeSemanticCandidate({
  repository,
  artifactId,
  sequence,
  revision,
  proposal,
  existingContract = null,
  observationHash,
  parentCandidateId,
  provenance,
}) {
  const candidateId = safeId("semantic");
  const candidateVersion = repository?.nextSemanticCandidateVersion
    ? await repository.nextSemanticCandidateVersion(artifactId)
    : semanticCandidateVersion(sequence, revision);
  const candidate = {
    candidateId,
    artifactId,
    candidateVersion,
    proposal,
    observationHash,
    parentCandidateId,
    status: "validated",
    provenance,
  };
  if (repository?.putSemanticCandidate) {
    await repository.putSemanticCandidate({
      ...candidate,
      existingContract,
    });
  }
  return {
    ...candidate,
    candidateHash: hashJson(proposal),
  };
}

async function persistBundleAttempt({
  repository,
  bundle,
  semanticProposal,
  semanticCandidateId,
  status,
  provenance,
  validation,
}) {
  if (!repository?.putActuatorBundle) return;
  await repository.putActuatorBundle({
    bundle,
    semanticProposal,
    semanticCandidateId,
    status,
    provenance,
  });
  if (validation && repository.putValidationRun) {
    await repository.putValidationRun({
      artifactId: bundle.artifactId,
      semanticCandidateId,
      actuatorBundleId: bundle.bundleId,
      validation,
      validatorVersions: {
        actuatorInterface: bundle.interfaceVersion,
        semanticCandidateSchema: semanticProposal.schemaVersion,
      },
    });
  }
}

export async function generateValidateStateActuator({
  page,
  artifactId,
  sequence,
  semanticProposal,
  plan,
  observation,
  screenshot,
  storeRoot,
  repository = null,
  preflightMode = "browser",
  restoreAfterPreflight = true,
  fileProvider = null,
  evidenceSink = null,
  onEvent = async () => {},
  validateSemanticCandidate = async ({ proposal: candidate, plan: candidatePlan }) => ({
    proposal: candidate,
    plan: candidatePlan,
  }),
  maxActuatorRepairs = 2,
  maxSemanticBounces = 1,
  shadowCircuit = null,
  actuatorGenerationTimeoutMs = null,
  actuatorRepairBudgetMs = null,
  generators = {},
}) {
  if (!["browser", "static"].includes(preflightMode)) {
    throw new TypeError("Actuator preflight mode must be browser or static.");
  }
  if (preflightMode === "static" && shadowCircuit?.open) {
    throw new StateActuatorPipelineError(
      "Shadow actuator generation was skipped because an earlier model transport failure opened the run-level circuit breaker.",
      {
        stage: "actuator_shadow_circuit_open",
        issues: shadowCircuit.issues || [],
      },
    );
  }
  const generationTimeoutMs = Number.isFinite(actuatorGenerationTimeoutMs)
    ? Number(actuatorGenerationTimeoutMs)
    : preflightMode === "static"
      ? configuredShadowGenerationTimeoutMs()
      : configuredEnforcedGenerationTimeoutMs();
  const repairBudgetMs = Number.isFinite(actuatorRepairBudgetMs)
    ? Number(actuatorRepairBudgetMs)
    : configuredRepairBudgetMs();
  const repairDeadlineAt = Date.now() + repairBudgetMs;
  const remainingModelTimeoutMs = (maximum = generationTimeoutMs) => {
    const remaining = repairDeadlineAt - Date.now();
    if (remaining <= 1_000) {
      throw new StateActuatorPipelineError(
        "Per-site actuator generation exhausted its total repair budget.",
        {
          stage: "actuator_generation_failed",
          issues: [
            {
              issueId: "issue_actuator_repair_budget_exhausted",
              code: "actuator_repair_budget_exhausted",
              targetKey: currentPlan?.state?.key || "state",
              detail: `Actuator generation and repair exceeded ${repairBudgetMs} ms. No unstaged candidate was executed.`,
            },
          ],
        },
      );
    }
    return Math.max(1_000, Math.min(maximum, remaining));
  };
  let currentProposal = semanticProposal;
  let currentPlan = plan;
  let semanticRevision = 0;
  let semanticBounces = 0;
  let actuatorAttempt = 0;
  let generationValidationFailures = 0;
  let parentCandidateId = null;
  let candidate = await storeSemanticCandidate({
    repository,
    artifactId,
    sequence,
    revision: semanticRevision,
    proposal: currentProposal,
    existingContract: observation?.existingContract,
    observationHash: hashJson(observation),
    parentCandidateId,
    provenance: {
      source: "validated_semantic_generation",
      proposalId: currentProposal.proposalId,
    },
  });
  parentCandidateId = candidate.candidateId;
  let generated;
  let failureHistory = [];
  let prevalidatedTargetKeys = new Set();
  let repairOrdinal = 0;
  const repairStrategyHistory = [];
  let pendingSemanticCheckpoint = null;
  const generateBundle =
    generators.generateActuatorBundle || generateActuatorBundle;
  const generateBundleRepair =
    generators.generateActuatorRepair || generateActuatorRepair;
  const generateDiagnosis =
    generators.generateRepairDiagnosis || generateRepairDiagnosis;
  const generateDomainRepair =
    generators.generateSemanticRepair || generateSemanticRepair;

  while (actuatorAttempt <= maxActuatorRepairs) {
    remainingModelTimeoutMs();
    actuatorAttempt += 1;
    const version = generated?.bundle?.bundleVersion ||
      (repository?.nextActuatorBundleVersion
        ? await repository.nextActuatorBundleVersion(artifactId)
        : bundleVersion(sequence, actuatorAttempt - 1));
    if (!generated || generated.bundle.semanticCandidateHash !== candidate.candidateHash) {
      try {
        generated = await generateBundle(
          {
            artifactId,
            bundleVersion: version,
            bundleId: safeId("actuator"),
            semanticProposal: currentProposal,
            observation,
            screenshot,
            repairContext:
              failureHistory.length > 0
                ? { failureHistory, semanticRevision }
                : null,
          },
          {
            timeoutMs: remainingModelTimeoutMs(),
            log: async (kind, metadata) => {
              const message =
                kind === "actuator_generation_started"
                  ? `Generating per-site actuator handlers for state ${sequence}.`
                  : kind === "actuator_generation_completed"
                    ? `Generated ${metadata.handlers} per-site actuator handler mapping(s).`
                    : kind === "actuator_bundle_canonicalized"
                      ? "Aligned actuator capability declarations with statically inspected API usage."
                      : kind === "actuator_target_validation_retry"
                        ? `A generated target failed isolated static validation; retrying only ${metadata.targetKey}.`
                      : "Per-site actuator generation failed.";
              await onEvent(kind, message, { sequence, ...metadata });
            },
          },
        );
        if (pendingSemanticCheckpoint) {
          const rebound = rebindCertifiedSiblingHandlers({
            targetKeys: pendingSemanticCheckpoint.targetKeys,
            priorBundle: pendingSemanticCheckpoint.bundle,
            generatedBundle: generated.bundle,
            semanticProposal: currentProposal,
          });
          generated = {
            ...generated,
            bundle: rebound.bundle,
            bundleHash: rebound.bundleHash,
            provenance: {
              ...generated.provenance,
              bundleHash: rebound.bundleHash,
              retainedSiblingTargetKeys: rebound.retainedTargetKeys,
            },
          };
          prevalidatedTargetKeys = new Set(rebound.retainedTargetKeys);
          await onEvent(
            "repair_sibling_checkpoint_retained",
            `Retained ${rebound.retainedTargetKeys.length} certified sibling handler checkpoint(s) across semantic repair.`,
            {
              sequence,
              layer: "semantic",
              retainedTargetKeys: rebound.retainedTargetKeys,
              invalidatedTargetKeys:
                pendingSemanticCheckpoint.invalidatedTargetKeys,
            },
          );
          pendingSemanticCheckpoint = null;
        }
        generationValidationFailures = 0;
      } catch (error) {
        const stage = /^ACTUATOR_(?:SOURCE|SYNTAX|IMPORT|EXPORT|TOP_LEVEL|COMPLEXITY|CAPABILITY|COVERAGE|HANDLER)/.test(
          String(error?.code || ""),
        )
          ? "actuator_validation_blocked"
          : "actuator_generation_failed";
        const generationIssues = Array.isArray(error?.issues)
          ? error.issues
          : [
              {
                issueId: `issue_generation_${actuatorAttempt}`,
                code: String(error?.code || stage),
                targetKey: currentPlan.state?.key || "state",
                detail: error instanceof Error ? error.message : String(error),
              },
            ];
        failureHistory.push({
          attempt: actuatorAttempt,
          bundleId: null,
          bundleHash: null,
          issues: generationIssues,
          route: null,
        });
        if (
          preflightMode === "static" &&
          shadowCircuit &&
          isModelTransportFailure(error)
        ) {
          shadowCircuit.open = true;
          shadowCircuit.openedAt = new Date().toISOString();
          shadowCircuit.reason = generationIssues[0]?.detail || "Model transport failure.";
          shadowCircuit.issues = generationIssues;
          await onEvent(
            "actuator_shadow_circuit_opened",
            "A shadow actuator model request failed at the transport boundary; additional shadow generation is disabled for this run.",
            {
              sequence,
              actuatorAttempt,
              timeoutMs: generationTimeoutMs,
              issues: generationIssues,
            },
          );
          throw new StateActuatorPipelineError(
            "Shadow actuator generation stopped after the first model transport failure.",
            { stage, issues: generationIssues },
          );
        }
        generationValidationFailures += 1;
        if (generationValidationFailures <= maxActuatorRepairs) {
          await onEvent(
            "actuator_generation_retry",
            `Per-site actuator generation failed static validation for state ${sequence}; retrying without consuming a browser preflight repair attempt.`,
            {
              sequence,
              actuatorAttempt,
              generationValidationFailures,
              stage,
              issues: generationIssues,
            },
          );
          actuatorAttempt -= 1;
          generated = null;
          continue;
        }
        throw new StateActuatorPipelineError(
          "Per-site actuator generation remained invalid after bounded retries.",
          { stage, issues: generationIssues },
        );
      }
    }

    const stored = await writeActuatorBundle({
      root: storeRoot,
      bundle: generated.bundle,
      semanticProposal: currentProposal,
    });
    const loaded = await loadActuatorBundle({
      root: storeRoot,
      artifactId,
      bundleVersion: generated.bundle.bundleVersion,
    });
    const releaseId = safeId("candidate_release");
    await onEvent(
      "actuator_candidate_staged",
      `Persisted immutable per-site actuator candidate ${loaded.bundle.bundleId} before any browser preflight or execution.`,
      {
        sequence,
        semanticCandidateId: candidate.candidateId,
        semanticCandidateHash: candidate.candidateHash,
        bundleId: loaded.bundle.bundleId,
        bundleVersion: loaded.bundle.bundleVersion,
        bundleHash: loaded.bundleHash,
        path: stored.path,
        preflightMode,
      },
    );
    if (preflightMode === "static") {
      const validation = {
        schemaVersion: 1,
        validationId: safeId("validation"),
        phase: "actuator_static",
        outcome: "passed",
        semanticCandidateHash: loaded.bundle.semanticCandidateHash,
        actuatorBundleId: loaded.bundle.bundleId,
        actuatorBundleVersion: loaded.bundle.bundleVersion,
        issues: [],
        results: [],
        evidenceRefs: [],
        route: null,
        diagnosis: null,
        timings: {
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
        },
      };
      await persistBundleAttempt({
        repository,
        bundle: loaded.bundle,
        semanticProposal: currentProposal,
        semanticCandidateId: candidate.candidateId,
        status: "draft",
        provenance: generated.provenance,
        validation,
      });
      await onEvent(
        "actuator_static_validation_passed",
        `Per-site actuator source and contract validation passed for state ${sequence}; browser execution remains in shadow mode.`,
        {
          sequence,
          bundleId: loaded.bundle.bundleId,
          bundleVersion: loaded.bundle.bundleVersion,
          bundleHash: loaded.bundleHash,
        },
      );
      return {
        proposal: currentProposal,
        plan: {
          ...currentPlan,
          actuator: {
            schemaVersion: 1,
            certificationStatus: "static_validated",
            certificationScope: certificationScope(
              currentPlan,
              currentProposal,
            ),
            semanticCandidateId: candidate.candidateId,
            semanticVersion: candidate.candidateVersion,
            semanticHash: candidate.candidateHash,
            semanticProposal: currentProposal,
            bundle: loaded.bundle,
            bundleHash: loaded.bundleHash,
            releaseId,
            validationId: validation.validationId,
            storePath: stored.path,
            storeRoot,
          },
        },
        candidate,
        bundle: loaded.bundle,
        bundleHash: loaded.bundleHash,
        validation,
        handlers: loaded.handlers,
        runtime: null,
        releaseId,
      };
    }
    const runtime = createActuatorRuntime({
      page,
      semanticProposal: currentProposal,
      bundle: loaded.bundle,
      handlers: loaded.handlers,
      releaseId,
      semanticVersion: candidate.candidateVersion,
      protectedTargetKeys: currentPlan.fields
        .filter((field) => !field.actuate)
        .map((field) => field.key),
      fileProvider: fileProvider
        ? (token) => fileProvider(token, currentPlan)
        : null,
      evidenceSink,
      terminalSubmissionAuthorized: false,
    });
    const protectedTargetKeys = currentPlan.fields
      .filter((field) => !field.actuate)
      .map((field) => field.key);
    const activeCertificationScope = certificationScope(
      currentPlan,
      currentProposal,
    );
    await onEvent(
      "actuator_preflight_scope_declared",
      activeCertificationScope.progressionOwned
        ? "The state actuator preflight owns its fields and progression action."
        : "The branch-variant actuator preflight owns only its delta fields; progression remains with the parent state.",
      {
        sequence,
        certificationScope: activeCertificationScope,
      },
    );
    if (!activeCertificationScope.progressionOwned) {
      await onEvent(
        "actuator_progression_delegated",
        "Skipped progression preflight because this target-local branch delta does not own the parent state's transition.",
        {
          sequence,
          stateKey: currentProposal.state.key,
          progressionKey: currentProposal.state.progression.key,
          delegatedTo: "parent_state",
        },
      );
    }
    const validation = await preflightActuator({
      runtime,
      semanticProposal: currentProposal,
      bundle: loaded.bundle,
      releaseId,
      semanticVersion: candidate.candidateVersion,
      allowProgression:
        activeCertificationScope.progressionOwned &&
        currentProposal.state.progression.kind === "advance",
      protectedTargetKeys,
      prevalidatedTargetKeys: [...prevalidatedTargetKeys],
      diagnose: async ({ issues, results, evidenceRefs }) =>
        generateDiagnosis(
          {
            issues,
            observation,
            semanticProposal: currentProposal,
            bundle: loaded.bundle,
            handlerSources: loaded.bundle.modules,
            resultEnvelope: results,
            evidenceRefs,
          },
          { timeoutMs: remainingModelTimeoutMs(180_000) },
        ),
    });
    for (const targetKey of validatedFieldTargetKeys(
      validation,
      currentProposal,
      protectedTargetKeys,
    )) {
      prevalidatedTargetKeys.add(targetKey);
    }
    validation.certificationScope = activeCertificationScope;
    validation.prevalidatedTargetKeys = [
      ...prevalidatedTargetKeys,
    ].sort();
    if (typeof restoreAfterPreflight === "function") {
      await restoreAfterPreflight({
        runtime,
        observation,
        proposal: currentProposal,
        plan: currentPlan,
        validation,
      });
    } else if (restoreAfterPreflight) {
      await runtime.rebaseline(observation.url).catch(() => {});
    }
    validation.phase = "preflight";
    await persistBundleAttempt({
      repository,
      bundle: loaded.bundle,
      semanticProposal: currentProposal,
      semanticCandidateId: candidate.candidateId,
      status: validation.outcome === "passed" ? "validated" : "rejected",
      provenance: generated.provenance,
      validation,
    });
    await onEvent(
      validation.outcome === "passed"
        ? "actuator_preflight_passed"
        : "actuator_preflight_failed",
      validation.outcome === "passed"
        ? `Per-site actuator preflight passed for state ${sequence}.`
        : `Per-site actuator preflight found ${validation.issues.length} issue(s) for state ${sequence}.`,
      {
        sequence,
        bundleId: loaded.bundle.bundleId,
        bundleVersion: loaded.bundle.bundleVersion,
        bundleHash: loaded.bundleHash,
        issues: validation.issues,
        route: validation.route,
      },
    );
    if (validation.outcome === "passed") {
      return {
        proposal: currentProposal,
        plan: {
          ...currentPlan,
          actuator: {
            schemaVersion: 1,
            certificationStatus: "preflight_validated",
            certificationScope: activeCertificationScope,
            semanticCandidateId: candidate.candidateId,
            semanticVersion: candidate.candidateVersion,
            semanticHash: candidate.candidateHash,
            semanticProposal: currentProposal,
            bundle: loaded.bundle,
            bundleHash: loaded.bundleHash,
            releaseId,
            validationId: validation.validationId,
            storePath: stored.path,
            storeRoot,
          },
        },
        candidate,
        bundle: loaded.bundle,
        bundleHash: loaded.bundleHash,
        validation,
        handlers: loaded.handlers,
        runtime,
        releaseId,
      };
    }

    const repeatedPredicates = repeatedFailurePredicates(
      failureHistory,
      validation.issues,
    );
    const failureEntry = {
      attempt: actuatorAttempt,
      bundleId: loaded.bundle.bundleId,
      bundleHash: loaded.bundleHash,
      issues: validation.issues,
      route: validation.route,
    };
    failureHistory.push(failureEntry);
    if (repeatedPredicates.length > 0) {
      await onEvent(
        "repair_failure_predicate_repeated",
        "The same target and runtime failure predicate survived a prior repair attempt; requesting cross-layer diagnosis before another repair.",
        {
          sequence,
          actuatorAttempt,
          repeatedPredicates,
        },
      );
      const generatedDiagnosis = await generateDiagnosis(
        {
          issues: validation.issues,
          observation,
          semanticProposal: currentProposal,
          bundle: loaded.bundle,
          handlerSources: loaded.bundle.modules,
          resultEnvelope: validation.results,
          evidenceRefs: validation.evidenceRefs,
          failureHistory,
          repairComparisons: repairStrategyHistory,
          repeatedPredicates,
        },
        { timeoutMs: remainingModelTimeoutMs(180_000) },
      );
      const diagnosis = generatedDiagnosis?.diagnosis || generatedDiagnosis;
      validation.diagnosis = diagnosis;
      validation.route = routeRepair({
        stage: "",
        issues: validation.issues,
        diagnosis,
        preferDiagnosis: true,
      });
      failureEntry.route = validation.route;
      failureEntry.diagnosis = diagnosis;
      if (validation.route.repairLayers.includes("semantic")) {
        await onEvent(
          "repair_semantic_escalation_started",
          "Repeated target-local mechanics failure was diagnosed across layers and escalated to semantic repair.",
          {
            sequence,
            actuatorAttempt,
            repeatedPredicates,
            diagnosis,
          },
        );
      }
    }
    const quarantine =
      repeatedPredicates.length > 0
        ? optionalTargetQuarantine({
            semanticProposal: currentProposal,
            issues: validation.issues,
          })
        : { eligible: false, targetKeys: [], reason: "repair_not_repeated" };
    if (quarantine.eligible) {
      const quarantinedVersion = repository?.nextActuatorBundleVersion
        ? await repository.nextActuatorBundleVersion(artifactId)
        : loaded.bundle.bundleVersion + 1;
      const quarantinedBundle = {
        ...structuredClone(loaded.bundle),
        bundleId: safeId("actuator"),
        bundleVersion: quarantinedVersion,
      };
      const quarantinedStored = await writeActuatorBundle({
        root: storeRoot,
        bundle: quarantinedBundle,
        semanticProposal: currentProposal,
      });
      const quarantinedLoaded = await loadActuatorBundle({
        root: storeRoot,
        artifactId,
        bundleVersion: quarantinedVersion,
      });
      const quarantinedScope = {
        ...activeCertificationScope,
        fieldTargetKeys: activeCertificationScope.fieldTargetKeys.filter(
          (targetKey) => !quarantine.targetKeys.includes(targetKey),
        ),
        quarantinedTargetKeys: quarantine.targetKeys,
      };
      const quarantinedValidation = {
        ...validation,
        validationId: safeId("validation"),
        outcome: "passed",
        issues: [],
        quarantinedIssues: validation.issues,
        certificationScope: quarantinedScope,
        quarantinedTargetKeys: quarantine.targetKeys,
      };
      await persistBundleAttempt({
        repository,
        bundle: quarantinedLoaded.bundle,
        semanticProposal: currentProposal,
        semanticCandidateId: candidate.candidateId,
        status: "validated",
        provenance: {
          ...generated.provenance,
          source: "optional_target_quarantine",
          parentBundleId: loaded.bundle.bundleId,
          quarantinedTargetKeys: quarantine.targetKeys,
        },
        validation: quarantinedValidation,
      });
      await onEvent(
        "actuator_optional_target_quarantined",
        "An optional target exhausted one local repair and was quarantined without invalidating certified sibling targets.",
        {
          sequence,
          actuatorAttempt,
          parentBundleId: loaded.bundle.bundleId,
          bundleId: quarantinedLoaded.bundle.bundleId,
          bundleVersion: quarantinedLoaded.bundle.bundleVersion,
          quarantinedTargetKeys: quarantine.targetKeys,
          retainedTargetKeys: [...prevalidatedTargetKeys].sort(),
          failureCodes: [
            ...new Set(validation.issues.map((issue) => issue.code)),
          ].sort(),
        },
      );
      return {
        proposal: currentProposal,
        plan: {
          ...currentPlan,
          actuator: {
            schemaVersion: 1,
            certificationStatus: "preflight_validated_with_quarantine",
            certificationScope: quarantinedScope,
            quarantinedTargetKeys: quarantine.targetKeys,
            semanticCandidateId: candidate.candidateId,
            semanticVersion: candidate.candidateVersion,
            semanticHash: candidate.candidateHash,
            semanticProposal: currentProposal,
            bundle: quarantinedLoaded.bundle,
            bundleHash: quarantinedLoaded.bundleHash,
            releaseId,
            validationId: quarantinedValidation.validationId,
            storePath: quarantinedStored.path,
            storeRoot,
          },
        },
        candidate,
        bundle: quarantinedLoaded.bundle,
        bundleHash: quarantinedLoaded.bundleHash,
        validation: quarantinedValidation,
        handlers: quarantinedLoaded.handlers,
        runtime,
        releaseId,
      };
    }
    if (
      validation.route?.repairLayers?.includes("semantic") &&
      semanticBounces < maxSemanticBounces
    ) {
      semanticBounces += 1;
      let generatedRepair = await generateDomainRepair(
        {
          proposal: currentProposal,
          candidateHash: candidate.candidateHash,
          issues: validation.issues,
          observation,
          failureHistory,
        },
        { timeoutMs: remainingModelTimeoutMs(180_000) },
      );
      repairOrdinal += 1;
      const assigned = assignRepairLineage({
        repair: generatedRepair.repair,
        artifactId,
        stateIdentity: currentProposal.state,
        attemptOrdinal: repairOrdinal,
      });
      generatedRepair = {
        ...generatedRepair,
        repair: assigned.repair,
        provenance: {
          ...generatedRepair.provenance,
          ...assigned.provenance,
        },
      };
      await onEvent(
        "repair_lineage_assigned",
        "Assigned system-owned content-addressed lineage to the semantic repair before persistence or application.",
        {
          sequence,
          actuatorAttempt,
          layer: "semantic",
          ...assigned.provenance,
        },
      );
      await onEvent(
        "repair_target_isolated",
        "Scoped the semantic repair to the target keys named by its typed operations.",
        {
          sequence,
          actuatorAttempt,
          layer: "semantic",
          affectedTargetKeys: [
            ...new Set(
              generatedRepair.repair.operations.map(
                (operation) => operation.targetKey,
              ),
            ),
          ].sort(),
        },
      );
      const priorProposal = currentProposal;
      let repaired;
      let rebuilt;
      try {
        repaired = applySemanticRepair({
          proposal: currentProposal,
          repair: generatedRepair.repair,
          observation,
        });
        rebuilt = await validateSemanticCandidate({
          proposal: repaired.proposal,
          plan: currentPlan,
          invalidatedTargetKeys: repaired.invalidatedTargetKeys,
        });
      } catch (error) {
        if (repository?.putRepairAttempt) {
          await repository.putRepairAttempt({
            artifactId,
            repair: generatedRepair.repair,
            status: "rejected",
            provenance: {
              ...generatedRepair.provenance,
              rejection: error instanceof Error ? error.message : String(error),
            },
          });
        }
        throw error;
      }
      if (repository?.putRepairAttempt) {
        await repository.putRepairAttempt({
          artifactId,
          repair: generatedRepair.repair,
          status: "applied",
          provenance: generatedRepair.provenance,
        });
      }
      currentProposal = rebuilt.proposal;
      currentPlan = rebuilt.plan;
      prevalidatedTargetKeys = retainSemanticallyUnchangedCheckpoints(
        prevalidatedTargetKeys,
        priorProposal,
        currentProposal,
        repaired.invalidatedTargetKeys,
      );
      pendingSemanticCheckpoint = {
        bundle: loaded.bundle,
        targetKeys: new Set(prevalidatedTargetKeys),
        invalidatedTargetKeys: repaired.invalidatedTargetKeys,
      };
      semanticRevision += 1;
      candidate = await storeSemanticCandidate({
        repository,
        artifactId,
        sequence,
        revision: semanticRevision,
        proposal: currentProposal,
        existingContract: observation?.existingContract,
        observationHash: hashJson(observation),
        parentCandidateId,
        provenance: {
          source: "semantic_repair",
          repairId: generatedRepair.repair.repairId,
          invalidatedTargetKeys: repaired.invalidatedTargetKeys,
        },
      });
      parentCandidateId = candidate.candidateId;
      generated = null;
      continue;
    }

    if (
      validation.route?.repairLayers?.includes("actuator") &&
      actuatorAttempt <= maxActuatorRepairs
    ) {
      const prerequisiteObligation = actuatorPrerequisiteObligation({
        bundle: loaded.bundle,
        issues: validation.issues,
        observation,
      });
      if (prerequisiteObligation) {
        await onEvent(
          "repair_prerequisite_obligation_declared",
          "Declared an evidence-grounded prerequisite obligation for the unavailable target before regenerating its item-level actuator.",
          {
            sequence,
            actuatorAttempt,
            targetKeys: prerequisiteObligation.targetKeys,
            candidateFactIds: prerequisiteObligation.candidates.map(
              (candidate) => candidate.factId,
            ),
            candidateKinds: prerequisiteObligation.candidates.map(
              (candidate) => candidate.kind,
            ),
          },
        );
      }
      let generatedRepair;
      let applied;
      let appliedTransaction = null;
      let repairIssues = validation.issues;
      let lastRepairValidationIssue = null;
      for (let compilerAttempt = 1; compilerAttempt <= 2; compilerAttempt += 1) {
        generatedRepair = await generateBundleRepair(
          {
            bundle: loaded.bundle,
            bundleHash: loaded.bundleHash,
            issues: repairIssues,
            evidence: validation.evidenceRefs,
            failureHistory,
            repairComparisons: repairStrategyHistory,
            repeatedPredicates,
            prerequisiteObligation,
            observation,
            screenshot,
          },
          { timeoutMs: remainingModelTimeoutMs() },
        );
        repairOrdinal += 1;
        const assigned = assignRepairLineage({
          repair: generatedRepair.repair,
          artifactId,
          stateIdentity: currentProposal.state,
          attemptOrdinal: repairOrdinal,
        });
        generatedRepair = {
          ...generatedRepair,
          repair: assigned.repair,
          provenance: {
            ...generatedRepair.provenance,
            ...assigned.provenance,
          },
        };
        await onEvent(
          "repair_lineage_assigned",
          "Assigned system-owned content-addressed lineage to the actuator repair before persistence or application.",
          {
            sequence,
            actuatorAttempt,
            compilerAttempt,
            layer: "actuator",
            ...assigned.provenance,
          },
        );
        let transaction = null;
        try {
          const scope = actuatorRepairScope({
            bundle: loaded.bundle,
            repair: generatedRepair.repair,
            issues: validation.issues,
          });
          await onEvent(
            "repair_target_isolated",
            "Confirmed that the actuator repair changes only handlers named by the failing target scope.",
            {
              sequence,
              actuatorAttempt,
              compilerAttempt,
              layer: "actuator",
              ...scope,
            },
          );
          const predicates = failurePredicates(validation.issues);
          const strategy = actuatorRepairStrategy({
            bundle: loaded.bundle,
            repair: generatedRepair.repair,
            scope,
          });
          const comparison = compareRepairStrategy({
            priorStrategies: repairStrategyHistory,
            predicates,
            scope,
            strategy,
          });
          transaction = {
            repairId: generatedRepair.repair.repairId,
            predicateFingerprints: predicates.map(
              (predicate) => predicate.fingerprint,
            ),
            affectedTargetKeys: scope.affectedTargetKeys,
            retainedSiblingTargetKeys: scope.retainedSiblingTargetKeys,
            strategyHash: strategy.strategyHash,
            contentHash: strategy.contentHash,
            comparison,
          };
          await onEvent(
            "repair_strategy_compared",
            comparison.compared
              ? comparison.semanticallyRepeated
                ? "The proposed source changed without changing the target-level actuator strategy."
                : "The proposed actuator strategy differs from the prior failed strategy for this target and predicate."
              : "Recorded the first actuator strategy for this target and failure predicate.",
            {
              sequence,
              actuatorAttempt,
              compilerAttempt,
              ...transaction,
            },
          );
          const obligationResult = assertActuatorPrerequisiteObligation({
            obligation: prerequisiteObligation,
            strategy,
          });
          if (prerequisiteObligation) {
            await onEvent(
              "repair_prerequisite_obligation_satisfied",
              "The regenerated item-level actuator uses a grounded prerequisite and verifies the dependent target afterward.",
              {
                sequence,
                actuatorAttempt,
                compilerAttempt,
                targetKeys: prerequisiteObligation.targetKeys,
                matchedCandidates: obligationResult.matchedCandidates,
              },
            );
          }
          if (
            repeatedPredicates.length > 0 &&
            comparison.semanticallyRepeated
          ) {
            const error = new TypeError(
              "Actuator repair repeated a target-level strategy that already failed the same browser predicate.",
            );
            error.code = "ACTUATOR_REPAIR_STRATEGY_REPEATED";
            error.details = {
              affectedTargetKeys: scope.affectedTargetKeys,
              predicateFingerprints: predicates.map(
                (predicate) => predicate.fingerprint,
              ),
              priorRepairId: comparison.priorRepairId,
            };
            throw error;
          }
          applied = applyActuatorRepair({
            bundle: loaded.bundle,
            semanticProposal: currentProposal,
            repair: generatedRepair.repair,
            nextBundleId: safeId("actuator"),
            nextBundleVersion: repository?.nextActuatorBundleVersion
              ? await repository.nextActuatorBundleVersion(artifactId)
              : bundleVersion(sequence, actuatorAttempt),
          });
          appliedTransaction = transaction;
          repairStrategyHistory.push({
            ...transaction,
            status: "applied",
          });
          failureEntry.repairTransaction = {
            ...transaction,
            status: "applied",
          };
          break;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (transaction) {
            repairStrategyHistory.push({
              ...transaction,
              status: "rejected",
            });
            failureEntry.repairTransaction = {
              ...transaction,
              status: "rejected",
            };
          }
          lastRepairValidationIssue = {
            issueId: `issue_repair_validation_${actuatorAttempt}_${compilerAttempt}`,
            code: String(error?.code || "actuator_repair_validation_blocked"),
            targetKey:
              transaction?.affectedTargetKeys?.[0] ||
              validation.issues[0]?.targetKey ||
              currentPlan.state?.key ||
              "state",
            detail,
          };
          if (repository?.putRepairAttempt) {
            await repository.putRepairAttempt({
              artifactId,
              repair: generatedRepair.repair,
              status: "rejected",
              provenance: {
                ...generatedRepair.provenance,
                rejection: detail,
              },
            });
          }
          if (compilerAttempt < 2) {
            repairIssues = [...validation.issues, lastRepairValidationIssue];
            await onEvent(
              "actuator_repair_validation_retry",
              `Generated actuator repair failed static validation for state ${sequence}; requesting one compiler-guided correction before any browser replay.`,
              {
                sequence,
                actuatorAttempt,
                compilerAttempt,
                issue: lastRepairValidationIssue,
              },
            );
          }
        }
      }
      if (!applied) {
        const exhaustedTargetKeys = [
          ...new Set(
            (lastRepairValidationIssue
              ? [lastRepairValidationIssue]
              : validation.issues
            ).map((issue) => issue.targetKey),
          ),
        ].filter(Boolean).sort();
        await onEvent(
          "actuator_target_local_exhausted",
          "The bounded repair transaction exhausted this target without invalidating retained sibling checkpoints.",
          {
            sequence,
            actuatorAttempt,
            exhaustedTargetKeys,
            retainedTargetKeys: [...prevalidatedTargetKeys].sort(),
            failureCode:
              lastRepairValidationIssue?.code ||
              "actuator_repair_validation_blocked",
          },
        );
        const evidencePrecedence = browserFailurePrecedence({
          browserIssues: validation.issues,
          repeatedPredicates,
          subordinateIssues: lastRepairValidationIssue
            ? [lastRepairValidationIssue]
            : [],
        });
        if (evidencePrecedence.applied) {
          await onEvent(
            "repair_browser_failure_precedence_applied",
            "A repeated browser-proven target failure retained terminal-cause precedence over a later repair-generation or compiler failure.",
            {
              sequence,
              actuatorAttempt,
              targetKeys: evidencePrecedence.targetKeys,
              predicateFingerprints:
                evidencePrecedence.predicateFingerprints,
              winningIssueCodes: [
                ...new Set(
                  evidencePrecedence.winningIssues.map((issue) => issue.code),
                ),
              ].sort(),
              subordinateIssueCodes: [
                ...new Set(
                  evidencePrecedence.subordinateIssues.map(
                    (issue) => issue.code,
                  ),
                ),
              ].sort(),
              retainedTargetKeys: [...prevalidatedTargetKeys].sort(),
            },
          );
          throw new StateActuatorPipelineError(
            "The same browser failure predicate survived target-local repair; preserving it as the controlling terminal cause.",
            {
              stage: "actuator_preflight_failed",
              issues: evidencePrecedence.winningIssues,
              route: validation.route,
              targetLocalExhausted: true,
              partial: {
                certifiedTargetKeys: [...prevalidatedTargetKeys].sort(),
                exhaustedTargetKeys: evidencePrecedence.targetKeys,
                validationId: validation.validationId,
                bundleId: loaded.bundle.bundleId,
                bundleHash: loaded.bundleHash,
                subordinateRepairIssues:
                  evidencePrecedence.subordinateIssues,
              },
            },
          );
        }
        if (
          [
            "ACTUATOR_REPAIR_PREREQUISITE_UNSATISFIED",
            "ACTUATOR_REPAIR_STRATEGY_REPEATED",
          ].includes(lastRepairValidationIssue?.code)
        ) {
          throw new StateActuatorPipelineError(
            "The target-local prerequisite repair remained invalid; preserving the original browser failure predicate.",
            {
              stage: "actuator_preflight_failed",
              issues: validation.issues,
              route: validation.route,
              targetLocalExhausted: true,
              partial: {
                certifiedTargetKeys: [...prevalidatedTargetKeys].sort(),
                exhaustedTargetKeys,
                validationId: validation.validationId,
                bundleId: loaded.bundle.bundleId,
                bundleHash: loaded.bundleHash,
              },
            },
          );
        }
        throw new StateActuatorPipelineError(
          "Generated actuator repair remained invalid after a bounded compiler-guided retry.",
          {
            stage: "actuator_validation_blocked",
            issues: lastRepairValidationIssue ? [lastRepairValidationIssue] : [],
            route: validation.route,
            targetLocalExhausted: true,
            partial: {
              certifiedTargetKeys: [...prevalidatedTargetKeys].sort(),
              exhaustedTargetKeys,
              validationId: validation.validationId,
              bundleId: loaded.bundle.bundleId,
              bundleHash: loaded.bundleHash,
            },
          },
        );
      }
      if (repository?.putRepairAttempt) {
        await repository.putRepairAttempt({
          artifactId,
          repair: generatedRepair.repair,
          status: "applied",
          provenance: generatedRepair.provenance,
        });
      }
      generated = {
        bundle: applied.bundle,
        bundleHash: applied.bundleHash,
        provenance: {
          ...generatedRepair.provenance,
          repairId: generatedRepair.repair.repairId,
          parentBundleHash: applied.parentBundleHash,
          replacedHandlerIds: applied.replacedHandlerIds,
        },
      };
      prevalidatedTargetKeys = retainUnchangedCheckpoints(
        prevalidatedTargetKeys,
        loaded.bundle,
        applied.bundle,
      );
      await onEvent(
        "actuator_preflight_checkpoint_reused",
        `Retained ${prevalidatedTargetKeys.size} immutable target preflight checkpoint(s) after target-local actuator repair.`,
        {
          sequence,
          actuatorAttempt,
          retainedTargetKeys: [...prevalidatedTargetKeys].sort(),
          replacedHandlerIds: applied.replacedHandlerIds,
        },
      );
      await onEvent(
        "repair_sibling_checkpoint_retained",
        `Retained ${prevalidatedTargetKeys.size} certified sibling handler checkpoint(s) after the target-local actuator repair.`,
        {
          sequence,
          actuatorAttempt,
          layer: "actuator",
          retainedTargetKeys: [...prevalidatedTargetKeys].sort(),
          affectedTargetKeys: appliedTransaction?.affectedTargetKeys || [],
          replacedHandlerIds: applied.replacedHandlerIds,
        },
      );
      continue;
    }
    const exhaustedTargetKeys = [
      ...new Set(validation.issues.map((issue) => issue.targetKey)),
    ].filter(Boolean).sort();
    await onEvent(
      "actuator_target_local_exhausted",
      "The bounded repair transaction exhausted this target without invalidating retained sibling checkpoints.",
      {
        sequence,
        actuatorAttempt,
        exhaustedTargetKeys,
        retainedTargetKeys: [...prevalidatedTargetKeys].sort(),
        failureCode: validation.issues[0]?.code || "actuator_preflight_failed",
      },
    );
    throw new StateActuatorPipelineError(
      `Per-site actuator preflight remained invalid after ${actuatorAttempt} attempt(s).`,
      {
        stage: "actuator_preflight_failed",
        issues: validation.issues,
        route: validation.route,
        targetLocalExhausted: true,
        partial: {
          certifiedTargetKeys: [...prevalidatedTargetKeys].sort(),
          exhaustedTargetKeys,
          validationId: validation.validationId,
          bundleId: loaded.bundle.bundleId,
          bundleHash: loaded.bundleHash,
        },
      },
    );
  }

  await onEvent(
    "actuator_target_local_exhausted",
    "The actuator repair budget exhausted with retained target-local checkpoint evidence.",
    {
      sequence,
      exhaustedTargetKeys: failurePredicates(
        failureHistory.at(-1)?.issues || [],
      ).map((item) => item.targetKey),
      retainedTargetKeys: [...prevalidatedTargetKeys].sort(),
      failureCode: "actuator_repair_budget_exhausted",
    },
  );
  throw new StateActuatorPipelineError(
    "Per-site actuator generation exhausted its repair budget.",
    {
      stage: "actuator_preflight_failed",
      issues: failureHistory.at(-1)?.issues || [],
      route: failureHistory.at(-1)?.route || null,
      targetLocalExhausted: true,
      partial: {
        certifiedTargetKeys: [...prevalidatedTargetKeys].sort(),
        exhaustedTargetKeys: failurePredicates(
          failureHistory.at(-1)?.issues || [],
        ).map((item) => item.targetKey),
      },
    },
  );
}
