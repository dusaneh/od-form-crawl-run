import { createHash } from "node:crypto";

import {
  createArtifactVersion,
  hashJson,
  sha256,
  writeGeneratedScriptVersion,
} from "../contracts/artifact-store.mjs";
import { validateSemanticContract } from "../contracts/runtime-schemas.mjs";
import {
  fingerprintArtifact,
  normalizeArtifactUrl,
} from "../fingerprint.ts";
import { validateProposalSafety } from "../semantic/proposal-safety.mjs";
import { validateSemanticProposal } from "../semantic/proposal-schema.mjs";
import { renderGeneratedD1Source } from "./d1-source.mjs";

export const D1_COMPILER_VERSION = "gate3-d1-compiler-v1";

function stableArtifactId(normalizedUrl) {
  return `form_${createHash("sha256")
    .update(normalizedUrl)
    .digest("hex")
    .slice(0, 24)}`;
}

function factById(observation, factId) {
  return [
    ...(observation.controls || []),
    ...(observation.actions || []),
    ...(observation.guidance || []),
    ...(observation.sections || []),
  ].find((fact) => fact.factId === factId);
}

function fingerprintSource(observation) {
  return {
    normalizedUrl: observation.url,
    fields: observation.controls.map((fact) => ({
      name: fact.name || undefined,
      id: fact.id || undefined,
      type: fact.rawType || fact.tag,
      requiredSource: fact.required ? "required_attribute" : "none",
      optionValues: (fact.options || []).map((option) => option.value),
      sectionText: fact.sectionText || fact.groupLegend || "",
      hidden: !fact.visible,
    })),
    stateEvidence: [{}],
  };
}

function validateMechanicsAgainstObservation(proposal, observation) {
  const controls = new Map(
    observation.controls.map((fact) => [fact.factId, fact]),
  );
  const fields = new Map(proposal.fields.map((field) => [field.key, field]));
  for (const target of proposal.mechanics.fieldTargets) {
    const field = fields.get(target.fieldKey);
    const allowed = new Set(
      (field?.sourceFactIds || [])
        .map((factId) => controls.get(factId))
        .filter(Boolean)
        .flatMap((fact) => fact.selectorCandidates || []),
    );
    if (
      target.selectors.length === 0 ||
      target.selectors.some((selector) => !allowed.has(selector))
    ) {
      throw new TypeError(
        `D1 mechanics for "${target.fieldKey}" are not tied to that field's observed DOM facts.`,
      );
    }
  }
  const actionSelectors = new Set(
    observation.actions.flatMap((fact) => fact.selectorCandidates || []),
  );
  if (
    proposal.mechanics.progressionTarget.selectors.length === 0 ||
    proposal.mechanics.progressionTarget.selectors.some(
      (selector) => !actionSelectors.has(selector),
    )
  ) {
    throw new TypeError(
      "D1 progression mechanics are not tied to an observed action fact.",
    );
  }
}

function contractGuidance(item, observation) {
  const sourceFact = item.sourceFactIds
    .map((factId) => factById(observation, factId))
    .find(Boolean);
  return {
    key: item.key,
    scope: {
      kind: item.scopeKind,
      key: item.scopeKey,
    },
    kind: item.kind,
    text: item.text,
    provenance: {
      source: "model_inference",
      selector: sourceFact?.selectorCandidates?.[0] || null,
      frameUrl: null,
    },
  };
}

export function buildInitialD2Contract({
  proposal,
  observation,
  artifactId = null,
  artifactVersion = 1,
  contractVersion = 1,
  transitions = [],
}) {
  validateSemanticProposal(proposal);
  const normalizedUrl = normalizeArtifactUrl(observation.url);
  const resolvedArtifactId = artifactId || stableArtifactId(normalizedUrl);
  const contract = {
    schemaVersion: 1,
    artifactId: resolvedArtifactId,
    artifactVersion,
    contractVersion,
    normalizedUrl,
    locale: observation.locale || "en-US",
    entryStateKey: proposal.state.key,
    fields: proposal.fields.map((field) => ({
      key: field.key,
      rawLabel: field.rawLabel,
      controlType: field.controlType,
      required: { kind: field.required ? "always" : "never" },
      options: structuredClone(field.options),
      sectionKey: field.sectionKey,
      guidanceRefs: structuredClone(field.guidanceRefs),
      testValue: field.testValue,
      sensitive: field.sensitive,
      administrative: field.administrative,
    })),
    sections: proposal.sections.map((section) => ({
      key: section.key,
      label: section.label,
      parentKey: section.parentKey,
      guidanceRefs: structuredClone(section.guidanceRefs),
      order: section.order,
    })),
    guidance: proposal.guidance.map((item) =>
      contractGuidance(item, observation),
    ),
    states: [
      {
        key: proposal.state.key,
        kind: proposal.state.kind,
        order: 0,
        fieldKeys: [...proposal.state.visibleControlKeys].sort(),
        sectionKeys: [...proposal.state.sectionKeys].sort(),
        expectedIdentity: {
          normalizedRoute: proposal.state.normalizedRoute,
          visibleControlKeys: [...proposal.state.visibleControlKeys].sort(),
          progression: {
            key: proposal.state.progression.key,
            kind: proposal.state.progression.kind,
          },
        },
        progression: {
          key: proposal.state.progression.key,
          kind: proposal.state.progression.kind,
        },
      },
    ],
    transitions: structuredClone(transitions),
  };
  validateSemanticContract(contract);
  return contract;
}

