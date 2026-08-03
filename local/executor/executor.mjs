import { randomUUID } from "node:crypto";

import {
  validateProbeDirective,
  validateRawObservation,
  validateResultEnvelope,
  validateSemanticContract,
} from "../contracts/runtime-schemas.mjs";
import { PhysicsToolbox } from "./physics-toolbox.mjs";
import {
  matchDeclaredState,
  observeRuntimeStateIdentity,
  observedIdentityKey,
} from "./state-identity.mjs";

export const D3_EXECUTION_MODES = Object.freeze([
  "probe",
  "validation_replay",
  "fixture",
  "real_data",
]);

function unattempted(key) {
  return {
    key,
    status: "unattempted",
    attempted: false,
    resolved: false,
    entered: false,
    verified: false,
    failureCode: null,
    detail: null,
  };
}

function failed(key, failureCode, detail, flags = {}) {
  return {
    key,
    status: "failed",
    attempted: flags.attempted ?? true,
    resolved: flags.resolved ?? false,
    entered: flags.entered ?? false,
    verified: false,
    failureCode,
    detail,
  };
}

function verified(key) {
  return {
    key,
    status: "verified",
    attempted: true,
    resolved: true,
    entered: true,
    verified: true,
    failureCode: null,
    detail: null,
  };
}

function sameScalar(left, right) {
  return Object.is(left, right) || String(left) === String(right);
}

function progressionPermission(directive, stateKey, inputs) {
  if (directive === null || directive === undefined) return "forbidden";
  if (
    directive &&
    typeof directive === "object" &&
    directive.schemaVersion !== undefined
  ) {
    validateProbeDirective(directive);
    if (directive.stateKey !== stateKey) {
      throw new TypeError("D7 directive state does not match the invocation.");
    }
    if (
      !Object.hasOwn(inputs, directive.fieldKey) ||
      !sameScalar(inputs[directive.fieldKey], directive.value)
    ) {
      throw new TypeError("D7 directive value does not match invocation inputs.");
    }
    return directive.progressionPermission;
  }
  if (
    directive &&
    typeof directive === "object" &&
    Object.keys(directive).length === 1 &&
    ["allowed", "forbidden"].includes(directive.progressionPermission)
  ) {
    return directive.progressionPermission;
  }
  throw new TypeError("Invalid executor directive.");
}

function validateMechanics(mechanics, contract) {
  if (!mechanics || typeof mechanics !== "object") {
    throw new TypeError("D1 mechanics are required.");
  }
  if (
    mechanics.artifactId !== contract.artifactId ||
    mechanics.contractVersion !== contract.contractVersion
  ) {
    throw new TypeError("D1 mechanics do not match the D2 contract.");
  }
  if (!Number.isInteger(mechanics.scriptVersion) || mechanics.scriptVersion < 1) {
    throw new TypeError("D1 scriptVersion must be a positive integer.");
  }
  if (
    !Array.isArray(mechanics.allowedSyntheticFieldKeys) ||
    !Array.isArray(mechanics.protectedFieldKeys)
  ) {
    throw new TypeError(
      "D1 mechanics must carry explicit allowed and protected field keys.",
    );
  }
  for (const key of mechanics.allowedSyntheticFieldKeys) {
    if (!contract.fields.some((field) => field.key === key)) {
      throw new TypeError(`D1 allowed field "${key}" is outside D2.`);
    }
  }
  for (const key of mechanics.protectedFieldKeys || []) {
    if (!contract.fields.some((field) => field.key === key)) {
      throw new TypeError(`D1 protected field "${key}" is outside D2.`);
    }
    if (mechanics.allowedSyntheticFieldKeys.includes(key)) {
      throw new TypeError(
        `D1 field "${key}" cannot be both allowed and protected.`,
      );
    }
  }
  for (const state of contract.states) {
    const scripted = mechanics.states?.[state.key];
    if (
      !scripted ||
      scripted.progression?.key !== state.progression.key ||
      scripted.progression?.kind !== state.progression.kind
    ) {
      throw new TypeError(
        `D1 progression for state "${state.key}" does not match D2.`,
      );
    }
  }
}

export class D3Executor {
  constructor({
    page,
    contract,
    mechanics,
    evidenceSink = null,
    allowReadLikePost = () => false,
  }) {
    validateSemanticContract(contract);
    validateMechanics(mechanics, contract);
    this.page = page;
    this.contract = contract;
    this.mechanics = mechanics;
    this.toolbox = new PhysicsToolbox(page, {
      evidenceSink,
      allowReadLikePost,
    });
    this.seenIdentityKeys = new Map();
    this.prepared = false;
  }

