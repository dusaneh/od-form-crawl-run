import { randomUUID } from "node:crypto";

import { scalarReadbackEquivalent } from "../executor/value-equivalence.mjs";
import { routeRepair } from "./repair-router.mjs";

function invocationId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function command({
  releaseId,
  semanticVersion,
  actuatorVersion,
  stateKey,
  targetKind,
  targetKey,
  operation,
  value,
  progressionPermission = "forbidden",
}) {
  return {
    protocolVersion: 1,
    invocationId: invocationId("preflight"),
    releaseId,
    semanticVersion,
    actuatorVersion,
    stateKey,
    targetKind,
    targetKey,
    operation,
    value,
    mode: "validation_replay",
    directive: { progressionPermission },
  };
}

function resultIssues(result, targetKey, controlType = "") {
  const issues = [];
  if (!result.verified && result.failureCode) {
    issues.push({
      issueId: `issue_${targetKey}_${result.failureCode}`,
      code: result.failureCode,
      targetKey,
      controlType: String(controlType || ""),
      detail: result.detail || "The actuator result did not verify.",
    });
  }
  for (const [index, diagnostic] of (result.diagnostics || []).entries()) {
    if (!diagnostic || typeof diagnostic !== "object") continue;
    if (
      !diagnostic.issueId &&
      !diagnostic.id &&
      !diagnostic.code &&
      !diagnostic.failureCode
    ) {
      continue;
    }
    issues.push({
      issueId: String(
        diagnostic.issueId ||
          `issue_${targetKey}_diagnostic_${index + 1}`,
      ),
      code: String(
        diagnostic.code ||
          diagnostic.failureCode ||
          "handler_contract_violation",
      ),
      targetKey: String(diagnostic.targetKey || targetKey),
      controlType: String(diagnostic.controlType || controlType || ""),
      detail: String(
        diagnostic.detail || "The actuator returned a diagnostic issue.",
      ),
    });
  }
  return issues;
}