export function buildD1Descriptor({
  proposal,
  contract,
  safety,
  scriptVersion,
}) {
  const fieldTargets = new Map(
    proposal.mechanics.fieldTargets.map((target) => [
      target.fieldKey,
      target.selectors,
    ]),
  );
  const fields = {};
  for (const field of contract.fields) {
    const selectors = fieldTargets.get(field.key);
    if (!selectors || selectors.length === 0) {
      throw new TypeError(
        `D1 compilation requires an observed selector for "${field.key}".`,
      );
    }
    fields[field.key] = { selectors: [...selectors] };
  }
  const allowedSyntheticFieldKeys = safety.acceptedActions
    .filter((action) => action.kind === "field_actuation")
    .map((action) => action.targetKey)
    .filter((key) => contract.fields.some((field) => field.key === key))
    .sort();
  const protectedFieldKeys = safety.protectedFields
    .map((item) => item.fieldKey)
    .sort();
  return {
    interfaceVersion: 1,
    compilerVersion: D1_COMPILER_VERSION,
    artifactId: contract.artifactId,
    contractVersion: contract.contractVersion,
    scriptVersion,
    fingerprintAlgorithmVersion: "recon-only",
    allowedSyntheticFieldKeys,
    protectedFieldKeys,
    fields,
    states: {
      [proposal.state.key]: {
        progression: {
          key: proposal.state.progression.key,
          kind: proposal.state.progression.kind,
          selectors: [
            ...proposal.mechanics.progressionTarget.selectors,
          ],
        },
      },
    },
  };
}

export async function compileAndStoreD1({
  dataRoot,
  proposal,
  observation,
  provenance,
  artifactId = null,
  artifactVersion = 1,
  contractVersion = 1,
  scriptVersion = 1,
  parentScriptVersion = null,
}) {
  validateSemanticProposal(proposal);
  validateMechanicsAgainstObservation(proposal, observation);
  const safety = validateProposalSafety({ proposal, observation });
  const contract = buildInitialD2Contract({
    proposal,
    observation,
    artifactId,
    artifactVersion,
    contractVersion,
  });
  const descriptor = buildD1Descriptor({
    proposal,
    contract,
    safety,
    scriptVersion,
  });
  const source = renderGeneratedD1Source(descriptor);
  const fingerprint = fingerprintArtifact(fingerprintSource(observation));
  const manifest = {
    schemaVersion: 1,
    kind: "generated_d1",
    artifactId: contract.artifactId,
    normalizedUrl: contract.normalizedUrl,
    versions: {
      artifact: artifactVersion,
      contract: contractVersion,
      fingerprintAlgorithm: fingerprint.algorithmVersion,
      script: scriptVersion,
    },
    generatedAt: new Date().toISOString(),
    model: provenance?.model || "unknown",
    promptVersion: provenance?.promptVersion || "unknown",
    sourceHash: sha256(source),
    parentScriptVersion,
    contractHash: hashJson(contract),
    certificationEligible: false,
  };
  const generationInput = {
    compilerVersion: D1_COMPILER_VERSION,
    compiledDescriptor: descriptor,
    proposal,
    observation,
    semanticProvenance: provenance || null,
    safety,
  };

  await createArtifactVersion({
    dataRoot,
    artifactId: contract.artifactId,
    artifactVersion,
    contract,
    fingerprint: {
      algorithmVersion: fingerprint.algorithmVersion,
      digest: fingerprint.digest,
      facts: fingerprint.facts,
    },
  });
  const stored = await writeGeneratedScriptVersion({
    dataRoot,
    artifactId: contract.artifactId,
    artifactVersion,
    scriptVersion,
    manifest,
    source,
    generationInput,
  });
  return {
    ...stored,
    contract,
    descriptor,
    manifest,
    safety,
    fingerprint,
  };
}