  async prepare() {
    if (!this.prepared) {
      await this.toolbox.installRequestGuard();
      this.prepared = true;
    }
    await this.toolbox.prepare();
  }

  async observe(state) {
    await this.toolbox.prepare();
    return observeRuntimeStateIdentity({
      page: this.page,
      contract: this.contract,
      mechanics: this.mechanics,
      toolbox: this.toolbox,
      hintedState: state,
    });
  }

  versions() {
    return {
      artifact: this.contract.artifactVersion,
      contract: this.contract.contractVersion,
      fingerprintAlgorithm:
        this.mechanics.fingerprintAlgorithmVersion || "recon-only",
      script: this.mechanics.scriptVersion,
    };
  }

  envelope({
    invocationId,
    state,
    fieldResults,
    stateOutcome,
    progression,
    observedStateIdentity,
    evidenceRefs,
    faultClass = null,
  }) {
    const value = {
      schemaVersion: 1,
      invocationId,
      artifactId: this.contract.artifactId,
      versions: this.versions(),
      stateKey: state.key,
      fieldResults,
      stateOutcome,
      progression,
      observedStateIdentity,
      evidenceRefs,
      faultClass,
    };
    validateResultEnvelope(value);
    return value;
  }

  async execute({
    scriptVersion,
    contractVersion,
    stateKey,
    inputs = {},
    directive = null,
    mode,
  }) {
    if (!D3_EXECUTION_MODES.includes(mode)) {
      throw new TypeError(`Unsupported D3 execution mode "${mode}".`);
    }
    if (
      scriptVersion !== this.mechanics.scriptVersion ||
      contractVersion !== this.contract.contractVersion
    ) {
      throw new TypeError("Pinned script or contract version does not match.");
    }
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
      throw new TypeError("Executor inputs must be an object.");
    }
    const state = this.contract.states.find((item) => item.key === stateKey);
    if (!state) throw new TypeError(`Unknown D2 state "${stateKey}".`);
    const permission = progressionPermission(directive, stateKey, inputs);
    const invocationId = `invoke_${randomUUID()}`;
    const evidenceRefs = [];

    await this.prepare();
    const arrivalIdentity = await this.observe(state);
    const requestedIdentityKey = observedIdentityKey(state.expectedIdentity);
    if (observedIdentityKey(arrivalIdentity) !== requestedIdentityKey) {
      const fieldResults = state.fieldKeys.map(unattempted);
      return this.envelope({
        invocationId,
        state,
        fieldResults,
        stateOutcome: "failed",
        progression: {
          kind: state.progression.kind,
          outcome: "failed",
          attempted: false,
          confirmed: false,
          failureCode: "form_change_suspected",
          beforeIdentity: arrivalIdentity,
          afterIdentity: arrivalIdentity,
          matchedSuccessorStateKey: null,
        },
        observedStateIdentity: arrivalIdentity,
        evidenceRefs,
        faultClass: "form_change_suspicion",
      });
    }
    this.seenIdentityKeys.set(requestedIdentityKey, state.key);
    if (state.progression.kind === "terminal_submit") {
      await this.toolbox.armTerminalGuard(
        this.mechanics.states[state.key].progression,
      );
    }

    const stateFieldKeys = new Set(state.fieldKeys);
    const resultKeys = [
      ...new Set([...state.fieldKeys, ...Object.keys(inputs)]),
    ].sort();
    const fieldsByKey = new Map(
      this.contract.fields.map((field) => [field.key, field]),
    );
    const fieldResults = [];
    for (const key of resultKeys) {
      if (!Object.hasOwn(inputs, key)) {
        fieldResults.push(unattempted(key));
        continue;
      }
      if (!stateFieldKeys.has(key) || !fieldsByKey.has(key)) {
        fieldResults.push(
          failed(
            key,
            "type_mismatch",
            "The input is outside the invoked D2 state.",
            { resolved: false, entered: false },
          ),
        );
        continue;
      }
      const field = fieldsByKey.get(key);
      if (
        (this.mechanics.protectedFieldKeys || []).includes(key) ||
        !(this.mechanics.allowedSyntheticFieldKeys || []).includes(key)
      ) {
        fieldResults.push(
          failed(
            key,
            "could_not_test",
            "The generated D1 safety contract did not authorize automatic actuation of this field.",
            { attempted: false, resolved: true, entered: false },
          ),
        );
        continue;
      }
      const target = this.mechanics.fields?.[key];
      const outcome = await this.toolbox.writeControl(
        target,
        field.controlType,
        field.options.map((option) => option.value),
        inputs[key],
      );
      fieldResults.push(
        outcome.verified
          ? verified(key)
          : failed(key, outcome.failureCode, outcome.detail, {
              resolved: outcome.failureCode !== "locator_unresolved",
              entered: false,
            }),
      );
    }
    const afterFillEvidence = await this.toolbox.capture("after_fill", {
      invocationId,
      stateKey,
    });
    if (afterFillEvidence) evidenceRefs.push(afterFillEvidence);
    const afterFillIdentity = await this.observe(state);
    const hasFieldFailure = fieldResults.some(
      (result) => result.status === "failed",
    );