export async function preflightActuator({
  runtime,
  semanticProposal,
  bundle,
  releaseId,
  semanticVersion = 1,
  allowProgression = true,
  diagnose = null,
  protectedTargetKeys = [],
  prevalidatedTargetKeys = [],
}) {
  const startedAt = Date.now();
  const results = [];
  const issues = [];
  const evidenceRefs = new Set();
  const protectedFields = new Set(protectedTargetKeys);
  const prevalidatedFields = new Set(prevalidatedTargetKeys);
  await runtime.prepare();

  const prepareHandler = bundle.handlers.find(
    (handler) =>
      handler.targetKind === "state" &&
      handler.targetKey === semanticProposal.state.key &&
      handler.operations.includes("prepare_state"),
  );
  if (prepareHandler) {
    const result = await runtime.invoke(
      command({
        releaseId,
        semanticVersion,
        actuatorVersion: bundle.bundleVersion,
        stateKey: semanticProposal.state.key,
        targetKind: "state",
        targetKey: semanticProposal.state.key,
        operation: "prepare_state",
        value: null,
      }),
    );
    results.push({ targetKey: semanticProposal.state.key, operation: "prepare_state", result });
    issues.push(...resultIssues(result, semanticProposal.state.key));
    if (result.beforeObservationRef) evidenceRefs.add(result.beforeObservationRef);
    if (result.afterObservationRef) evidenceRefs.add(result.afterObservationRef);
  }

  for (const field of semanticProposal.fields) {
    if (prevalidatedFields.has(field.key)) {
      results.push({
        targetKey: field.key,
        operation: "checkpoint_reused",
        result: {
          attempted: false,
          status: "unattempted",
          verified: false,
          failureCode: null,
          detail:
            "An immutable target/module checkpoint from the prior isolated preflight was reused.",
        },
      });
      continue;
    }
    if (protectedFields.has(field.key)) {
      results.push({
        targetKey: field.key,
        operation: "set_field",
        result: {
          attempted: false,
          status: "unattempted",
          verified: false,
          failureCode: null,
          detail: "Protected field retained without preflight actuation.",
        },
      });
      continue;
    }
    const fieldIssueStart = issues.length;
    const setResult = await runtime.invoke(
      command({
        releaseId,
        semanticVersion,
        actuatorVersion: bundle.bundleVersion,
        stateKey: semanticProposal.state.key,
        targetKind: "field",
        targetKey: field.key,
        operation: "set_field",
        value:
          field.controlType === "file"
            ? { fileToken: field.key }
            : field.testValue,
      }),
    );
    results.push({ targetKey: field.key, operation: "set_field", result: setResult });
    issues.push(...resultIssues(setResult, field.key, field.controlType));
    if (setResult.beforeObservationRef) evidenceRefs.add(setResult.beforeObservationRef);
    if (setResult.afterObservationRef) evidenceRefs.add(setResult.afterObservationRef);
    if (!setResult.verified) {
      if (field.required) break;
      continue;
    }

    const readResult = await runtime.invoke(
      command({
        releaseId,
        semanticVersion,
        actuatorVersion: bundle.bundleVersion,
        stateKey: semanticProposal.state.key,
        targetKind: "field",
        targetKey: field.key,
        operation: "read_field",
        value:
          field.controlType === "file"
            ? { fileToken: field.key }
            : field.testValue,
      }),
    );
    results.push({ targetKey: field.key, operation: "read_field", result: readResult });
    issues.push(...resultIssues(readResult, field.key, field.controlType));
    if (readResult.beforeObservationRef) evidenceRefs.add(readResult.beforeObservationRef);
    if (readResult.afterObservationRef) evidenceRefs.add(readResult.afterObservationRef);
    if (
      readResult.verified &&
      readResult.normalizedReadback !== null &&
      field.controlType !== "file" &&
      !scalarReadbackEquivalent(field.testValue, readResult.normalizedReadback)
    ) {
      issues.push({
        issueId: `issue_${field.key}_readback_unverified`,
        code: "readback_unverified",
        targetKey: field.key,
        detail:
          "The independent read handler returned a value that did not match the semantic test value after generic normalization.",
      });
    }

    const alternateChoiceValues = ["select", "radio"].includes(
      field.controlType,
    )
      ? (field.options || [])
          .map((option) => option.value)
          .filter(
            (value) =>
              value !== null &&
              value !== undefined &&
              String(value) !== "" &&
              !scalarReadbackEquivalent(field.testValue, value),
          )
      : [];
    for (const choiceValue of alternateChoiceValues) {
      const choiceResult = await runtime.invoke(
        command({
          releaseId,
          semanticVersion,
          actuatorVersion: bundle.bundleVersion,
          stateKey: semanticProposal.state.key,
          targetKind: "field",
          targetKey: field.key,
          operation: "set_field",
          value: choiceValue,
        }),
      );
      results.push({
        targetKey: field.key,
        operation: "set_field_choice",
        value: choiceValue,
        result: choiceResult,
      });
      if (!choiceResult.verified) {
        issues.push(...resultIssues(choiceResult, field.key, field.controlType));
        issues.push({
          issueId: `issue_${field.key}_choice_value_contract`,
          code: "handler_contract_violation",
          targetKey: field.key,
          controlType: String(field.controlType || ""),
          detail:
            "The field handler must accept every declared safe semantic option supplied through command.value; it cannot be hard-coded to only the proposal testValue.",
        });
        break;
      }
      if (
        choiceResult.normalizedReadback !== null &&
        !scalarReadbackEquivalent(
          choiceValue,
          choiceResult.normalizedReadback,
        )
      ) {
        issues.push({
          issueId: `issue_${field.key}_choice_readback_unverified`,
          code: "readback_unverified",
          targetKey: field.key,
          controlType: String(field.controlType || ""),
          detail:
            "The handler accepted an alternate declared option but did not return equivalent readback.",
        });
        break;
      }
    }
    if (
      alternateChoiceValues.length > 0 &&
      issues.length === fieldIssueStart
    ) {
      const restored = await runtime.invoke(
        command({
          releaseId,
          semanticVersion,
          actuatorVersion: bundle.bundleVersion,
          stateKey: semanticProposal.state.key,
          targetKind: "field",
          targetKey: field.key,
          operation: "set_field",
          value: field.testValue,
        }),
      );
      results.push({
        targetKey: field.key,
        operation: "restore_field_choice",
        result: restored,
      });
      issues.push(...resultIssues(restored, field.key, field.controlType));
    }
  }

  const progression = semanticProposal.state.progression;
  if (
    issues.length === 0 &&
    allowProgression &&
    progression.kind === "advance"
  ) {
    const progressionResult = await runtime.invoke(
      command({
        releaseId,
        semanticVersion,
        actuatorVersion: bundle.bundleVersion,
        stateKey: semanticProposal.state.key,
        targetKind: "action",
        targetKey: progression.key,
        operation: "execute_action",
        value: null,
        progressionPermission: "allowed",
      }),
    );
    results.push({
      targetKey: progression.key,
      operation: "execute_action",
      result: progressionResult,
    });
    issues.push(...resultIssues(progressionResult, progression.key));
    if (progressionResult.beforeObservationRef) {
      evidenceRefs.add(progressionResult.beforeObservationRef);
    }
    if (progressionResult.afterObservationRef) {
      evidenceRefs.add(progressionResult.afterObservationRef);
    }
    if (progressionResult.verified && !progressionResult.stateChanged) {
      issues.push({
        issueId: `issue_${progression.key}_state_change_unverified`,
        code: "state_change_unverified",
        targetKey: progression.key,
        detail: "The progression handler reported success without a state change.",
      });
    }
  }

  let diagnosis = null;
  let route = null;
  if (issues.length > 0) {
    route = routeRepair({ stage: "actuator_preflight_failed", issues });
    if (route.nextState === "diagnosis_required" && diagnose) {
      diagnosis = await diagnose({ issues, results, evidenceRefs: [...evidenceRefs] });
      route = routeRepair({
        stage: "",
        issues,
        diagnosis: diagnosis?.diagnosis || diagnosis,
      });
    }
  }

  return {
    schemaVersion: 1,
    validationId: invocationId("validation"),
    phase: "preflight",
    outcome: issues.length === 0 ? "passed" : "failed",
    semanticCandidateHash: bundle.semanticCandidateHash,
    actuatorBundleId: bundle.bundleId,
    actuatorBundleVersion: bundle.bundleVersion,
    issues,
    results,
    evidenceRefs: [...evidenceRefs],
    prevalidatedTargetKeys: [...prevalidatedFields].sort(),
    route,
    diagnosis: diagnosis?.diagnosis || diagnosis,
    timings: {
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    },
  };
}