    const baseProgression = {
      kind: state.progression.kind,
      outcome: "not_attempted",
      attempted: false,
      confirmed: false,
      failureCode: null,
      beforeIdentity: null,
      afterIdentity: null,
      matchedSuccessorStateKey: null,
    };
    if (hasFieldFailure) {
      return this.envelope({
        invocationId,
        state,
        fieldResults,
        stateOutcome: "failed",
        progression: baseProgression,
        observedStateIdentity: afterFillIdentity,
        evidenceRefs,
      });
    }
    if (permission !== "allowed") {
      return this.envelope({
        invocationId,
        state,
        fieldResults,
        stateOutcome: "completed",
        progression: baseProgression,
        observedStateIdentity: afterFillIdentity,
        evidenceRefs,
      });
    }
    if (observedIdentityKey(afterFillIdentity) !== requestedIdentityKey) {
      return this.envelope({
        invocationId,
        state,
        fieldResults,
        stateOutcome: "completed",
        progression: baseProgression,
        observedStateIdentity: afterFillIdentity,
        evidenceRefs,
      });
    }
    if (state.progression.kind === "terminal_submit") {
      const blockedEvidence = await this.toolbox.capture("terminal_blocked", {
        invocationId,
        stateKey,
      });
      if (blockedEvidence) evidenceRefs.push(blockedEvidence);
      return this.envelope({
        invocationId,
        state,
        fieldResults,
        stateOutcome: "blocked",
        progression: {
          kind: state.progression.kind,
          outcome: "blocked",
          attempted: false,
          confirmed: false,
          failureCode: "terminal_submission_blocked",
          beforeIdentity: afterFillIdentity,
          afterIdentity: afterFillIdentity,
          matchedSuccessorStateKey: null,
        },
        observedStateIdentity: afterFillIdentity,
        evidenceRefs,
      });
    }

    const beforeEvidence = await this.toolbox.capture("before_advance", {
      invocationId,
      stateKey,
    });
    if (beforeEvidence) evidenceRefs.push(beforeEvidence);
    const target = this.mechanics.states[state.key].progression;
    const click = await this.toolbox.clickAction(target);
    if (!click.clicked) {
      return this.envelope({
        invocationId,
        state,
        fieldResults,
        stateOutcome: "failed",
        progression: {
          kind: state.progression.kind,
          outcome: "failed",
          attempted: true,
          confirmed: false,
          failureCode: "advance_no_navigation",
          beforeIdentity: afterFillIdentity,
          afterIdentity: afterFillIdentity,
          matchedSuccessorStateKey: null,
        },
        observedStateIdentity: afterFillIdentity,
        evidenceRefs,
      });
    }
    const afterIdentity = await this.observe(state);
    const afterEvidence = await this.toolbox.capture("after_advance", {
      invocationId,
      stateKey,
    });
    if (afterEvidence) evidenceRefs.push(afterEvidence);
    const beforeKey = observedIdentityKey(afterFillIdentity);
    const afterKey = observedIdentityKey(afterIdentity);
    if (beforeKey === afterKey) {
      const validationMessages = await this.toolbox.validationMessages();
      return this.envelope({
        invocationId,
        state,
        fieldResults,
        stateOutcome: "failed",
        progression: {
          kind: state.progression.kind,
          outcome: "failed",
          attempted: true,
          confirmed: false,
          failureCode:
            validationMessages.length > 0
              ? "validation_blocked"
              : "advance_no_navigation",
          beforeIdentity: afterFillIdentity,
          afterIdentity,
          matchedSuccessorStateKey: null,
        },
        observedStateIdentity: afterIdentity,
        evidenceRefs,
      });
    }
    const matched = matchDeclaredState(this.contract, afterIdentity);
    if (!matched) {
      return this.envelope({
        invocationId,
        state,
        fieldResults,
        stateOutcome: "failed",
        progression: {
          kind: state.progression.kind,
          outcome: "failed",
          attempted: true,
          confirmed: false,
          failureCode: "form_change_suspected",
          beforeIdentity: afterFillIdentity,
          afterIdentity,
          matchedSuccessorStateKey: null,
        },
        observedStateIdentity: afterIdentity,
        evidenceRefs,
        faultClass: "form_change_suspicion",
      });
    }
    const transition = this.contract.transitions.find(
      (item) =>
        item.fromStateKey === state.key && item.toStateKey === matched.key,
    );
    if (!transition) {
      return this.envelope({
        invocationId,
        state,
        fieldResults,
        stateOutcome: "failed",
        progression: {
          kind: state.progression.kind,
          outcome: "failed",
          attempted: true,
          confirmed: false,
          failureCode: "form_change_suspected",
          beforeIdentity: afterFillIdentity,
          afterIdentity,
          matchedSuccessorStateKey: null,
        },
        observedStateIdentity: afterIdentity,
        evidenceRefs,
        faultClass: "form_change_suspicion",
      });
    }
    const seenAs = this.seenIdentityKeys.get(afterKey);
    if (seenAs) {
      return this.envelope({
        invocationId,
        state,
        fieldResults,
        stateOutcome: "failed",
        progression: {
          kind: state.progression.kind,
          outcome: "failed",
          attempted: true,
          confirmed: false,
          failureCode: "repeated_state_unrepresentable",
          beforeIdentity: afterFillIdentity,
          afterIdentity,
          matchedSuccessorStateKey: null,
        },
        observedStateIdentity: afterIdentity,
        evidenceRefs,
      });
    }
    this.seenIdentityKeys.set(afterKey, matched.key);
    return this.envelope({
      invocationId,
      state,
      fieldResults,
      stateOutcome: "completed",
      progression: {
        kind: state.progression.kind,
        outcome: "confirmed",
        attempted: true,
        confirmed: true,
        failureCode: null,
        beforeIdentity: afterFillIdentity,
        afterIdentity,
        matchedSuccessorStateKey: matched.key,
      },
      observedStateIdentity: afterIdentity,
      evidenceRefs,
    });
  }

  async probeChoice({ stateKey, fieldKey, value }) {
    const directive = {
      schemaVersion: 1,
      stateKey,
      fieldKey,
      value,
      progressionPermission: "forbidden",
    };
    validateProbeDirective(directive);
    const state = this.contract.states.find((item) => item.key === stateKey);
    const field = this.contract.fields.find((item) => item.key === fieldKey);
    if (!state || !field || !state.fieldKeys.includes(fieldKey)) {
      throw new TypeError("D7 probe target is outside the invoked D2 state.");
    }
    if ((this.mechanics.protectedFieldKeys || []).includes(fieldKey)) {
      throw new TypeError("D7 cannot probe a protected field.");
    }
    await this.prepare();
    const beforeIdentity = await this.observe(state);
    const beforeControls = await this.toolbox.senseControls();
    const outcome = await this.toolbox.writeControl(
      this.mechanics.fields?.[fieldKey],
      field.controlType,
      field.options.map((option) => option.value),
      value,
    );
    if (!outcome.verified) {
      const error = new Error(outcome.detail || "D7 probe actuation failed.");
      error.formweaveCode = outcome.failureCode || "could_not_test";
      throw error;
    }
    await this.toolbox.settle();
    const afterControls = await this.toolbox.senseControls();
    const afterIdentity = await this.observe(state);
    const beforeById = new Map(beforeControls.map((fact) => [fact.factId, fact]));
    const afterById = new Map(afterControls.map((fact) => [fact.factId, fact]));
    const observation = {
      schemaVersion: 1,
      stateKey,
      probe: { fieldKey, value },
      before: { identity: beforeIdentity, controls: beforeControls },
      after: { identity: afterIdentity, controls: afterControls },
      delta: {
        addedFactIds: [...afterById.keys()]
          .filter(
            (key) =>
              !beforeById.has(key) ||
              (!beforeById.get(key).visible && afterById.get(key).visible),
          )
          .sort(),
        removedFactIds: [...beforeById.keys()]
          .filter(
            (key) =>
              !afterById.has(key) ||
              (beforeById.get(key).visible && !afterById.get(key).visible),
          )
          .sort(),
        requiredChangedFactIds: [...afterById.keys()]
          .filter(
            (key) =>
              beforeById.has(key) &&
              beforeById.get(key).required !== afterById.get(key).required,
          )
          .sort(),
      },
      observedAt: new Date().toISOString(),
    };
    validateRawObservation(observation);
    return observation;
  }
}

export function createD3Executor(context) {
  return new D3Executor(context);
}
