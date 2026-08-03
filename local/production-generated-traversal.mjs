import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { stableJson } from "./contracts/artifact-store.mjs";
import {
  generatedUploadPayload,
  PhysicsToolbox,
} from "./executor/physics-toolbox.mjs";
import { captureNovelStateInput } from "./semantic/novel-state-input.mjs";
import {
  fixtureLegalAuthority,
  validateProposalSafety,
} from "./semantic/proposal-safety.mjs";
import { generateSemanticProposal } from "./semantic/semantic-generator.mjs";
import { writeSemanticGenerationRecord } from "./semantic/semantic-record-store.mjs";
import { generateDynamicsAssessment } from "./semantic/dynamics-assessment.mjs";
import {
  generateSubmissionResultAssessment,
  verifyStoredSubmissionResultCriteria,
} from "./semantic/submission-result-assessment.mjs";
import { shouldCaptureStateScreenshot } from "./evidence-retention.mjs";
import { detectCaptcha } from "./traversal-automation.mjs";
import { expectedDependencyProbeValues } from "./traversal-special-rules.mjs";

const GENERATED_FORM_SCRIPT_VERSION = 16;
const MAX_GENERATED_STATES = 12;
const MAX_SAME_PAGE_BRANCH_DEPTH = 1;
const CANONICAL_PROFILE_KEYS = new Set([
  "address_line_1",
  "address_line_2",
  "annual_income",
  "city",
  "date_of_birth",
  "disability_status",
  "email",
  "first_name",
  "full_name",
  "household_size",
  "housing_status",
  "immigration_status",
  "last_name",
  "middle_name",
  "monthly_income",
  "phone",
  "postal_code",
  "services_requested",
  "ssn_last4",
  "state",
  "veteran_status",
]);

export function policySensitivityDecision(field, fact = null) {
  const corpus = [
    field?.key,
    field?.rawLabel,
    fact?.name,
    fact?.id,
    fact?.rawLabel,
    fact?.autocomplete,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    ["radio", "select"].includes(field?.controlType) &&
    /\b(?:method|basis|path|category|type)\b/.test(corpus) &&
    !/\b(?:medical|health|disabil|immigration|citizenship)\b/.test(corpus)
  ) {
    return {
      sensitive: false,
      code: "non_sensitive_classification_selector",
      source: "shared_policy",
      rationale:
        "The control selects a classification method or category rather than supplying the protected value itself.",
    };
  }
  if (
    ["radio", "select"].includes(field?.controlType) &&
    /\b(?:contact|communication)\b.{0,30}\b(?:channel|method|preference)\b|\b(?:channel|method|preference)\b.{0,30}\b(?:contact|communication)\b/.test(
      corpus,
    )
  ) {
    return {
      sensitive: false,
      code: "non_sensitive_contact_preference",
      source: "shared_policy",
      rationale:
        "A contact-channel preference selects how to communicate; it does not itself contain contact information.",
    };
  }
  if (
    /\baccommodations?\b/.test(corpus) &&
    !/\b(?:medical|health|disabil)\b/.test(corpus)
  ) {
    return {
      sensitive: false,
      code: "non_sensitive_accommodation_request",
      source: "shared_policy",
      rationale:
        "A general accommodation request is not treated as medical data without health or disability context.",
    };
  }
  if (
    ["checkbox", "switch"].includes(field?.controlType) &&
    /\bfixed[\s-]+income\b/.test(corpus) &&
    !/\b(?:amount|monthly|annual|dollars?)\b/.test(corpus)
  ) {
    return {
      sensitive: false,
      code: "non_sensitive_fixed_income_status",
      source: "shared_policy",
      rationale:
        "A yes/no fixed-income status does not itself disclose an income amount.",
    };
  }
  if (field?.controlType === "file") {
    return {
      sensitive: true,
      code: "sensitive_file_upload",
      source: "shared_policy",
      rationale:
        "Uploaded documents are conservatively treated as sensitive because their contents are not known at crawl time.",
    };
  }
  if (field?.sensitive === true) {
    return {
      sensitive: true,
      code: "sensitive_model_classification",
      source: "model_proposal",
      rationale:
        "The semantic proposal classified the field as sensitive and shared policy did not narrow that classification.",
    };
  }
  if (
    /\b(?:date of birth|birth date|dob|ssn|social security|income amount|earnings|salary|wages?|financial|bank|routing|account number|card|cvv|cvc|expiry|medical|health|disabil(?:ity|ities|ed)?|accommodation|immigration|citizenship|case description|legal issue|proof of|supporting document)\b/.test(
      corpus,
    ) ||
    /\b(?:monthly|annual)\b.{0,40}\bincome\b/.test(corpus)
  ) {
    return {
      sensitive: true,
      code: "sensitive_policy_pattern",
      source: "shared_policy",
      rationale:
        "Observed field identity matches the shared sensitive-data policy.",
    };
  }
  return {
    sensitive: false,
    code: "not_sensitive",
    source: "shared_policy",
    rationale:
      "Neither the semantic proposal nor shared policy classified this field as sensitive.",
  };
}

export function policySensitiveField(field, fact = null) {
  return policySensitivityDecision(field, fact).sensitive;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeSegment(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100) || "state";
}

function observedControlIdentity(fact) {
  if (fact?.id) return `id:${fact.id}`;
  if (fact?.name) {
    const optionValue =
      Array.isArray(fact.options) && fact.options.length === 1
        ? fact.options[0]?.value || ""
        : "";
    return `name:${fact.name}|type:${fact.rawType || fact.tag || ""}|value:${optionValue}`;
  }
  return `selector:${fact?.selectorCandidates?.[0] || fact?.factId || ""}`;
}

function newlyVisibleControls(beforeObservation, afterObservation) {
  const visibleBefore = new Set(
    beforeObservation.controls
      .filter((fact) => fact.visible)
      .map(observedControlIdentity),
  );
  return afterObservation.controls.filter(
    (fact) =>
      fact.visible && !visibleBefore.has(observedControlIdentity(fact)),
  );
}

function uniqueObservedControls(controls) {
  return [
    ...new Map(
      controls.map((control) => [
        observedControlIdentity(control),
        control,
      ]),
    ).values(),
  ];
}

function visibleControlSemanticChanges(beforeObservation, afterObservation) {
  const visibleBefore = new Map(
    beforeObservation.controls
      .filter((fact) => fact.visible)
      .map((fact) => [observedControlIdentity(fact), fact]),
  );
  const semanticSignature = (fact) =>
    JSON.stringify({
      rawLabel: fact.rawLabel || "",
      groupLegend: fact.groupLegend || "",
      description: fact.description || "",
      rawType: fact.rawType || fact.tag || "",
      required: Boolean(fact.required),
      disabled: Boolean(fact.disabled),
      options: fact.options || [],
    });
  return afterObservation.controls.filter((fact) => {
    if (!fact.visible) return false;
    const before = visibleBefore.get(observedControlIdentity(fact));
    return before && semanticSignature(before) !== semanticSignature(fact);
  });
}

function scalarKey(value) {
  return `${typeof value}:${String(value)}`;
}

export function choiceProbeCoverageIssues(plan) {
  const issues = [];
  for (const field of plan.fields || []) {
    const expected = expectedDependencyProbeValues(field);
    if (expected.length === 0) continue;
    const expectedKeys = new Set(expected.map(scalarKey));
    const actual = Array.isArray(field.probeValues) ? field.probeValues : [];
    const actualKeys = new Set(actual.map(scalarKey));
    const missing = expected.filter((value) => !actualKeys.has(scalarKey(value)));
    const extra = actual.filter((value) => !expectedKeys.has(scalarKey(value)));
    if (missing.length || extra.length) {
      issues.push({
        type: "choice_probe_coverage",
        targetKey: field.key,
        detail: `Choice probes must exactly cover observed safe options. Missing: ${missing.map(String).join(", ") || "none"}; extra: ${extra.map(String).join(", ") || "none"}.`,
        selectorCandidates: field.selectors || [],
        instruction:
          "Rebuild deterministic probeValues from every observed non-placeholder option unless the shared special traversal rules exempt the select. Checkbox and switch controls require both false and true.",
      });
    }
  }
  return issues;
}

export function proposalFactBindingIssues(
  proposal,
  observation,
  { includeProgression = true } = {},
) {
  const issues = [];
  const controlsByFactId = new Map(
    (observation?.controls || []).map((fact) => [fact.factId, fact]),
  );
  const targetsByField = new Map(
    (proposal?.mechanics?.fieldTargets || []).map((target) => [
      target.fieldKey,
      target,
    ]),
  );
  for (const field of proposal?.fields || []) {
    const linkedFacts = (field.sourceFactIds || [])
      .map((factId) => controlsByFactId.get(factId))
      .filter(Boolean);
    const allowedSelectors = new Set(
      linkedFacts.flatMap((fact) => fact.selectorCandidates || []),
    );
    const selectors = targetsByField.get(field.key)?.selectors || [];
    if (
      selectors.length > 0 &&
      selectors.some((selector) => !allowedSelectors.has(selector))
    ) {
      issues.push({
        type: "field_fact_binding",
        targetKey: field.key,
        problem:
          "The field mechanics include a selector that does not belong to one of the field's declared source facts.",
        selectorCandidates: [
          ...new Set(
            linkedFacts.flatMap((fact) => fact.selectorCandidates || []),
          ),
        ].sort(),
        instruction:
          "Use selectors copied from this field's own sourceFactIds only. Do not borrow a selector from another raw control.",
      });
    }
  }

  if (includeProgression) {
    const selectedFactId =
      proposal?.mechanics?.progressionTarget?.sourceFactId || "";
    const progressionSelectors =
      proposal?.mechanics?.progressionTarget?.selectors || [];
    const selectedAction = (observation?.actions || []).find(
      (action) =>
        action.factId === selectedFactId && action.visible,
    );
    const selectedSelectors = new Set(
      selectedAction?.selectorCandidates || [],
    );
    if (
      !selectedAction ||
      progressionSelectors.length === 0 ||
      progressionSelectors.some(
        (selector) => !selectedSelectors.has(selector),
      )
    ) {
      issues.push({
        type: "progression_fact_binding",
        targetKey: proposal?.state?.progression?.key || "progression",
        problem:
          "The declared progression sourceFactId and selectors do not identify one observed visible action fact.",
        selectorCandidates: (observation?.actions || [])
          .filter((action) => action.visible)
          .map((action) => ({
            factId: action.factId,
            rawText: action.rawText,
            selectors: action.selectorCandidates || [],
          })),
        instruction:
          "Choose one intended visible action fact, copy its factId into mechanics.progressionTarget.sourceFactId, and keep selectors from that same fact. Deterministic compilation will select the unique structural locator for the chosen fact.",
      });
    }
  }
  return issues;
}

export function radioGroupProposalIssues(proposal, observation) {
  const groups = new Map();
  for (const fact of observation?.controls || []) {
    if (
      !fact.visible ||
      String(fact.rawType || "").toLowerCase() !== "radio" ||
      !fact.name
    ) {
      continue;
    }
    const current = groups.get(fact.name) || [];
    current.push(fact);
    groups.set(fact.name, current);
  }
  const issues = [];
  for (const [name, facts] of groups) {
    if (facts.length < 2) continue;
    const factIds = new Set(facts.map((fact) => fact.factId));
    const represented = (proposal?.fields || []).filter((field) =>
      (field.sourceFactIds || []).some((factId) => factIds.has(factId)),
    );
    const oneField = represented.length === 1 ? represented[0] : null;
    const representedFacts = new Set(oneField?.sourceFactIds || []);
    const expectedValues = [
      ...new Set(
        facts.flatMap((fact) =>
          (fact.options || []).map((option) => String(option.value)),
        ),
      ),
    ].sort();
    const proposedValues = [
      ...new Set(
        (oneField?.options || []).map((option) =>
          String(option.value),
        ),
      ),
    ].sort();
    if (
      !oneField ||
      oneField.controlType !== "radio" ||
      facts.some((fact) => !representedFacts.has(fact.factId)) ||
      JSON.stringify(expectedValues) !== JSON.stringify(proposedValues)
    ) {
      issues.push({
        type: "radio_group_contract",
        targetKey: name,
        problem:
          "One observed radio group was not represented as exactly one semantic field with every raw option fact.",
        sourceFactIds: [...factIds].sort(),
        expectedOptionValues: expectedValues,
        instruction:
          "Return one radio field for the shared raw name, link every option sourceFactId to it, preserve the group legend and per-option labels, and propose one primary field action. Shared code derives option probes deterministically.",
      });
    }
  }
  return issues;
}

export function sourceFactOwnershipIssues(proposal, observation) {
  const observedFactIds = new Set(
    (observation?.controls || []).map((fact) => fact.factId),
  );
  const owners = new Map();
  const issues = [];
  for (const field of proposal?.fields || []) {
    for (const factId of field.sourceFactIds || []) {
      if (!observedFactIds.has(factId)) {
        issues.push({
          type: "unknown_source_fact",
          targetKey: field.key,
          problem: `Field references source fact ${factId}, which is outside the supplied observation scope.`,
          instruction:
            "Use only sourceFactIds present in the supplied observation. Do not infer parent or sibling fields from the screenshot.",
        });
        continue;
      }
      const current = owners.get(factId) || [];
      current.push(field.key);
      owners.set(factId, current);
    }
  }
  for (const [factId, fieldKeys] of owners) {
    if (fieldKeys.length <= 1) continue;
    issues.push({
      type: "source_fact_multiple_owners",
      targetKey: factId,
      problem: `One raw control fact was assigned to multiple semantic fields: ${fieldKeys.join(", ")}.`,
      instruction:
        "Each raw control fact may belong to only one semantic field. Remove screenshot-inferred fields that do not have their own in-scope source fact.",
    });
  }
  return issues;
}

export function progressionActionContractIssues(proposal) {
  const progression = proposal?.state?.progression;
  if (!progression) return [];
  const actions = (proposal.proposedActions || []).filter(
    (action) =>
      action.targetKey === progression.key &&
      action.kind === progression.kind,
  );
  if (actions.length === 1) return [];
  return [
    {
      type: "progression_action_contract",
      targetKey: progression.key,
      problem:
        actions.length === 0
          ? "No proposed action matches both the declared progression key and progression kind."
          : "More than one proposed action matches the declared progression.",
      instruction:
        `Return exactly one ${progression.kind} action whose targetKey is the semantic progression key "${progression.key}". The raw DOM action fact belongs only in mechanics.progressionTarget.sourceFactId, not in proposedActions.targetKey.`,
    },
  ];
}

export function pendingDisclosureIssues(proposal, observation) {
  if (!["advance", "terminal_submit"].includes(
    proposal?.state?.progression?.kind,
  )) {
    return [];
  }
  const pending = (observation?.actions || []).filter(
    (action) =>
      action.visible &&
      action.disclosureControl === true &&
      action.disclosureExpanded !== true,
  );
  if (pending.length === 0) return [];
  const selectedFactId =
    proposal?.mechanics?.progressionTarget?.sourceFactId || "";
  if (
    proposal.state.progression.kind === "advance" &&
    pending.some((action) => action.factId === selectedFactId)
  ) {
    return [];
  }
  return [
    {
      type: "pending_disclosure",
      targetKey: proposal.state.progression.key,
      problem:
        "Progression was proposed while an observed disclosure control remains collapsed and unexplored.",
      pendingDisclosures: pending.map((action) => ({
        factId: action.factId,
        rawText: action.rawText,
        blockedControlFactIds: action.blockedControlFactIds,
        selectorCandidates: action.selectorCandidates,
      })),
      instruction:
        "Replace the current progression with one LLM-authored advance targeting a pending collapsed disclosure's unique structural selector. Every visible collapsed disclosure must be opened once even when no applicant control is known to be inside it, because it may reveal guidance or submission criteria. The next state will be re-sensed before any other progression or terminal decision.",
    },
  ];
}

export function exhaustedDisclosureProgressionIssues(proposal, observation) {
  if (proposal?.state?.progression?.kind !== "advance") return [];
  const selectedFactId =
    proposal?.mechanics?.progressionTarget?.sourceFactId || "";
  const selected = (observation?.actions || []).find(
    (action) => action.factId === selectedFactId,
  );
  if (
    !selected ||
    selected.disclosureControl !== true ||
    selected.disclosureExpanded !== true
  ) {
    return [];
  }
  return [
    {
      type: "exhausted_disclosure_progression",
      targetKey: proposal.state.progression.key,
      problem:
        "The proposed advance targets a disclosure control that is already expanded, so repeating it cannot establish a new form state.",
      selectedAction: {
        factId: selected.factId,
        rawText: selected.rawText,
        selectorCandidates: selected.selectorCandidates,
      },
      instruction:
        "Use the prior proposal as the base and change only progression plus references that necessarily depend on it. Choose another observed progression fact. Do not target an already-expanded disclosure. If every disclosure has been explored and the actual terminal control is next, declare it as terminal_submit rather than advance.",
    },
  ];
}

export function inaccessibleChoiceGroups(observation) {
  const groups = new Map();
  for (const fact of observation?.controls || []) {
    if (
      String(fact.rawType || "").toLowerCase() !== "radio" ||
      !fact.name
    ) {
      continue;
    }
    const current = groups.get(fact.name) || [];
    current.push(fact);
    groups.set(fact.name, current);
  }
  return [...groups.entries()]
    .filter(
      ([, facts]) =>
        facts.length >= 2 &&
        facts.every((fact) => !fact.visible) &&
        facts.some((fact) => fact.groupContainerVisible === true),
    )
    .map(([name, facts]) => ({
      name,
      factIds: facts.map((fact) => fact.factId).sort(),
      groupLegend:
        facts.map((fact) => fact.groupLegend).find(Boolean) || "",
    }));
}

export function inferJourneyEntryMode(observation) {
  const text = [
    observation?.heading,
    ...(observation?.sections || []).map((item) => item.rawText),
    ...(observation?.guidance || []).map((item) => item.rawText),
  ]
    .filter(Boolean)
    .join(" ");
  const match = text.match(/\bstep\s*(\d+)\s*(?:of|\/)\s*(\d+)\b/i);
  if (!match) {
    return {
      mode: "unknown",
      detail: "No explicit step position was visible at the supplied URL.",
    };
  }
  const current = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[2], 10);
  return {
    mode: current > 1 ? "mid_flow" : "canonical",
    detail: `Visible progress reports step ${current} of ${total}.`,
    currentStep: current,
    totalSteps: total,
  };
}

async function visibleGenerationSurfaceCount(page) {
  const controls = await page
    .locator(
      'input:visible:not([type="hidden"]):not([type="button"]):not([type="submit"]), select:visible, textarea:visible',
    )
    .count()
    .catch(() => 0);
  if (controls > 0) return controls;
  return page
    .locator(
      'a[href]:visible, button:visible, input[type="submit"]:visible, input[type="button"]:visible, [role="button"]:visible',
    )
    .count()
    .catch(() => 0);
}

function planSource(plan) {
  const encoded = Buffer.from(JSON.stringify(plan), "utf8").toString(
    "base64url",
  );
  return [
    `export const FORMWEAVE_GENERATED_PLAN_VERSION = ${GENERATED_FORM_SCRIPT_VERSION};`,
    `export const plan = Object.freeze(JSON.parse(Buffer.from(${JSON.stringify(
      encoded,
    )}, "base64url").toString("utf8")));`,
    "",
  ].join("\n");
}

async function writeAndLoadPlan(root, directoryName, plan, manifest = null) {
  const directory = path.join(root, directoryName);
  await mkdir(directory, { recursive: false });
  const source = planSource(plan);
  const sourceHash = sha256(source);
  await Promise.all([
    writeFile(path.join(directory, "generated.mjs"), source, {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(path.join(directory, "source.sha256"), `${sourceHash}\n`, {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(
      path.join(directory, "manifest.json"),
      stableJson(
        manifest || {
          schemaVersion: 1,
          kind: "generated_state_script",
          scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
          sourceHash,
        },
      ),
      { encoding: "utf8", flag: "wx" },
    ),
  ]);
  const storedSource = await readFile(
    path.join(directory, "generated.mjs"),
    "utf8",
  );
  if (sha256(storedSource) !== sourceHash) {
    throw new Error("Stored generated script failed its source-hash check.");
  }
  const moduleUrl = pathToFileURL(path.join(directory, "generated.mjs"));
  moduleUrl.searchParams.set("sha256", sourceHash);
  const loaded = await import(moduleUrl.href);
  if (
    loaded.FORMWEAVE_GENERATED_PLAN_VERSION !==
      GENERATED_FORM_SCRIPT_VERSION ||
    JSON.stringify(loaded.plan) !== JSON.stringify(plan)
  ) {
    throw new Error("Loaded generated script does not match its retained plan.");
  }
  return { plan: loaded.plan, sourceHash, directory };
}

async function loadPlanDirectory(directory) {
  const [source, expectedHash, manifest] = await Promise.all([
    readFile(path.join(directory, "generated.mjs"), "utf8"),
    readFile(path.join(directory, "source.sha256"), "utf8"),
    readFile(path.join(directory, "manifest.json"), "utf8").then(JSON.parse),
  ]);
  const sourceHash = sha256(source);
  if (sourceHash !== expectedHash.trim() || sourceHash !== manifest.sourceHash) {
    throw new Error("Retained generated script failed its source-hash check.");
  }
  const moduleUrl = pathToFileURL(path.join(directory, "generated.mjs"));
  moduleUrl.searchParams.set("sha256", sourceHash);
  const loaded = await import(moduleUrl.href);
  if (
    loaded.FORMWEAVE_GENERATED_PLAN_VERSION !==
      GENERATED_FORM_SCRIPT_VERSION
  ) {
    throw new Error("Retained generated script interface is unsupported.");
  }
  return {
    plan: loaded.plan,
    sourceHash,
    directory,
    manifest,
  };
}

async function retainedFormScript(scriptRegistryRoot, initialUrl) {
  if (!scriptRegistryRoot) return null;
  const artifactId = `form_${sha256(initialUrl).slice(0, 24)}`;
  try {
    const latest = JSON.parse(
      await readFile(
        path.join(scriptRegistryRoot, artifactId, "latest.json"),
        "utf8",
      ),
    );
    if (
      latest.artifactId !== artifactId ||
      !Number.isInteger(latest.scriptVersion) ||
      latest.scriptVersion < 1
    ) {
      throw new Error("Generated-script latest pointer is invalid.");
    }
    return await loadPlanDirectory(
      path.join(
        scriptRegistryRoot,
        artifactId,
        `v${latest.scriptVersion}`,
      ),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (/interface is unsupported/i.test(String(error?.message || ""))) {
      return null;
    }
    throw error;
  }
}

async function publishFormScript(scriptRegistryRoot, stored) {
  if (!scriptRegistryRoot) return stored;
  const artifactId = stored.plan.artifactId;
  const artifactRoot = path.join(scriptRegistryRoot, artifactId);
  await mkdir(artifactRoot, { recursive: true });
  let latestVersion = 0;
  try {
    const latest = JSON.parse(
      await readFile(path.join(artifactRoot, "latest.json"), "utf8"),
    );
    latestVersion = Number.isInteger(latest.scriptVersion)
      ? latest.scriptVersion
      : 0;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let existing = null;
  try {
    existing = await retainedFormScript(
      scriptRegistryRoot,
      stored.plan.initialUrl,
    );
  } catch {
    existing = null;
  }
  if (existing?.sourceHash === stored.sourceHash) return existing;
  const scriptVersion =
    Math.max(
      latestVersion,
      Number(existing?.manifest?.scriptVersion || 0),
    ) + 1;
  const versionedPlan = {
    ...stored.plan,
    scriptVersion,
  };
  const published = await writeAndLoadPlan(
    artifactRoot,
    `v${scriptVersion}`,
    versionedPlan,
    {
      schemaVersion: 1,
      kind: "retained_generated_form_script",
      artifactId,
      scriptVersion,
      sourceHash: sha256(planSource(versionedPlan)),
      generatedAt: new Date().toISOString(),
      stateCount: versionedPlan.states.length,
      modelCalls: versionedPlan.provenance?.length || 0,
      sourceRunDirectory: stored.directory,
    },
  );
  await writeFile(
    path.join(artifactRoot, "latest.json"),
    stableJson({
      schemaVersion: 1,
      artifactId,
      scriptVersion,
      sourceHash: published.sourceHash,
      updatedAt: new Date().toISOString(),
    }),
    "utf8",
  );
  return {
    ...published,
    manifest: {
      artifactId,
      scriptVersion,
      modelCalls: versionedPlan.provenance?.length || 0,
    },
  };
}

function existingContractFromStates(states, { includeBranchVariants = false } = {}) {
  const proposals = states.flatMap((state) => {
    const visibleFactIds = new Set(
      (state.observation?.controls || [])
        .filter((fact) => fact.visible)
        .map((fact) => fact.factId),
    );
    const visibleProposal = {
      ...state.proposal,
      fields: state.proposal.fields.filter((field) =>
        field.sourceFactIds.some((factId) => visibleFactIds.has(factId)),
      ),
    };
    return [
      visibleProposal,
      ...(includeBranchVariants ? state.branchVariantProposals || [] : []),
    ];
  });
  const unique = (collection) => [
    ...new Map(collection.map((item) => [item.key, item])).values(),
  ];
  return {
    fields: unique(proposals.flatMap((proposal) => proposal.fields)),
    sections: unique(proposals.flatMap((proposal) => proposal.sections)),
    guidance: unique(proposals.flatMap((proposal) => proposal.guidance)),
    states: unique(proposals.map((proposal) => proposal.state)),
  };
}

function fieldActionMap(proposal, safety) {
  const acceptedIds = new Set(
    safety.acceptedActions.map((action) => action.proposalId),
  );
  return new Map(
    proposal.proposedActions
      .filter((action) => acceptedIds.has(action.proposalId))
      .filter(
        (action) =>
          action.kind === "field_actuation" ||
          action.kind === "legal_acceptance_interaction" ||
          action.kind === "upload_interaction",
      )
      .map((action) => [action.targetKey, action]),
  );
}

function generatedStatePlan({
  proposal,
  observation,
  safety,
  provenance,
}) {
  const actions = fieldActionMap(proposal, safety);
  const targets = new Map(
    proposal.mechanics.fieldTargets.map((target) => [
      target.fieldKey,
      target,
    ]),
  );
  const facts = new Map(
    observation.controls.map((fact) => [fact.factId, fact]),
  );
  const proposedByTarget = new Map(
    proposal.proposedActions
      .filter((action) => action.kind !== "choice_probe")
      .map((action) => [action.targetKey, action]),
  );
  const guidanceByKey = new Map(
    proposal.guidance.map((item) => [item.key, item]),
  );
  const fields = proposal.fields.map((field) => {
      const action = actions.get(field.key);
      const acceptedDisposition = action
        ? safety.acceptedActions.find(
            (item) => item.proposalId === action.proposalId,
          )
        : null;
      const proposed = proposedByTarget.get(field.key);
      const sourceFacts = field.sourceFactIds
        .map((id) => facts.get(id))
        .filter(Boolean);
      const visibleSourceFacts = sourceFacts.filter((fact) => fact.visible);
      const rawFact = visibleSourceFacts[0];
      if (!rawFact) return null;
      const observedOptions = [
        ...new Map(
          sourceFacts
            .flatMap((fact) => fact.options || [])
            .map((option) => [
              `${String(option.value)}|${String(option.label)}`,
              option,
            ]),
        ).values(),
      ];
      const optionValuesUnavailable =
        ["radio", "select"].includes(field.controlType) &&
        observedOptions.filter(
          (option) => String(option.value ?? "").trim() !== "",
        ).length === 0;
      const legalAcceptanceType =
        proposed?.kind === "legal_acceptance_interaction"
          ? fixtureLegalAuthority(field, rawFact)
          : acceptedDisposition?.fixtureAuthority ||
            acceptedDisposition?.crawlModelingAuthority ||
            "";
      const sensitivityDecision = policySensitivityDecision(field, rawFact);
      const actuate = Boolean(action) && !optionValuesUnavailable;
      const planFieldIdentity = {
        ...field,
        label: field.rawLabel,
        observedOptions,
        actuate,
        legalAcceptanceType,
        rawIdentity: {
          id: rawFact?.id || "",
          name: rawFact?.name || "",
        },
      };
      const deterministicProbeValues = expectedDependencyProbeValues(
        planFieldIdentity,
      );
      return {
        key: field.key,
        label: field.rawLabel,
        controlType: field.controlType,
        options: field.options,
        observedOptions,
        validation: {
          pattern: rawFact.pattern || "",
          min: rawFact.min || "",
          max: rawFact.max || "",
          step: rawFact.step || "",
          minLength: rawFact.minLength || "",
          maxLength: rawFact.maxLength || "",
        },
        browserConstraints: {
          rawType: rawFact.rawType || "",
          placeholder: rawFact.placeholder || "",
          autocomplete: rawFact.autocomplete || "",
          inputMode: rawFact.inputMode || "",
          multiple: rawFact.multiple === true,
          disabled: rawFact.disabled === true,
          readOnly: rawFact.readOnly === true,
        },
        upload:
          field.controlType === "file"
            ? {
                accept: rawFact.accept || "",
                maxSize: rawFact.maxFileSize || "",
                maxFiles: rawFact.maxFiles || "",
                multiple: rawFact.multiple === true,
                guidance: field.guidanceRefs
                  .map((key) => guidanceByKey.get(key)?.text)
                  .filter(Boolean),
              }
            : {},
        required: field.required,
        sensitive: sensitivityDecision.sensitive,
        sensitivityDecision,
        administrative: field.administrative,
        sectionKey: field.sectionKey,
        guidanceRefs: field.guidanceRefs,
        testValue:
          field.controlType === "file" && action
            ? "[generated harmless upload]"
            : action?.value ?? field.testValue,
        probeValues: deterministicProbeValues,
        probeRationales: deterministicProbeValues.map((value) => ({
          value,
          rationale:
            "Deterministically derived from the observed safe option inventory.",
          proposalId: null,
        })),
        actuate,
        skipReason: optionValuesUnavailable
          ? "option_values_unavailable"
          : action
            ? null
            : proposed?.kind || "model_action_missing",
        selectors: targets.get(field.key)?.selectors || [],
        sourceFactIds: field.sourceFactIds,
        rawIdentity: {
          id: rawFact?.id || "",
          name: rawFact?.name || "",
        },
        legalAcceptanceType,
        safetyAuthority: action
          ? acceptedDisposition?.fixtureAuthority
            ? `accepted_model_action:fixture_${acceptedDisposition.fixtureAuthority}`
            : "accepted_model_action"
          : "protected_not_actuated",
        rationale: action?.rationale || proposed?.rationale || "Captured only.",
      };
    }).filter(Boolean);
  const progressionAction = proposal.proposedActions.find(
    (action) =>
      action.targetKey === proposal.state.progression.key &&
      [proposal.state.progression.kind, "terminal_submit"].includes(action.kind),
  );
  return {
    schemaVersion: 1,
    scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
    proposalId: proposal.proposalId,
    model: provenance.model,
    promptVersion: provenance.promptVersion,
    state: {
      key: proposal.state.key,
      description: proposal.state.description,
      kind: proposal.state.kind,
      route: proposal.state.normalizedRoute,
    },
    fields,
    sections: proposal.sections,
    guidance: proposal.guidance,
    choiceCoverage: [],
    samePageBranchDepth: 0,
    crossPageAssessment: null,
    progression: {
      key: proposal.state.progression.key,
      kind: proposal.state.progression.kind,
      selectors: proposal.mechanics.progressionTarget.selectors,
      rationale:
        progressionAction?.rationale ||
        proposal.state.progression.rationale,
      modelProposed: Boolean(progressionAction),
      operatorAuthorizationRequired:
        proposal.state.progression.kind === "terminal_submit",
    },
  };
}

export function assertExecutablePlanSafety(plan) {
  for (const field of plan.fields || []) {
    if (
      field.actuate &&
      !String(field.safetyAuthority || "").startsWith("accepted_model_action")
    ) {
      throw new Error(
        `Generated plan attempted to compile rejected action ${field.key}.`,
      );
    }
  }
  for (const coverage of plan.choiceCoverage || []) {
    if (coverage.variantPlan) {
      assertExecutablePlanSafety(coverage.variantPlan);
    }
  }
  return plan;
}

export function replayAuthorityIssues(
  plan,
  executionMode,
  fixtureAuthorities = {},
) {
  void executionMode;
  const issues = [];
  for (const field of plan.fields || []) {
    const match = String(field.safetyAuthority || "").match(
      /^accepted_model_action:fixture_(.+)$/,
    );
    if (!match) continue;
    const authority = match[1];
    if (fixtureAuthorities?.[authority] !== true) {
      issues.push({
        targetKey: field.key,
        problem: `Retained action requires explicit component authority ${authority} for this crawl.`,
        selectorCandidates: field.selectors || [],
      });
    }
  }
  for (const coverage of plan.choiceCoverage || []) {
    if (coverage.variantPlan) {
      issues.push(
        ...replayAuthorityIssues(
          coverage.variantPlan,
          executionMode,
          fixtureAuthorities,
        ),
      );
    }
  }
  return issues;
}

function assertReplayAuthorities(plan, executionMode, fixtureAuthorities) {
  const issues = replayAuthorityIssues(
    plan,
    executionMode,
    fixtureAuthorities,
  );
  if (issues.length > 0) {
    throw new Error(
      `Generated replay lacks current-run fixture authority for: ${issues
        .map((issue) => issue.targetKey)
        .join(", ")}.`,
    );
  }
  return plan;
}

async function planResolutionIssues(
  toolbox,
  plan,
  { validateProgression = true } = {},
) {
  const issues = [...choiceProbeCoverageIssues(plan)];
  for (const field of plan.fields) {
    if (
      !field.actuate &&
      ![
        "captcha_interaction",
        "credential_interaction",
        "legal_acceptance_interaction",
        "login_interaction",
        "option_values_unavailable",
        "payment_interaction",
        "upload_interaction",
      ].includes(field.skipReason)
    ) {
      issues.push({
        targetKey: field.key,
        problem:
          "No accepted primary typed action was proposed for this visible field.",
        selectorCandidates: field.selectors,
      });
      continue;
    }
    if (!field.actuate) continue;
    const locator = await toolbox.resolveUnique(
      { selectors: field.selectors },
      field.controlType === "radio" ? String(field.testValue) : undefined,
    );
    if (!locator) {
      issues.push({
        targetKey: field.key,
        problem:
          "The selected field selectors did not resolve to exactly one live control.",
        selectorCandidates: field.selectors,
      });
    }
  }
  if (validateProgression && plan.progression.modelProposed) {
    const locator = await toolbox.resolveUnique({
      selectors: plan.progression.selectors,
    });
    if (!locator) {
      issues.push({
        targetKey: plan.progression.key,
        problem:
          "The selected progression selectors did not resolve to exactly one live action.",
        selectorCandidates: plan.progression.selectors,
      });
    }
  }
  return issues;
}

async function withOuterWriteWindow(
  authorizeWrites,
  scope,
  reason,
  action,
  origin = "",
) {
  const close =
    authorizeWrites?.({
      scope,
      durationMs: 10_000,
      reason,
      origin,
    }) || (() => {});
  try {
    return await action();
  } finally {
    close();
  }
}

async function permitBrowserSubmit(page, durationMs = 10_000) {
  await page
    .evaluate((duration) => {
      if (window.__formweaveControl) {
        window.__formweaveControl.permitSubmitUntil = Date.now() + duration;
      }
    }, durationMs)
    .catch(() => {});
}

async function enterPlanFields({
  page,
  toolbox,
  plan,
  authorizeWrites,
  onEvent,
  source,
  valueMode = "synthetic",
}) {
  const results = [];
  for (const field of plan.fields) {
    if (!field.actuate) {
      const result = {
        field,
        outcome: {
          verified: false,
          skipped: true,
          failureCode: field.skipReason || "protected_not_actuated",
          detail: `The LLM classified this field as ${field.skipReason || "protected"}; it was captured but not actuated.`,
        },
      };
      results.push(result);
      await onEvent?.(
        "field_entry_skipped",
        `Captured ${field.label} without actuation (${field.skipReason || "protected"}).`,
        {
          fieldKey: field.key,
          label: field.label,
          control: field.controlType,
          source,
          required: field.required,
          sensitive: field.sensitive,
          sensitivityDecision: field.sensitivityDecision || null,
          adminAssisted: field.administrative,
          classification: "llm_generated",
          rationale: field.rationale,
          failureCode: field.skipReason || "protected_not_actuated",
        },
      );
      const protectedFindingEvent = {
        captcha_interaction: "interactive_captcha",
        login_interaction: "login_required",
        payment_interaction: "payment_field",
      }[field.skipReason];
      if (protectedFindingEvent) {
        await onEvent?.(
          protectedFindingEvent,
          `Protected ${field.skipReason.replaceAll("_", " ")} detected at ${field.label}; no actuation was attempted.`,
          {
            fieldKey: field.key,
            label: field.label,
            failureCode: field.skipReason,
          },
        );
      }
      continue;
    }
    await onEvent?.(
      "field_entry_started",
      field.controlType === "file"
        ? valueMode === "approved_live"
          ? `Attaching the approved execution file for ${field.label}.`
          : `Generating and attaching a harmless synthetic file for ${field.label}.`
        : valueMode === "approved_live"
          ? `Entering approved execution data for ${field.label}.`
          : `Entering generated synthetic value for ${field.label}.`,
      {
        fieldKey: field.key,
        label: field.label,
        control: field.controlType,
        source,
        required: field.required,
        sensitive: field.sensitive,
        sensitivityDecision: field.sensitivityDecision || null,
        adminAssisted: field.administrative,
        classification: "llm_generated",
        rationale: field.rationale,
      },
    );
    const outcome = await withOuterWriteWindow(
      authorizeWrites,
      "same-origin",
      `generated field action ${field.key}`,
      () =>
        field.controlType === "file"
          ? field.providedFile
            ? toolbox.uploadProvidedFile(
                { selectors: field.selectors },
                field.providedFile,
              )
            : toolbox.uploadGeneratedFile(
                { selectors: field.selectors },
                field.upload,
              )
          : toolbox.writeControl(
              { selectors: field.selectors },
              field.controlType,
              field.options.map((option) => option.value),
              field.testValue,
            ),
    );
    const result = { field, outcome };
    results.push(result);
    await onEvent?.(
      outcome.verified ? "field_entry_completed" : "field_entry_failed",
      outcome.verified
        ? `Verified ${valueMode === "approved_live" ? "approved" : "generated"} field entry for ${field.label}.`
        : `${valueMode === "approved_live" ? "Approved" : "Generated"} field entry failed for ${field.label}.`,
      {
        fieldKey: field.key,
        label: field.label,
        control: field.controlType,
        source,
        required: field.required,
        sensitive: field.sensitive,
        sensitivityDecision: field.sensitivityDecision || null,
        adminAssisted: field.administrative,
        classification: "llm_generated",
        rationale: field.rationale,
        testValue:
          valueMode === "approved_live"
            ? field.sensitive
              ? "[REDACTED]"
              : "[PROVIDED]"
            : field.testValue,
        ...(outcome.readback ? { readback: outcome.readback } : {}),
        ...(outcome.detail ? { error: outcome.detail } : {}),
      },
    );
    if (!outcome.verified && field.required) break;
  }
  return results;
}

async function advanceWithPlan({
  page,
  toolbox,
  plan,
  authorizeWrites,
  onEvent,
}) {
  if (
    plan.progression.kind !== "advance" ||
    !plan.progression.modelProposed
  ) {
    return { clicked: false, skipped: true };
  }
  await permitBrowserSubmit(page);
  const beforeUrl = page.url();
  const result = await withOuterWriteWindow(
    authorizeWrites,
    "same-origin",
    `LLM-authored advance ${plan.progression.key}`,
    () =>
      toolbox.clickAction({
        selectors: plan.progression.selectors,
      }),
  );
  await toolbox.settle();
  await onEvent?.(
    result.clicked ? "generated_advance_completed" : "automation_action_failed",
    result.clicked
      ? `Executed LLM-authored advance ${plan.progression.key}.`
      : `Could not execute LLM-authored advance ${plan.progression.key}.`,
    {
      category: "form_advance",
      label: plan.progression.key,
      strategy: "stored LLM-authored script",
      beforeUrl,
      afterUrl: page.url(),
      ...(result.detail ? { error: result.detail } : {}),
    },
  );
  return result;
}

function evidenceValue(result, source) {
  const { field, outcome } = result;
  return {
    fieldKey: field.key,
    label: field.label,
    control: field.controlType,
    value: String(field.testValue ?? ""),
    testValue: field.testValue,
    source,
    required: field.required,
    sensitive: field.sensitive,
    sensitivityDecision: field.sensitivityDecision || null,
    consent: ["consent", "acknowledgement"].includes(
      field.legalAcceptanceType,
    ),
    adminAssisted:
      field.administrative ||
      ["reviewConfirmation", "signature"].includes(
        field.legalAcceptanceType,
      ),
    classification: "llm_generated",
    rationale: field.rationale,
    verified: outcome.verified,
  };
}

async function captureEvidence({
  page,
  plan,
  fieldResults,
  sequence,
  kind,
  label,
  onEvent,
}) {
  const retainableScreenshot = shouldCaptureStateScreenshot(kind, fieldResults);
  const screenshot = retainableScreenshot
    ? await page.screenshot({ fullPage: true, type: "png" })
    : null;
  const values = fieldResults
    .filter((result) => result.outcome.verified)
    .map((result) =>
      evidenceValue(
        result,
        `generated:${plan.proposalId}@${plan.scriptVersion}`,
      ),
    );
  const identity = sha256(
    JSON.stringify({
      route: new URL(page.url()).pathname,
      state: plan.state.key,
      fields: plan.fields.map((field) => field.key).sort(),
      progression: plan.progression.key,
    }),
  ).slice(0, 16);
  const state = {
    id: `generated_${String(sequence).padStart(2, "0")}_${safeSegment(kind)}`,
    sequence,
    kind,
    label,
    url: page.url(),
    title: await page.title(),
    fingerprint: identity,
    fieldsVisible: await page
      .locator(
        'input:visible:not([type="hidden"]):not([type="button"]):not([type="submit"]), select:visible, textarea:visible',
      )
      .count()
      .catch(() => 0),
    values,
    ...(screenshot
      ? {
          screenshot,
          screenshotContentType: "image/png",
          screenshotProvider: "playwright-generated-d1",
        }
      : {}),
    capturedAt: new Date().toISOString(),
  };
  await onEvent?.(
    "state_evidence_captured",
    `${screenshot ? "Captured" : "Recorded"} ${kind.replaceAll("_", " ")} state: ${label}.`,
    {
      stateId: state.id,
      sequence,
      kind,
      url: state.url,
      fingerprint: identity,
      fieldsVisible: state.fieldsVisible,
      values,
      screenshotCaptured: Boolean(screenshot),
    },
  );
  return state;
}

function compactDynamicsObservation(observation) {
  return {
    url: observation.url,
    normalizedRoute: observation.normalizedRoute,
    title: observation.title,
    heading: observation.heading,
    controls: observation.controls.map((control) => ({
      factId: control.factId,
      name: control.name,
      id: control.id,
      rawLabel: control.rawLabel,
      groupLegend: control.groupLegend,
      description: control.description,
      rawType: control.rawType,
      required: control.required,
      visible: control.visible,
      options: control.options,
    })),
    actions: observation.actions.map((action) => ({
      factId: action.factId,
      rawText: action.rawText,
      rawType: action.rawType,
      visible: action.visible,
    })),
    sections: observation.sections,
    guidance: observation.guidance,
    accessibilitySnapshot: observation.accessibilitySnapshot,
  };
}

function normalizedDynamicsText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function afterStateContainsExactEnteredEcho(dynamicsInput) {
  const afterText = normalizedDynamicsText([
    dynamicsInput.after?.accessibilitySnapshot,
    ...(dynamicsInput.after?.guidance || []).map((item) => item.rawText),
    ...(dynamicsInput.after?.sections || []).map((item) => item.rawText),
  ].filter(Boolean).join(" "));
  return (dynamicsInput.enteredValues || []).some((entry) => {
    const label = normalizedDynamicsText(entry.label || entry.fieldKey);
    const value = normalizedDynamicsText(entry.value);
    if (!label || !value || ["true", "false"].includes(value)) return false;
    let offset = afterText.indexOf(label);
    while (offset >= 0) {
      const nearby = afterText.slice(
        offset + label.length,
        offset + label.length + 120,
      );
      if (
        new RegExp(
          `(?:^|\\s)${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
        ).test(nearby)
      ) {
        return true;
      }
      offset = afterText.indexOf(label, offset + label.length);
    }
    return false;
  });
}

async function assessDynamics({
  transitionKind,
  beforeCapture,
  afterCapture,
  trigger,
  enteredValues,
  branchDepth,
  onEvent,
  dynamicsRoot,
  recordId,
}) {
  const newlyVisible = newlyVisibleControls(
    beforeCapture.observation,
    afterCapture.observation,
  ).map((control) => ({
    factId: control.factId,
    name: control.name,
    id: control.id,
    rawLabel: control.rawLabel,
    rawType: control.rawType,
    required: control.required,
  }));
  const changedVisible = visibleControlSemanticChanges(
    beforeCapture.observation,
    afterCapture.observation,
  ).map((control) => ({
    factId: control.factId,
    name: control.name,
    id: control.id,
    rawLabel: control.rawLabel,
    rawType: control.rawType,
    required: control.required,
  }));
  let dynamicsInput = {
    schemaVersion: 1,
    transitionKind,
    branchDepth,
    trigger,
    enteredValues,
    before: compactDynamicsObservation(beforeCapture.observation),
    after: compactDynamicsObservation(afterCapture.observation),
    newlyVisibleControls: newlyVisible,
    changedVisibleControls: changedVisible,
  };
  let generated;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      generated = await generateDynamicsAssessment(
        {
          input: dynamicsInput,
          screenshot: afterCapture.screenshot,
        },
        {
          log: async (kind, metadata) =>
            onEvent?.(
              kind,
              kind === "dynamics_assessment_started"
                ? `The LLM is classifying a ${transitionKind.replaceAll("_", " ")}.`
                : kind === "dynamics_assessment_completed"
                  ? `The LLM classified the transition as ${metadata.outcome}.`
                  : `The LLM dynamics assessment failed.`,
              { attempt, ...metadata },
            ),
        },
      );
    } catch (error) {
      const issue = error instanceof Error ? error.message : String(error);
      if (attempt === 2) throw error;
      await onEvent?.(
        "dynamics_assessment_repair",
        "The first dynamics response was invalid for the observed transition; requesting one LLM correction.",
        {
          attempt,
          outcome: null,
          issue,
        },
      );
      dynamicsInput = {
        ...dynamicsInput,
        runtimeValidationFeedback: {
          priorAssessmentId: null,
          issue,
          instruction:
            `Return a corrected complete classification valid for transitionKind ${transitionKind}. For a page_advance, use only independent, cross_page_dependency, or uncertain. For a same_page_visibility_change, do not use a page-only outcome.`,
        },
      };
      continue;
    }
    let contextualIssue = "";
    const assessmentText = [
      generated.assessment.rationale,
      ...(generated.assessment.evidence || []),
    ].join(" ");
    const assessmentEvidenceText = (
      generated.assessment.evidence || []
    ).join(" ");
    if (
      transitionKind === "same_page_visibility_change" &&
      trigger?.fieldKey &&
      generated.assessment.outcome === "same_page_disclosure"
    ) {
      contextualIssue =
        "A choice_probe changed an applicant answer, so the resulting reveal cannot be classified as an unconditional disclosure. Reclassify it as same_page_branch, same_page_companion, validation_only, cosmetic, or uncertain from the rendered evidence.";
    } else if (
      transitionKind === "page_advance" &&
      enteredValues.length === 0 &&
      generated.assessment.outcome === "cross_page_dependency"
    ) {
      contextualIssue =
        "No applicant value preceded this page advance, so the observed transition cannot be an answer-conditioned cross-page dependency. Reclassify it as independent or uncertain from the rendered evidence.";
    } else if (
      transitionKind === "page_advance" &&
      generated.assessment.outcome === "cross_page_dependency" &&
      /\b(?:different|differs?) from (?:the )?entered\b|\bdoes not match (?:the )?entered\b|\bmismatch(?:es|ed)?\b.{0,50}\bentered\b/i.test(
        assessmentText,
      )
    ) {
      contextualIssue =
        "The assessment explicitly says the rendered value differs from the entered value. That contradicts an answer echo and cannot support cross-page dependency. Reclassify the ordinary next page as independent unless separate raw evidence shows changed questions, requiredness, or routing.";
    } else if (
      transitionKind === "page_advance" &&
      generated.assessment.outcome === "cross_page_dependency" &&
      (/\b(?:echo|echoed|readback|read back|told us|earlier answer|references? (?:the )?(?:prior|earlier)|prior (?:answer|value))\b/i.test(
        assessmentText,
      ) ||
        /\b(?:different from|does not match|mismatch(?:es|ed)?)\b.{0,50}\bentered\b/i.test(
          assessmentText,
        )) &&
      !/\b(?:changed requiredness|conditional control|skipped page|added page|changed (?:the )?(?:question|meaning)|which questions|follow-up (?:field|question)|question (?:appears|is required)|only (?:appears|required) (?:if|when))\b/i.test(
        assessmentEvidenceText,
      ) &&
      (!afterStateContainsExactEnteredEcho(dynamicsInput) ||
        /\b(?:echo|echoed|readback|read back|told us|references? (?:the )?(?:prior|earlier))\b/i.test(
          assessmentEvidenceText,
        ))
    ) {
      contextualIssue =
        "The assessment cited only a prior-answer echo/readback, without raw evidence that the earlier answer changed later questions, requiredness, or routing. A readback alone is independent; a different or hard-coded value is not an echo at all. Reclassify the ordinary next page as independent unless separate concrete conditional evidence is visible.";
    } else if (
      newlyVisible.length === 0 &&
      changedVisible.length === 0 &&
      [
        "same_page_branch",
        "same_page_companion",
        "same_page_disclosure",
      ].includes(generated.assessment.outcome)
    ) {
      contextualIssue =
        "No newly visible or materially changed control was observed, so a supported same-page reveal classification is inconsistent with the captured facts.";
    }
    if (!contextualIssue) break;
    await onEvent?.(
      "dynamics_assessment_repair",
      "The first dynamics classification contradicted typed runtime facts; requesting one LLM correction.",
      {
        attempt,
        assessmentId: generated.assessment.assessmentId,
        outcome: generated.assessment.outcome,
        issue: contextualIssue,
      },
    );
    if (attempt === 2) {
      throw new Error(
        `Dynamics assessment remained inconsistent after repair: ${contextualIssue}`,
      );
    }
    dynamicsInput = {
      ...dynamicsInput,
      runtimeValidationFeedback: {
        priorAssessmentId: generated.assessment.assessmentId,
        issue: contextualIssue,
        instruction:
          "Return a corrected complete classification. Do not repeat the contradictory outcome.",
      },
    };
  }
  await mkdir(dynamicsRoot, { recursive: true });
  await writeFile(
    path.join(dynamicsRoot, `${safeSegment(recordId)}.json`),
    stableJson({
      schemaVersion: 1,
      input: {
        transitionKind,
        branchDepth,
        trigger,
        enteredValues,
        beforeUrl: beforeCapture.observation.url,
        afterUrl: afterCapture.observation.url,
        beforeScreenshotSha256:
          beforeCapture.observation.screenshot.sha256,
        afterScreenshotSha256: afterCapture.observation.screenshot.sha256,
      },
      assessment: generated.assessment,
      provenance: generated.provenance,
    }),
    { encoding: "utf8", flag: "wx" },
  );
  return generated;
}

function probeFieldResult(field, value, outcome) {
  return {
    field: {
      ...field,
      testValue: value,
    },
    outcome,
  };
}

async function scopedBranchCapture(
  page,
  capture,
  revealedControls,
  changedControls,
  trigger,
) {
  const scopedSourceFactIds = [
    ...new Set(
      [...revealedControls, ...changedControls].map((control) => control.factId),
    ),
  ].sort();
  const scopedFacts = new Set(scopedSourceFactIds);
  const scopedControls = capture.observation.controls.filter((control) =>
    scopedFacts.has(control.factId),
  );
  const boxes = [];
  for (const control of scopedControls) {
    for (const selector of control.selectorCandidates || []) {
      const locator = page.locator(selector);
      if ((await locator.count().catch(() => 0)) !== 1) continue;
      const box = await locator.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) {
        boxes.push(box);
        break;
      }
    }
  }
  let screenshot = capture.screenshot;
  if (boxes.length > 0) {
    const padding = 48;
    const left = Math.max(0, Math.min(...boxes.map((box) => box.x)) - padding);
    const top = Math.max(0, Math.min(...boxes.map((box) => box.y)) - padding);
    const right =
      Math.max(...boxes.map((box) => box.x + box.width)) + padding;
    const bottom =
      Math.max(...boxes.map((box) => box.y + box.height)) + padding;
    screenshot = await page
      .screenshot({
        type: "png",
        clip: {
          x: left,
          y: top,
          width: Math.max(1, right - left),
          height: Math.max(1, bottom - top),
        },
      })
      .catch(() => capture.screenshot);
  }
  return {
    ...capture,
    screenshot,
    observation: {
      ...capture.observation,
      controls: scopedControls,
      screenshot: {
        sha256: sha256(screenshot),
        byteLength: screenshot.byteLength,
        mediaType: "image/png",
      },
      runtimeBranchScope: {
        branchDepth: 1,
        trigger,
        scopedSourceFactIds,
        instruction:
          "Generate a replayable script for only these newly visible or materially changed first-level controls. Do not repeat parent controls.",
      },
    },
  };
}

async function generateAndExecuteBranchVariant({
  page,
  toolbox,
  capture,
  revealedControls,
  changedControls,
  trigger,
  existingContract,
  priorStates,
  fixtureAuthorities,
  authorizeWrites,
  onEvent,
  generatedRoot,
  statePlansRoot,
  dynamicsRoot,
  recordId,
  evidenceSequenceStart,
}) {
  let scopedCapture = await scopedBranchCapture(
    page,
    capture,
    revealedControls,
    changedControls,
    trigger,
  );
  const stateEvents = [];
  const modelLog = async (kind, metadata) => {
    const event = {
      at: new Date().toISOString(),
      kind,
      metadata,
    };
    stateEvents.push(event);
    await onEvent?.(
      kind,
      kind === "semantic_generation_started"
        ? `Calling the LLM for first-level branch variant ${trigger.fieldKey}=${String(trigger.value)}.`
        : kind === "semantic_generation_completed"
          ? `LLM generated the first-level branch variant ${trigger.fieldKey}=${String(trigger.value)}.`
          : kind.replaceAll("_", " "),
      {
        branchVariant: true,
        trigger,
        ...metadata,
      },
    );
  };
  let generated;
  let safety;
  let plan;
  const maxBranchRepairAttempts = 2;
  const branchRepairDeadlineAt = Date.now() + 120_000;
  for (
    let repairAttempt = 1;
    repairAttempt <= maxBranchRepairAttempts;
    repairAttempt += 1
  ) {
    const remainingSemanticMs = branchRepairDeadlineAt - Date.now();
    if (remainingSemanticMs <= 1_000) {
      throw new Error(
        "First-level branch semantic validation exceeded its two-minute repair budget. No branch action was executed.",
      );
    }
    generated = await generateSemanticProposal(scopedCapture, {
      log: modelLog,
      maxSchemaAttempts: repairAttempt === 1 ? 2 : 1,
      timeoutMs: remainingSemanticMs,
    });
    safety = validateProposalSafety({
      proposal: generated.proposal,
      observation: scopedCapture.observation,
      existingContract,
      fixtureAuthorities,
    });
    plan = generatedStatePlan({
      proposal: generated.proposal,
      observation: scopedCapture.observation,
      safety,
      provenance: generated.provenance,
    });
    plan = {
      ...plan,
      variantOnly: true,
      branchTrigger: trigger,
      samePageBranchDepth: 1,
    };
    assertExecutablePlanSafety(plan);
    const resolutionIssues = await planResolutionIssues(toolbox, plan, {
      validateProgression: false,
    });
    const contractIssues = [
      ...proposalFactBindingIssues(
        generated.proposal,
        scopedCapture.observation,
        { includeProgression: false },
      ),
      ...radioGroupProposalIssues(
        generated.proposal,
        scopedCapture.observation,
      ),
      ...sourceFactOwnershipIssues(
        generated.proposal,
        scopedCapture.observation,
      ),
      ...progressionActionContractIssues(generated.proposal),
    ];
    const valueSafetyIssues = safety.rejections
      .filter((item) => item.code === "unsafe_value")
      .map((item) => {
        const action = generated.proposal.proposedActions.find(
          (candidate) => candidate.proposalId === item.proposalId,
        );
        return {
          type: "unsafe_value",
          targetKey: action?.targetKey || item.proposalId,
          detail: item.detail,
          instruction:
            "Replace this value with a format-valid, conspicuously synthetic value. Use 9999 for currency/income/rent text controls. When another strict observed pattern cannot contain test wording, use reserved 9 digits and Z/X letters (or FW for exactly two letters) while satisfying the pattern.",
        };
      });
    const repairIssues = [
      ...contractIssues,
      ...resolutionIssues,
      ...valueSafetyIssues,
    ];
    if (repairIssues.length === 0) break;
    await onEvent?.(
      "branch_variant_resolution_repair",
      `The generated first-level branch variant had ${repairIssues.length} validation issue${repairIssues.length === 1 ? "" : "s"}; requesting an LLM repair before actuation.`,
      {
        trigger,
        repairAttempt,
        issues: repairIssues,
      },
    );
    if (repairAttempt === maxBranchRepairAttempts) {
      throw new Error(
        `Branch variant validation issues remained after repair: ${repairIssues.map((item) => item.targetKey).join(", ")}.`,
      );
    }
    scopedCapture = {
      ...scopedCapture,
      observation: {
        ...scopedCapture.observation,
        runtimeValidationFeedback: {
          priorProposalId: generated.proposal.proposalId,
          priorProposal: generated.proposal,
          issues: repairIssues,
          instruction:
            "Use priorProposal as the base and correct only the listed invalid paths and their dependent references. Return the complete branch-variant proposal required by the response schema. Preserve unrelated valid values, generate only runtimeBranchScope.scopedSourceFactIds, represent each radio name as one field, provide exactly one primary typed action per in-scope field, and emit no choice_probe actions. No action has been taken.",
        },
      },
    };
  }
  const omittedFields = plan.fields.filter(
    (field) => field.skipReason === "model_action_missing",
  );
  if (omittedFields.length > 0) {
    throw new Error(
      `The LLM omitted branch-variant actions for: ${omittedFields.map((field) => field.label).join(", ")}.`,
    );
  }
  const semanticRecord = await writeSemanticGenerationRecord({
    dataRoot: generatedRoot,
    runId: recordId,
    observation: scopedCapture.observation,
    screenshot: scopedCapture.screenshot,
    proposal: generated.proposal,
    provenance: generated.provenance,
    safety,
    events: stateEvents,
  });
  let stored = await writeAndLoadPlan(
    statePlansRoot,
    recordId,
    plan,
    {
      schemaVersion: 1,
      kind: "generated_same_page_branch_variant",
      scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
      proposalId: plan.proposalId,
      model: plan.model,
      promptVersion: plan.promptVersion,
      sourceHash: sha256(planSource(plan)),
      generatedAt: new Date().toISOString(),
      semanticRecord,
      branchTrigger: trigger,
    },
  );
  const nestedProbes = await executeChoiceProbes({
    page,
    toolbox,
    plan: stored.plan,
    beforeCapture: capture,
    existingContract,
    priorStates,
    fixtureAuthorities,
    authorizeWrites,
    onEvent,
    generatedRoot,
    statePlansRoot,
    dynamicsRoot,
    evidenceSequenceStart,
    branchDepth: 1,
    recordPrefix: `${recordId}_nested`,
    onSupportedVariant: null,
  });
  if (!nestedProbes.complete) {
    throw new Error(
      nestedProbes.haltReason ||
        "A nested branch probe could not be verified; only one same-page branch level is supported.",
    );
  }
  if (nestedProbes.coverage.length > 0) {
    plan = nestedProbes.plan;
    stored = await writeAndLoadPlan(
      statePlansRoot,
      `${recordId}_resolved`,
      assertExecutablePlanSafety(plan),
      {
        schemaVersion: 1,
        kind: "generated_same_page_branch_variant_after_choice_probes",
        scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
        proposalId: plan.proposalId,
        model: plan.model,
        promptVersion: plan.promptVersion,
        sourceHash: sha256(planSource(plan)),
        generatedAt: new Date().toISOString(),
        semanticRecord,
        branchTrigger: trigger,
      },
    );
  }
  const fieldResults = await enterPlanFields({
    page,
    toolbox,
    plan: stored.plan,
    authorizeWrites,
    onEvent,
    source: `branch-variant:${plan.proposalId}`,
  });
  const requiredFailures = fieldResults.filter(
    (result) =>
      result.field.required &&
      (!result.outcome.verified || result.outcome.skipped),
  );
  if (requiredFailures.length > 0) {
    throw new Error(
      `Required branch-variant field verification failed for: ${requiredFailures.map((result) => result.field.label).join(", ")}.`,
    );
  }
  const populatedEvidence = await captureEvidence({
    page,
    plan: stored.plan,
    fieldResults,
    sequence:
      evidenceSequenceStart + nestedProbes.evidence.length,
    kind: "branch_variant_populated",
    label: `First-level variant ${trigger.fieldKey}=${String(trigger.value)} populated and verified`,
    onEvent,
  });
  return {
    plan: stored.plan,
    proposal: generated.proposal,
    provenance: generated.provenance,
    evidence: [...nestedProbes.evidence, populatedEvidence],
    actions: [
      ...nestedProbes.coverage.map((row, index) => ({
        category: "choice_probe",
        label: `${row.label}: ${String(row.value)}`,
        strategy: "stored deterministic nested option probe",
        timestamp: new Date().toISOString(),
        classification: "deterministic",
        rationale:
          row.assessment?.rationale ||
          "The branch-variant script retained this deterministic option probe.",
        source: `generated:${plan.proposalId}@${plan.scriptVersion}`,
        testValue: row.value,
        outcome: row.status === "verified" ? "landed" : "could_not_test",
        stateId: nestedProbes.evidence[index]?.id,
      })),
      ...generatedFieldActions(
        stored.plan,
        fieldResults,
        populatedEvidence.id,
      ),
    ],
    observedFields: generatedObservedFields(stored.plan, fieldResults),
    fieldsEntered: fieldResults.filter((result) => result.outcome.verified)
      .length,
    entryFailures: countEntryFailures(fieldResults),
  };
}

async function executeChoiceProbes({
  page,
  toolbox,
  plan,
  beforeCapture,
  existingContract,
  priorStates,
  authorizeWrites,
  onEvent,
  generatedRoot,
  statePlansRoot,
  dynamicsRoot,
  evidenceSequenceStart,
  branchDepth,
  recordPrefix,
  fixtureAuthorities = null,
  onSupportedVariant = generateAndExecuteBranchVariant,
}) {
  const coverage = [];
  const evidence = [];
  const variantActions = [];
  const variantObservedFields = [];
  const variantProposals = [];
  const variantProvenance = [];
  let variantFieldsEntered = 0;
  let variantEntryFailures = 0;
  const selectedValues = new Map();
  let haltReason = "";
  let probeBaseline = beforeCapture;
  for (const field of plan.fields) {
    if (!field.actuate || !field.probeValues?.length) continue;
    let selectedReveal = null;
    const fieldBaseline = probeBaseline;
    for (const [probeIndex, value] of field.probeValues.entries()) {
      await onEvent?.(
        "choice_probe_started",
        `Executing deterministic option probe for ${field.label}: ${String(value)}.`,
        {
          fieldKey: field.key,
          value,
          branchDepth,
          proposalId:
            field.probeRationales?.[probeIndex]?.proposalId || null,
          rationale:
            field.probeRationales?.[probeIndex]?.rationale ||
            "Deterministically derived exhaustive option probe.",
        },
      );
      const outcome = await withOuterWriteWindow(
        authorizeWrites,
        "same-origin",
        `deterministic choice probe ${field.key}=${String(value)}`,
        () =>
          toolbox.writeControl(
            { selectors: field.selectors },
            field.controlType,
            field.options.map((option) => option.value),
            value,
          ),
      );
      await toolbox.settle();
      let assessment = null;
      let revealed = [];
      let changed = [];
      let afterCapture = null;
      if (outcome.verified) {
        afterCapture = await captureNovelStateInput({
          page,
          toolbox,
          existingContract,
          priorStates,
        });
        revealed = uniqueObservedControls([
          ...newlyVisibleControls(
            probeBaseline.observation,
            afterCapture.observation,
          ),
          ...newlyVisibleControls(
            fieldBaseline.observation,
            afterCapture.observation,
          ),
        ]);
        changed = uniqueObservedControls([
          ...visibleControlSemanticChanges(
            probeBaseline.observation,
            afterCapture.observation,
          ),
          ...visibleControlSemanticChanges(
            fieldBaseline.observation,
            afterCapture.observation,
          ),
        ]);
        if (revealed.length > 0 || changed.length > 0) {
          const assessed = await assessDynamics({
            transitionKind: "same_page_visibility_change",
            beforeCapture: fieldBaseline,
            afterCapture,
            trigger: {
              fieldKey: field.key,
              label: field.label,
              value,
            },
            enteredValues: [{ fieldKey: field.key, value }],
            branchDepth: branchDepth + 1,
            onEvent,
            dynamicsRoot,
            recordId: `${recordPrefix}_${field.key}_${probeIndex + 1}`,
          });
          assessment = assessed.assessment;
          if (
            ["same_page_branch", "same_page_companion"].includes(
            assessment.outcome,
          ) &&
            selectedReveal === null
          ) {
            selectedReveal = value;
          }
        }
      }
      const classification = !outcome.verified
        ? "failed"
        : assessment?.outcome || "no_change";
      const row = {
        fieldKey: field.key,
        label: field.label,
        value,
        status: outcome.verified ? "verified" : "failed",
        readbackVerified: outcome.verified,
        classification,
        revealedControls: revealed.map((control) => ({
          factId: control.factId,
          name: control.name,
          id: control.id,
          rawLabel: control.rawLabel,
          rawType: control.rawType,
          required: control.required,
        })),
        changedControls: changed.map((control) => ({
          factId: control.factId,
          name: control.name,
          id: control.id,
          rawLabel: control.rawLabel,
          rawType: control.rawType,
          required: control.required,
        })),
        assessment,
        failureCode: outcome.failureCode || null,
        detail: outcome.detail || "",
      };
      const probeEvidence = await captureEvidence({
          page,
          plan,
          fieldResults: [probeFieldResult(field, value, outcome)],
          sequence: evidenceSequenceStart + evidence.length,
          kind: "choice_probe",
          label: `${field.label}: ${String(value)} — ${classification}`,
          onEvent,
        });
      evidence.push(probeEvidence);
      row.evidenceId = probeEvidence.id;
      if (!outcome.verified) {
        haltReason = `Choice probe failed for ${field.label}: ${outcome.detail || outcome.failureCode || "unverified"}.`;
        await onEvent?.(
          "probe_actuation_failed",
          haltReason,
          {
            fieldKey: field.key,
            value,
            failureCode:
              outcome.failureCode || "actuation_unverified",
            detail: outcome.detail || "",
            evidenceId: probeEvidence.id,
          },
        );
      } else if (
        (revealed.length > 0 || changed.length > 0) &&
        !["same_page_branch", "same_page_companion"].includes(
          assessment?.outcome,
        )
      ) {
        haltReason = `New controls appeared after probing ${field.label}, but the LLM could not classify them as a supported first-level branch or companion.`;
      } else if (
        (revealed.length > 0 || changed.length > 0) &&
        branchDepth >= MAX_SAME_PAGE_BRANCH_DEPTH
      ) {
        haltReason = `A second-level same-page conditional reveal was detected after ${field.label}; only one level is supported.`;
      } else if (
        onSupportedVariant &&
        afterCapture &&
        (revealed.length > 0 || changed.length > 0)
      ) {
        try {
          const variant = await onSupportedVariant({
            page,
            toolbox,
            capture: afterCapture,
            revealedControls: revealed,
            changedControls: changed,
            trigger: {
              fieldKey: field.key,
              label: field.label,
              value,
              classification,
              assessmentId: assessment?.assessmentId || null,
            },
            existingContract,
            priorStates,
            fixtureAuthorities,
            authorizeWrites,
            onEvent,
            generatedRoot,
            statePlansRoot,
            dynamicsRoot,
            recordId: `${recordPrefix}_${safeSegment(field.key)}_${probeIndex + 1}_variant`,
            evidenceSequenceStart:
              evidenceSequenceStart + evidence.length,
          });
          row.variantPlan = variant.plan;
          row.variantProposalId = variant.proposal.proposalId;
          row.variantSourceFactIds = [
            ...new Set(
              variant.proposal.fields.flatMap(
                (variantField) => variantField.sourceFactIds,
              ),
            ),
          ].sort();
          variantActions.push(...variant.actions);
          variantObservedFields.push(...variant.observedFields);
          variantProposals.push(variant.proposal);
          variantProvenance.push(variant.provenance);
          variantFieldsEntered += variant.fieldsEntered;
          variantEntryFailures += variant.entryFailures;
          evidence.push(...variant.evidence);
          await onEvent?.(
            "same_page_branch_variant_verified",
            `Generated, populated, and verified first-level variant ${field.label}: ${String(value)}.`,
            {
              fieldKey: field.key,
              value,
              classification,
              proposalId: variant.proposal.proposalId,
              fields: variant.plan.fields.map((variantField) => ({
                key: variantField.key,
                label: variantField.label,
                controlType: variantField.controlType,
              })),
            },
          );
        } catch (error) {
          haltReason = `First-level variant ${field.label}: ${String(value)} could not be generated and verified: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      coverage.push(row);
      await onEvent?.(
        outcome.verified ? "choice_probe_completed" : "choice_probe_failed",
        outcome.verified
          ? `Verified option probe ${field.label}: ${String(value)} (${classification}).`
          : `Could not verify option probe ${field.label}: ${String(value)}.`,
        {
          fieldKey: row.fieldKey,
          label: row.label,
          value: row.value,
          status: row.status,
          readbackVerified: row.readbackVerified,
          classification: row.classification,
          revealedControls: row.revealedControls,
          changedControls: row.changedControls,
          assessment: row.assessment,
          failureCode: row.failureCode,
          detail: row.detail,
          variantProposalId: row.variantProposalId || null,
          assessmentId: assessment?.assessmentId || null,
        },
      );
      if (haltReason) break;
      if (afterCapture) {
        probeBaseline = await captureNovelStateInput({
          page,
          toolbox,
          existingContract,
          priorStates,
        });
      }
    }
    if (haltReason) break;
    if (selectedReveal !== null) selectedValues.set(field.key, selectedReveal);
  }
  const resolvedPlan = {
    ...plan,
    fields: plan.fields.map((field) =>
      selectedValues.has(field.key)
        ? {
            ...field,
            testValue: selectedValues.get(field.key),
          }
        : field,
    ),
    choiceCoverage: coverage,
    samePageBranchDepth: branchDepth,
  };
  return {
    plan: resolvedPlan,
    coverage,
    evidence,
    variantActions,
    variantObservedFields,
    variantProposals,
    variantProvenance,
    variantFieldsEntered,
    variantEntryFailures,
    complete:
      !haltReason &&
      choiceProbeCoverageIssues(plan).length === 0 &&
      coverage.every((row) => row.status === "verified"),
    haltReason,
  };
}

async function replayChoiceProbes({
  page,
  toolbox,
  plan,
  executionMode,
  fixtureAuthorities,
  authorizeWrites,
  onEvent,
  evidenceSequenceStart,
}) {
  if (!(plan.choiceCoverage || []).length) {
    return {
      actions: [],
      evidence: [],
      observedFields: [],
      fieldsEntered: 0,
      entryFailures: 0,
    };
  }
  let baseline = await captureNovelStateInput({
    page,
    toolbox,
    existingContract: null,
    priorStates: [],
  });
  const actions = [];
  const evidence = [];
  const observedFields = [];
  let fieldsEntered = 0;
  let entryFailures = 0;
  for (const [index, expected] of plan.choiceCoverage.entries()) {
    const field = plan.fields.find((item) => item.key === expected.fieldKey);
    if (!field) {
      throw new Error(
        `Retained choice probe references unknown field ${expected.fieldKey}.`,
      );
    }
    const outcome = await withOuterWriteWindow(
      authorizeWrites,
      "same-origin",
      `retained deterministic choice probe ${field.key}=${String(expected.value)}`,
      () =>
        toolbox.writeControl(
          { selectors: field.selectors },
          field.controlType,
          field.options.map((option) => option.value),
          expected.value,
        ),
    );
    await toolbox.settle();
    const after = await captureNovelStateInput({
      page,
      toolbox,
      existingContract: null,
      priorStates: [],
    });
    const revealed = newlyVisibleControls(
      baseline.observation,
      after.observation,
    );
    const changed = visibleControlSemanticChanges(
      baseline.observation,
      after.observation,
    );
    const expectedReveal = [
      "same_page_branch",
      "same_page_companion",
    ].includes(expected.classification);
    const declaredVariantVisibility =
      expectedReveal && expected.variantPlan?.fields?.length
        ? await Promise.all(
            expected.variantPlan.fields.map((variantField) =>
              toolbox.isVisible({
                selectors: variantField.selectors,
              }),
            ),
          )
        : null;
    const visibilityVerified = expectedReveal
      ? declaredVariantVisibility
        ? declaredVariantVisibility.every(Boolean)
        : revealed.length > 0 || changed.length > 0
      : expected.classification === "no_change"
        ? revealed.length === 0 && changed.length === 0
        : true;
    if (!outcome.verified || !visibilityVerified) {
      throw new Error(
        `Retained choice probe did not reproduce ${field.key}=${String(expected.value)} (${expected.classification}).`,
      );
    }
    const state = await captureEvidence({
      page,
      plan,
      fieldResults: [probeFieldResult(field, expected.value, outcome)],
      sequence: evidenceSequenceStart + evidence.length,
      kind: "choice_probe",
      label: `${field.label}: ${String(expected.value)} — replayed ${expected.classification}`,
      onEvent,
    });
    evidence.push(state);
    actions.push({
      category: "choice_probe",
      label: `${field.label}: ${String(expected.value)}`,
      strategy: "retained deterministic exhaustive option probe",
      timestamp: new Date().toISOString(),
      classification: "deterministic_replay",
      rationale:
        expected.assessment?.rationale ||
        "Replayed an option probe derived from the observed option inventory.",
      source: `generated:${plan.proposalId}@${plan.scriptVersion}`,
      testValue: expected.value,
      outcome: "landed",
      stateId: state.id,
    });
    if (expected.variantPlan) {
      const variantPlan = expected.variantPlan;
      assertExecutablePlanSafety(variantPlan);
      assertReplayAuthorities(
        variantPlan,
        executionMode,
        fixtureAuthorities,
      );
      const nested = await replayChoiceProbes({
        page,
        toolbox,
        plan: variantPlan,
        executionMode,
        fixtureAuthorities,
        authorizeWrites,
        onEvent,
        evidenceSequenceStart:
          evidenceSequenceStart + evidence.length,
      });
      actions.push(...nested.actions);
      evidence.push(...nested.evidence);
      observedFields.push(...nested.observedFields);
      fieldsEntered += nested.fieldsEntered;
      entryFailures += nested.entryFailures;
      const variantResults = await enterPlanFields({
        page,
        toolbox,
        plan: variantPlan,
        authorizeWrites,
        onEvent,
        source: `replay-branch-variant:${plan.proposalId}@${plan.scriptVersion}`,
      });
      const requiredFailure = variantResults.find(
        (result) =>
          result.field.required &&
          (!result.outcome.verified || result.outcome.skipped),
      );
      if (requiredFailure) {
        throw new Error(
          `Retained branch variant failed required field ${requiredFailure.field.key}.`,
        );
      }
      const variantEvidence = await captureEvidence({
        page,
        plan: variantPlan,
        fieldResults: variantResults,
        sequence: evidenceSequenceStart + evidence.length,
        kind: "branch_variant_populated",
        label: `Replayed first-level variant ${field.label}: ${String(expected.value)}`,
        onEvent,
      });
      evidence.push(variantEvidence);
      const variantFieldActions = generatedFieldActions(
        variantPlan,
        variantResults,
        variantEvidence.id,
      ).map((action) => ({
        ...action,
        strategy: "retained LLM-authored branch-variant script",
        classification: "deterministic_replay",
      }));
      actions.push(...variantFieldActions);
      observedFields.push(
        ...generatedObservedFields(variantPlan, variantResults),
      );
      fieldsEntered += variantResults.filter(
        (result) => result.outcome.verified,
      ).length;
      entryFailures += countEntryFailures(variantResults);
    }
    await onEvent?.(
      "choice_probe_replay_completed",
      `Replayed and verified ${field.label}: ${String(expected.value)}.`,
      {
        fieldKey: field.key,
        value: expected.value,
        expectedClassification: expected.classification,
        revealedControls: revealed.length,
        changedControls: changed.length,
        declaredVariantControlsVisible:
          declaredVariantVisibility?.filter(Boolean).length || 0,
        variantFields:
          expected.variantPlan?.fields?.length || 0,
      },
    );
    baseline = await captureNovelStateInput({
      page,
      toolbox,
      existingContract: null,
      priorStates: [],
    });
  }
  return {
    actions,
    evidence,
    observedFields,
    fieldsEntered,
    entryFailures,
  };
}

async function populateSelectedBranchVariants({
  page,
  toolbox,
  plan,
  authorizeWrites,
  onEvent,
  evidenceSequenceStart,
  source,
}) {
  const actions = [];
  const evidence = [];
  const observedFields = [];
  let fieldsEntered = 0;
  let entryFailures = 0;
  for (const coverage of plan.choiceCoverage || []) {
    if (!coverage.variantPlan) continue;
    const parentField = plan.fields.find(
      (field) => field.key === coverage.fieldKey,
    );
    if (
      !parentField ||
      scalarKey(parentField.testValue) !== scalarKey(coverage.value)
    ) {
      continue;
    }
    const variantPlan = coverage.variantPlan;
    assertExecutablePlanSafety(variantPlan);
    const variantResults = await enterPlanFields({
      page,
      toolbox,
      plan: variantPlan,
      authorizeWrites,
      onEvent,
      source,
    });
    const requiredFailure = variantResults.find(
      (result) =>
        result.field.required &&
        (!result.outcome.verified || result.outcome.skipped),
    );
    if (requiredFailure) {
      throw new Error(
        `Final selected branch variant failed required field ${requiredFailure.field.key}.`,
      );
    }
    const variantEvidence = await captureEvidence({
      page,
      plan: variantPlan,
      fieldResults: variantResults,
      sequence: evidenceSequenceStart + evidence.length,
      kind: "selected_branch_populated",
      label: `Final selected variant ${parentField.label}: ${String(coverage.value)} populated and verified`,
      onEvent,
    });
    evidence.push(variantEvidence);
    actions.push(
      ...generatedFieldActions(
        variantPlan,
        variantResults,
        variantEvidence.id,
      ).map((action) => ({
        ...action,
        strategy: "final selected LLM-authored branch-variant script",
        classification: "deterministic_replay",
      })),
    );
    observedFields.push(
      ...generatedObservedFields(variantPlan, variantResults),
    );
    fieldsEntered += variantResults.filter(
      (result) => result.outcome.verified,
    ).length;
    entryFailures += countEntryFailures(variantResults);
    await onEvent?.(
      "selected_branch_variant_repopulated",
      `Repopulated the LLM-authored final selected variant ${parentField.label}: ${String(coverage.value)} after parent-field entry.`,
      {
        fieldKey: parentField.key,
        value: coverage.value,
        variantFields: variantPlan.fields.map((field) => field.key),
        evidenceId: variantEvidence.id,
      },
    );
  }
  return {
    actions,
    evidence,
    observedFields,
    fieldsEntered,
    entryFailures,
  };
}

async function clearInactiveBranchVariantFields({
  toolbox,
  plan,
  onEvent,
}) {
  const activeVariantKeys = new Set();
  for (const coverage of plan.choiceCoverage || []) {
    if (!coverage.variantPlan) continue;
    const parentField = plan.fields.find(
      (field) => field.key === coverage.fieldKey,
    );
    if (
      parentField &&
      scalarKey(parentField.testValue) === scalarKey(coverage.value)
    ) {
      for (const field of coverage.variantPlan.fields || []) {
        activeVariantKeys.add(field.key);
      }
    }
  }
  const cleared = new Set();
  for (const coverage of plan.choiceCoverage || []) {
    if (!coverage.variantPlan) continue;
    const parentField = plan.fields.find(
      (field) => field.key === coverage.fieldKey,
    );
    if (
      !parentField ||
      scalarKey(parentField.testValue) === scalarKey(coverage.value)
    ) {
      continue;
    }
    for (const field of coverage.variantPlan.fields || []) {
      if (activeVariantKeys.has(field.key) || cleared.has(field.key)) continue;
      const outcome = await toolbox.clearControl(
        { selectors: field.selectors },
        field.controlType,
      );
      if (!outcome.verified) {
        throw new Error(
          `Could not clear inactive branch field ${field.key}: ${outcome.detail}`,
        );
      }
      cleared.add(field.key);
      await onEvent?.(
        "inactive_branch_field_cleared",
        `Cleared inactive LLM-authored branch field ${field.label}.`,
        {
          fieldKey: field.key,
          parentFieldKey: parentField.key,
          inactiveValue: coverage.value,
        },
      );
    }
  }
  return [...cleared];
}

function observedField(field, plan, result, stateKey) {
  const section = (plan.sections || []).find(
    (item) => item.key === field.sectionKey,
  );
  return {
    key: field.key,
    name: field.rawIdentity.name,
    id: field.rawIdentity.id,
    label: field.label,
    control: field.controlType,
    required: field.required,
    sensitive: field.sensitive,
    sensitivityDecision: field.sensitivityDecision || null,
    hidden: false,
    options: field.options.length,
    optionSet: field.options,
    optionValues: field.options.map((option) => option.value),
    selector: field.selectors[0] || "",
    selectorCandidates: field.selectors,
    frameUrl: "",
    rendered: true,
    requiredSource: field.required ? "llm_and_dom" : "not_observed",
    validation: field.validation || {},
    upload: field.upload || {},
    consent: ["consent", "acknowledgement"].includes(
      field.legalAcceptanceType,
    ),
    adminAssisted:
      field.administrative ||
      ["reviewConfirmation", "signature"].includes(
        field.legalAcceptanceType,
      ),
    legalAcceptanceType: field.legalAcceptanceType || "",
    canonicalProfileKey: CANONICAL_PROFILE_KEYS.has(field.key)
      ? field.key
      : "unmappable",
    sectionText: section?.label || "",
    sectionId: field.sectionKey || "",
    guidanceIds: field.guidanceRefs || [],
    questionRef: field.key,
    formId: stateKey,
    testValue: field.testValue,
    testValueSource: `generated:${plan.proposalId}`,
    entryStatus: result?.outcome.verified ? "entered" : "not_attempted",
    entryError: result?.outcome.detail || "",
    originState: stateKey,
  };
}

function generatedFieldActions(plan, fieldResults, stateId) {
  return plan.fields.map((field) => {
    const result = fieldResults.find((item) => item.field.key === field.key);
    return {
      category: "field_entry",
      label: field.label,
      strategy: "stored LLM-authored field action",
      timestamp: new Date().toISOString(),
      classification: "llm_generated_probe",
      rationale: field.rationale,
      source: `generated:${plan.proposalId}@${plan.scriptVersion}`,
      testValue: field.testValue,
      outcome: result?.outcome.verified ? "landed" : "could_not_test",
      stateId,
      ...(!result?.outcome.verified
        ? {
            failureCode:
              result?.outcome.failureCode || field.skipReason || "could_not_test",
            error:
              result?.outcome.detail ||
              "The generated field action could not be verified.",
          }
        : {}),
    };
  });
}

function generatedObservedFields(plan, fieldResults) {
  return plan.fields.map((field) =>
    observedField(
      field,
      plan,
      fieldResults.find((item) => item.field.key === field.key),
      plan.state.key,
    ),
  );
}

function countEntryFailures(fieldResults) {
  return fieldResults.filter(
    (result) =>
      !result.outcome.verified &&
      (!result.outcome.skipped || result.field.required),
  ).length;
}

export function mergeTraversalResults(...parts) {
  const available = parts.filter(Boolean);
  const last = available.at(-1) || {};
  const journeyUrls = [
    ...new Set(available.flatMap((part) => part.journeyUrls || [])),
  ];
  return {
    actions: available.flatMap((part) => part.actions || []),
    evidence: available.flatMap((part) => part.evidence || []),
    observedFields: available.flatMap((part) => part.observedFields || []),
    fieldsEntered: available.reduce(
      (sum, part) => sum + (part.fieldsEntered || 0),
      0,
    ),
    entryFailures: available.reduce(
      (sum, part) => sum + (part.entryFailures || 0),
      0,
    ),
    branchStates: available.reduce(
      (sum, part) => sum + (part.branchStates || 0),
      0,
    ),
    stateExaminations: Math.max(
      0,
      ...available.map((part) => part.stateExaminations || 0),
    ),
    submissionsAttempted: available.reduce(
      (sum, part) => sum + (part.submissionsAttempted || 0),
      0,
    ),
    submissionsSucceeded: available.reduce(
      (sum, part) => sum + (part.submissionsSucceeded || 0),
      0,
    ),
    submissionResult: last.submissionResult || null,
    finalSubmission: last.finalSubmission || "not_requested",
    certificationStatus: last.certificationStatus || "could_not_test",
    reconScriptId: last.reconScriptId || "",
    reconScriptVersion: last.reconScriptVersion || 0,
    generatedArtifact: last.generatedArtifact || null,
    browserMode: last.browserMode,
    journeyUrls,
    entryMode: last.entryMode || available[0]?.entryMode || "unknown",
    entryDetail:
      last.entryDetail || available[0]?.entryDetail || "",
    journeyComplete: available.every(
      (part) => part.journeyComplete !== false,
    ),
    haltReason: last.haltReason || "",
  };
}

function generatedBranchStateCount(plan) {
  return (plan?.states || []).reduce(
    (count, state) =>
      count +
      (state.progression?.dynamicContinuation ? 1 : 0) +
      (state.choiceCoverage || []).filter((coverage) => coverage.variantPlan)
        .length,
    0,
  );
}

export function terminalEligibilityIssues(completePlan) {
  const issues = [];
  for (const state of completePlan?.states || []) {
    if (
      Number(state.samePageBranchDepth || 0) >
      MAX_SAME_PAGE_BRANCH_DEPTH
    ) {
      issues.push({
        code: "same_page_branch_depth_exceeded",
        stateKey: state.state?.key || "",
        detail: `Same-page branch depth ${state.samePageBranchDepth} exceeds ${MAX_SAME_PAGE_BRANCH_DEPTH}.`,
      });
    }
    const expectedRows = state.fields.flatMap((field) =>
      expectedDependencyProbeValues(field).map((value) => ({
        fieldKey: field.key,
        value,
      })),
    );
    for (const expected of expectedRows) {
      const observed = (state.choiceCoverage || []).find(
        (row) =>
          row.fieldKey === expected.fieldKey &&
          scalarKey(row.value) === scalarKey(expected.value),
      );
      if (!observed || observed.status !== "verified") {
        issues.push({
          code: "choice_probe_incomplete",
          stateKey: state.state?.key || "",
          fieldKey: expected.fieldKey,
          detail: `Required choice probe ${expected.fieldKey}=${String(expected.value)} was not verified.`,
        });
      } else if (
        ["same_page_branch", "same_page_companion"].includes(
          observed.classification,
        ) &&
        !observed.variantPlan
      ) {
        issues.push({
          code: "same_page_branch_variant_missing",
          stateKey: state.state?.key || "",
          fieldKey: expected.fieldKey,
          detail: `Supported first-level variant ${expected.fieldKey}=${String(expected.value)} has no generated variant script.`,
        });
      }
    }
    for (const coverage of state.choiceCoverage || []) {
      if (coverage.variantPlan) {
        issues.push(
          ...terminalEligibilityIssues({
            states: [coverage.variantPlan],
          }),
        );
      }
    }
    if (
      state.progression?.kind === "advance" &&
      state.progression?.dynamicContinuation !== true &&
      state.variantOnly !== true
    ) {
      const assessment = state.crossPageAssessment;
      if (!assessment || assessment.outcome !== "independent") {
        issues.push({
          code:
            assessment?.outcome === "cross_page_dependency"
              ? "cross_page_branching"
              : "cross_page_dependency_unverified",
          stateKey: state.state?.key || "",
          detail: assessment
            ? `Intermediate transition was classified ${assessment.outcome}.`
            : "Intermediate transition has no retained cross-page assessment.",
        });
      }
    }
  }
  return issues;
}

export function assertTerminalEligible(completePlan) {
  const issues = terminalEligibilityIssues(completePlan);
  if (issues.length > 0) {
    throw new Error(
      `Terminal submission is ineligible: ${issues.map((issue) => issue.detail).join(" ")}`,
    );
  }
  return completePlan;
}

async function couldNotTestGeneratedState({
  page,
  plan,
  fieldResults,
  onEvent,
  detail,
  stateExaminations = 0,
  priorResult = null,
  journeyUrls = [],
}) {
  const evidence = await captureEvidence({
    page,
    plan,
    fieldResults,
    sequence: (priorResult?.evidence?.length || 0) + 1,
    kind: "populated",
    label: `Generated traversal halted safely: ${detail}`,
    onEvent,
  });
  const actions = generatedFieldActions(plan, fieldResults, evidence.id);
  await onEvent?.(
    "generated_script_could_not_test",
    detail,
    {
      stateKey: plan.state.key,
      evidenceId: evidence.id,
      failures: actions
        .filter((action) => action.outcome === "could_not_test")
        .map((action) => ({
          label: action.label,
          failureCode: action.failureCode,
          error: action.error,
        })),
    },
  );
  const currentResult = {
    actions,
    evidence: [evidence],
    observedFields: generatedObservedFields(plan, fieldResults),
    fieldsEntered: fieldResults.filter((result) => result.outcome.verified)
      .length,
    entryFailures: countEntryFailures(fieldResults),
    branchStates: 0,
    stateExaminations,
    submissionsAttempted: 0,
    submissionsSucceeded: 0,
    finalSubmission: "not_requested",
    certificationStatus: "could_not_test",
    reconScriptId: "",
    reconScriptVersion: 0,
    generatedArtifact: null,
    journeyUrls,
    journeyComplete: false,
    haltReason: detail,
  };
  return mergeTraversalResults(priorResult, currentResult);
}

function visibleApplicantControls(observation) {
  return (observation?.controls || []).filter(
    (control) =>
      control.visible &&
      !["button", "hidden", "image", "reset", "submit"].includes(
        String(control.rawType || control.tag || "").toLowerCase(),
      ),
  );
}

async function assessUnexpectedResultPage({
  page,
  captured,
  onEvent,
}) {
  if (visibleApplicantControls(captured.observation).length > 0) return null;
  const observation = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    url: page.url(),
    title: captured.observation.title || "",
    heading: captured.observation.heading || "",
    bodyText: await page
      .locator("body")
      .innerText()
      .then((value) => value.slice(0, 20_000))
      .catch(() => ""),
    accessibilitySnapshot:
      captured.observation.accessibilitySnapshot || "",
    navigationStatus: null,
    submitEventObserved: null,
    stateChanged: true,
  };
  try {
    const generated = await generateSubmissionResultAssessment(
      {
        observation,
        screenshot: captured.screenshot,
      },
      {
        log: async (kind, metadata) =>
          onEvent?.(
            kind,
            kind === "submission_result_assessment_started"
              ? "The LLM is checking whether the LLM-authored advance landed on an explicit result page."
              : kind === "submission_result_assessment_completed"
                ? `The LLM classified the post-advance page as ${metadata.outcome}.`
                : "The LLM could not classify the post-advance page.",
            { ...metadata, context: "post_advance_result_check" },
          ),
      },
    );
    if (
      generated.assessment.confidence !== "high" ||
      !["success", "failure"].includes(generated.assessment.outcome)
    ) {
      return null;
    }
    return generated;
  } catch (error) {
    await onEvent?.(
      "post_advance_result_check_failed",
      "The post-advance result check was inconclusive; normal state classification will continue.",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return null;
  }
}

function approvedRedactionCandidates(redactionValues) {
  return [
    ...new Set(
      redactionValues
        .filter((value) => ["string", "number"].includes(typeof value))
        .map((value) => String(value).trim())
        .filter((value) => value.length >= 3)
        .flatMap((value) => {
          const encoded = encodeURIComponent(value);
          return [value, encoded, encoded.replaceAll("%20", "+")];
        }),
    ),
  ].sort((left, right) => right.length - left.length);
}

export function redactApprovedObservationText(
  value,
  redactionValues = [],
) {
  let redacted = String(value || "");
  for (const candidate of approvedRedactionCandidates(redactionValues)) {
    redacted = redacted.split(candidate).join("[REDACTED]");
  }
  return redacted;
}

async function submitCrawlTerminal({
  page,
  toolbox,
  plan,
  authorizeWrites,
  onEvent,
  storedResultCriteria = null,
  allowResultModel = false,
  approvedLive = false,
  redactionValues = [],
}) {
  const beforeCount = await page
    .evaluate(() =>
      Number.parseInt(
        sessionStorage.getItem("__formweaveSubmitEvents") || "0",
        10,
      ),
    )
    .catch(() => 0);
  const beforeUrl = page.url();
  const beforeBody = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  const requestEventStart = toolbox.requestEvents.length;
  const navigation = page
    .waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: 10_000,
    })
    .catch(() => null);
  await permitBrowserSubmit(page);
  const click = await withOuterWriteWindow(
    authorizeWrites,
    "final-action",
    `${approvedLive ? "approved live" : "explicit synthetic crawl"} submit ${plan.progression.key}`,
    () =>
      toolbox.clickAction({
        selectors: plan.progression.selectors,
      }),
    new URL(page.url()).origin,
  );
  await toolbox.settle();
  const navigationResponse = await navigation;
  const afterCount = await page
    .evaluate(() =>
      Number.parseInt(
        sessionStorage.getItem("__formweaveSubmitEvents") || "0",
        10,
      ),
    )
    .catch(() => beforeCount);
  const afterUrl = page.url();
  const rawAfterBody = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  const writeRequestObserved = toolbox.requestEvents
    .slice(requestEventStart)
    .some(
      (event) =>
        event.permitted === true &&
        ["POST", "PUT", "PATCH"].includes(event.method),
    );
  const verification = verifyFixtureSubmissionOutcome({
    clicked: click.clicked,
    submitEventObserved: afterCount > beforeCount,
    writeRequestObserved,
    navigationStatus: navigationResponse?.status() ?? null,
    beforeUrl,
    afterUrl,
    beforeBody,
    afterBody: rawAfterBody,
  });
  const normalizedRedactions =
    approvedRedactionCandidates(redactionValues);
  const redactObservedText = (value) =>
    redactApprovedObservationText(value, redactionValues);
  if (normalizedRedactions.length) {
    await page
      .evaluate((values) => {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
          let text = node.nodeValue || "";
          for (const value of values) {
            text = text.split(value).join("[REDACTED]");
          }
          node.nodeValue = text;
        }
        for (const control of document.querySelectorAll(
          "input, textarea, select",
        )) {
          if (control instanceof HTMLInputElement) {
            if (["checkbox", "radio"].includes(control.type)) {
              control.checked = false;
            } else {
              control.value = "";
            }
          } else if (
            control instanceof HTMLTextAreaElement ||
            control instanceof HTMLSelectElement
          ) {
            control.value = "";
          }
        }
      }, normalizedRedactions)
      .catch(() => null);
  }
  const afterBody = await page
    .locator("body")
    .innerText()
    .catch(() => rawAfterBody);
  const resultTitle = redactObservedText(
    await page.title().catch(() => ""),
  );
  const resultHeading = redactObservedText(
    await page
      .locator("h1, [role=heading]")
      .first()
      .innerText()
      .catch(() => ""),
  );
  const resultScreenshot = await page.screenshot({
    fullPage: true,
    type: "png",
  });
  const resultObservation = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    url: redactObservedText(page.url()),
    title: resultTitle,
    heading: resultHeading,
    bodyText: redactObservedText(afterBody).slice(0, 20_000),
    accessibilitySnapshot: await toolbox.senseAccessibility(),
    navigationStatus: verification.navigationStatus,
    submitEventObserved: afterCount > beforeCount,
    stateChanged: verification.stateChanged,
  };
  let semanticResult = {
    verified: false,
    outcome: "unknown",
    source: storedResultCriteria
      ? "stored_llm_criteria"
      : "result_assessment_unavailable",
    detail: storedResultCriteria
      ? "Stored result criteria could not be evaluated."
      : "No LLM-authored result criteria were available.",
    criteria: storedResultCriteria,
  };
  if (storedResultCriteria) {
    semanticResult = verifyStoredSubmissionResultCriteria(
      storedResultCriteria,
      resultObservation,
    );
  } else if (allowResultModel) {
    try {
      const generated = await generateSubmissionResultAssessment(
        {
          observation: resultObservation,
          screenshot: resultScreenshot,
        },
        {
          log: async (kind, metadata) =>
            onEvent?.(
              kind,
              kind === "submission_result_assessment_started"
                ? "The LLM is examining the rendered post-submit result."
                : kind === "submission_result_assessment_completed"
                  ? `The LLM classified the post-submit result as ${metadata.outcome}.`
                  : "The LLM could not classify the post-submit result.",
              metadata,
            ),
        },
      );
      semanticResult = {
        ...verifyStoredSubmissionResultCriteria(
          generated.assessment,
          resultObservation,
        ),
        source: "fresh_llm_assessment",
        provenance: generated.provenance,
      };
    } catch (error) {
      semanticResult = {
        verified: false,
        outcome: "unknown",
        source: "fresh_llm_assessment",
        detail: error instanceof Error ? error.message : String(error),
        criteria: null,
      };
    }
  }
  const renderedStateVerified =
    click.clicked && verification.stateChanged && semanticResult.verified;
  const submitted =
    semanticResult.verified &&
    (verification.verified || renderedStateVerified);
  const verificationBasis = verification.verified
    ? "transport_and_rendered_result"
    : renderedStateVerified
      ? "observable_state_change_and_rendered_result"
      : "unverified";
  await onEvent?.(
    submitted
      ? "fixture_terminal_submission_completed"
      : "fixture_terminal_submission_unverified",
    submitted
      ? `Submitted ${approvedLive ? "approved form" : "crawl target"} through generated action ${plan.progression.key}.`
      : `Could not verify ${approvedLive ? "approved form" : "crawl target"} submission through ${plan.progression.key}.`,
    {
      label: plan.progression.key,
      submitEventsBefore: beforeCount,
      submitEventsAfter: afterCount,
      writeRequestObserved,
      navigationStatus: verification.navigationStatus,
      stateChanged: verification.stateChanged,
      transportVerificationDetail: verification.detail,
      renderedOutcome: semanticResult.outcome,
      resultAssessmentSource: semanticResult.source,
      resultMarkers: semanticResult.criteria?.markers || [],
      verificationBasis,
      verificationDetail: submitted
        ? verification.verified
          ? semanticResult.detail
          : `The declared control produced an observable client-side state change and the LLM verified explicit rendered success markers. ${semanticResult.detail}`.trim()
        : `${verification.detail} ${semanticResult.detail}`.trim(),
      source: `generated:${plan.proposalId}@${plan.scriptVersion}`,
    },
  );
  return {
    verified: submitted,
    outcome: semanticResult.outcome,
    source: semanticResult.source,
    detail: submitted
      ? verification.verified
        ? semanticResult.detail
        : `The declared control produced an observable client-side state change and the LLM verified explicit rendered success markers. ${semanticResult.detail}`.trim()
      : `${verification.detail} ${semanticResult.detail}`.trim(),
    criteria: semanticResult.criteria || null,
    provenance: semanticResult.provenance || null,
    transport: verification,
  };
}

export function verifyFixtureSubmissionOutcome({
  clicked,
  submitEventObserved,
  writeRequestObserved = false,
  navigationStatus,
  beforeUrl,
  afterUrl,
  beforeBody,
  afterBody,
}) {
  const transportFacts = {
    clicked: Boolean(clicked),
    submitEventObserved: Boolean(submitEventObserved),
    writeRequestObserved: Boolean(writeRequestObserved),
  };
  const status =
    typeof navigationStatus === "number" && Number.isFinite(navigationStatus)
      ? navigationStatus
      : null;
  const stateChanged =
    beforeUrl !== afterUrl ||
    String(beforeBody || "").trim() !== String(afterBody || "").trim();
  if (!clicked) {
    return {
      ...transportFacts,
      verified: false,
      navigationStatus: status,
      stateChanged,
      detail: "The declared terminal control was not actuated.",
    };
  }
  if (!submitEventObserved && !writeRequestObserved) {
    return {
      ...transportFacts,
      verified: false,
      navigationStatus: status,
      stateChanged,
      detail:
        "No browser submit event or permitted same-origin write request was observed.",
    };
  }
  if (status !== null && (status < 200 || status >= 400)) {
    return {
      ...transportFacts,
      verified: false,
      navigationStatus: status,
      stateChanged,
      detail: `The terminal navigation returned HTTP ${status}.`,
    };
  }
  if (
    !submitEventObserved &&
    writeRequestObserved &&
    status !== null &&
    !stateChanged
  ) {
    return {
      ...transportFacts,
      verified: false,
      navigationStatus: status,
      stateChanged: false,
      detail:
        "The declared action returned a successful HTTP response but produced no observable terminal state change.",
    };
  }
  if (status === null && !stateChanged) {
    return {
      ...transportFacts,
      verified: false,
      navigationStatus: null,
      stateChanged: false,
      detail:
        "The submit event fired, but no navigation response or resulting state change was observed.",
    };
  }
  return {
    ...transportFacts,
    verified: true,
    navigationStatus: status,
    stateChanged,
    detail:
      status === null
        ? "A submit event and resulting same-page state change were observed."
        : submitEventObserved
          ? `A submit event completed with HTTP ${status}.`
          : `A permitted same-origin write completed with HTTP ${status}; rendered success still requires separate LLM verification.`,
  };
}

async function replayStoredFormScript({
  page,
  stored,
  executionMode,
  fixtureAuthorities,
  browserMode,
  authorizeWrites,
  onEvent,
  entry,
}) {
  const completePlan = stored.plan;
  assertTerminalEligible(completePlan);
  const evidence = [];
  const actions = [];
  const observedFields = [];
  let fieldsEntered = 0;
  let entryFailures = 0;
  let submissionsAttempted = 0;
  let submissionsSucceeded = 0;
  let finalSubmission = "blocked";
  let submissionResult = null;
  const replayJourneyUrls = new Set([page.url()]);
  let replayFailure = "";

  try {
    for (const plan of completePlan.states) {
    assertExecutablePlanSafety(plan);
    assertReplayAuthorities(plan, executionMode, fixtureAuthorities);
    const toolbox = new PhysicsToolbox(page);
    await toolbox.prepare();
    const replayedProbes = await replayChoiceProbes({
      page,
      toolbox,
      plan,
      executionMode,
      fixtureAuthorities,
      authorizeWrites,
      onEvent,
      evidenceSequenceStart: evidence.length + 1,
    });
    actions.push(...replayedProbes.actions);
    evidence.push(...replayedProbes.evidence);
    observedFields.push(...replayedProbes.observedFields);
    fieldsEntered += replayedProbes.fieldsEntered;
    entryFailures += replayedProbes.entryFailures;
    const stateActionStart = actions.length;
    const results = await enterPlanFields({
      page,
      toolbox,
      plan,
      authorizeWrites,
      onEvent,
      source: `replay:${completePlan.artifactId}@${completePlan.scriptVersion}`,
    });
    fieldsEntered += results.filter((result) => result.outcome.verified).length;
    entryFailures += countEntryFailures(results);
    for (const field of plan.fields) {
      const result = results.find((item) => item.field.key === field.key);
      observedFields.push(observedField(field, plan, result, plan.state.key));
      actions.push({
        category: "field_entry",
        label: field.label,
        strategy: "stored LLM-authored script",
        timestamp: new Date().toISOString(),
        classification: "deterministic_replay",
        rationale: field.rationale,
        source: `generated:${completePlan.artifactId}@${completePlan.scriptVersion}`,
        testValue: field.testValue,
        outcome: result?.outcome.verified ? "landed" : "could_not_test",
        ...(result?.outcome.detail
          ? {
              failureCode: result.outcome.failureCode,
              error: result.outcome.detail,
            }
          : {}),
      });
    }
    const evidenceKind = plan.progression.dynamicContinuation
      ? "branch"
      : plan.progression.kind === "terminal_submit"
        ? executionMode === "fixture_submit"
          ? "pre_advance"
          : "blocked_final"
        : "populated";
    const populatedEvidence = await captureEvidence({
      page,
      plan,
      fieldResults: results,
      sequence: evidence.length + 1,
      kind: evidenceKind,
      label: plan.progression.dynamicContinuation
        ? `Conditional state revealed by ${plan.state.description}`
        : plan.progression.kind === "terminal_submit"
          ? "Completed generated values at the terminal boundary"
          : `Completed generated values for ${plan.state.description}`,
      onEvent,
    });
    evidence.push(populatedEvidence);
    for (const action of actions.slice(stateActionStart)) {
      action.stateId = populatedEvidence.id;
    }
    if (
      results.some(
        (result) =>
          result.field.required &&
          (!result.outcome.verified || result.outcome.skipped),
      )
    ) {
      throw new Error(
        `Validation replay failed a required field in ${plan.state.key}.`,
      );
    }
    await clearInactiveBranchVariantFields({
      toolbox,
      plan,
      onEvent,
    });
    const selectedVariants = await populateSelectedBranchVariants({
      page,
      toolbox,
      plan,
      authorizeWrites,
      onEvent,
      evidenceSequenceStart: evidence.length + 1,
      source: `replay-final-branch:${completePlan.artifactId}@${completePlan.scriptVersion}`,
    });
    actions.push(...selectedVariants.actions);
    evidence.push(...selectedVariants.evidence);
    observedFields.push(...selectedVariants.observedFields);
    fieldsEntered += selectedVariants.fieldsEntered;
    entryFailures += selectedVariants.entryFailures;
    if (plan.progression.dynamicContinuation) {
      if (plan.progression.samePageRevealAction) {
        const advanced = await advanceWithPlan({
          page,
          toolbox,
          plan,
          authorizeWrites,
          onEvent,
        });
        if (!advanced.clicked) {
          throw new Error(
            `Validation replay could not execute same-page reveal ${plan.progression.key}.`,
          );
        }
      }
      actions.push({
        category: "branch_reveal",
        label: plan.state.description,
        strategy: "stored LLM-authored script",
        timestamp: new Date().toISOString(),
        classification: "deterministic_replay",
        rationale:
          "This state intentionally reveals another same-page state before progression.",
        source: `generated:${completePlan.artifactId}@${completePlan.scriptVersion}`,
        outcome: "landed",
        stateId: populatedEvidence.id,
      });
      continue;
    }
    if (plan.progression.kind === "terminal_submit") {
      if (executionMode === "fixture_submit") {
        submissionsAttempted += 1;
        const terminalResult = await submitCrawlTerminal({
          page,
          toolbox,
          plan,
          authorizeWrites,
          onEvent,
          storedResultCriteria: completePlan.submissionResultCriteria,
          allowResultModel: false,
        });
        submissionResult = terminalResult;
        if (terminalResult.verified) {
          submissionsSucceeded += 1;
          finalSubmission = "submitted";
        } else {
          finalSubmission = "submitted_unverified";
        }
        evidence.push(
          await captureEvidence({
            page,
            plan,
            fieldResults: results,
            sequence: evidence.length + 1,
            kind: "submitted",
            label: terminalResult.verified
              ? "Generated crawl-time submission verified"
              : terminalResult.outcome === "failure"
                ? "Generated crawl-time submission failed"
                : "Generated crawl-time submission could not be verified",
            onEvent,
          }),
        );
      } else {
        actions.push({
          category: "final_submit_blocked",
          label: plan.progression.key,
          strategy: "generated script terminal boundary",
          timestamp: new Date().toISOString(),
          classification: "human_review",
          rationale: plan.progression.rationale,
          source: `generated:${completePlan.artifactId}@${completePlan.scriptVersion}`,
          outcome: "landed",
          stateId: populatedEvidence.id,
        });
      }
      break;
    }
    const advanced = await advanceWithPlan({
      page,
      toolbox,
      plan,
      authorizeWrites,
      onEvent,
    });
    actions.push({
      category: "form_advance",
      label: plan.progression.key,
      strategy: "stored LLM-authored script",
      timestamp: new Date().toISOString(),
      classification: "deterministic_replay",
      rationale: plan.progression.rationale,
      source: `generated:${completePlan.artifactId}@${completePlan.scriptVersion}`,
      outcome: advanced.clicked ? "landed" : "could_not_test",
      stateId: populatedEvidence.id,
      ...(!advanced.clicked
        ? {
            failureCode: "advance_no_navigation",
            error: advanced.detail || "Generated advance did not execute.",
          }
        : {}),
    });
    if (!advanced.clicked) {
      throw new Error(`Validation replay could not advance ${plan.state.key}.`);
    }
    replayJourneyUrls.add(page.url());
    evidence.push(
      await captureEvidence({
        page,
        plan,
        fieldResults: [],
        sequence: evidence.length + 1,
        kind: "post_advance",
        label: `State reached after ${plan.progression.key}`,
        onEvent,
      }),
    );
    }
  } catch (error) {
    replayFailure =
      error instanceof Error ? error.message : String(error);
    await onEvent?.(
      "generated_script_replay_failed",
      `Retained generated-script replay halted safely: ${replayFailure}`,
      {
        artifactId: completePlan.artifactId,
        scriptVersion: completePlan.scriptVersion,
        evidenceRetained: evidence.length,
        fieldsEntered,
        entryFailures,
      },
    );
  }

  return {
    actions,
    evidence,
    observedFields,
    fieldsEntered,
    entryFailures,
    branchStates: generatedBranchStateCount(completePlan),
    stateExaminations: 0,
    submissionsAttempted,
    submissionsSucceeded,
    submissionResult,
    finalSubmission,
    certificationStatus:
      replayFailure
        ? "could_not_test"
        : finalSubmission === "submitted"
        ? "fixture_submitted"
        : "generated_script_validated",
    reconScriptId: completePlan.artifactId,
    reconScriptVersion: completePlan.scriptVersion,
    generatedArtifact: {
      artifactId: completePlan.artifactId,
      scriptVersion: completePlan.scriptVersion,
      sourceHash: stored.sourceHash,
      path: stored.directory,
      modelCalls: completePlan.provenance?.length || 0,
      modelCallsThisRun: 0,
      states: completePlan.states.length,
      lifecycle: replayFailure
        ? "retained_replay_failed"
        : "retained_replay",
    },
    browserMode,
    journeyUrls: [...replayJourneyUrls],
    journeyComplete: !replayFailure,
    haltReason: replayFailure,
    entryMode: entry.mode,
    entryDetail: entry.detail,
  };
}

export async function generateAndReplayForm({
  page,
  runId,
  runDirectory,
  scriptRegistryRoot = null,
  executionMode,
  fixtureAuthorities = {},
  browserMode,
  authorizeWrites,
  onEvent,
}) {
  if ((await visibleGenerationSurfaceCount(page)) === 0) return null;
  const initialUrl = page.url();
  const generatedRoot = path.join(runDirectory, "generated");
  const statePlansRoot = path.join(generatedRoot, "state-plans");
  const dynamicsRoot = path.join(generatedRoot, "dynamics");
  await mkdir(statePlansRoot, { recursive: true });
  const forceFreshGeneration =
    process.env.FORMWEAVE_FORCE_FRESH_GENERATION === "1";
  const retained = forceFreshGeneration
    ? null
    : await retainedFormScript(scriptRegistryRoot, initialUrl);
  if (forceFreshGeneration) {
    await onEvent?.(
      "retained_script_bypassed",
      "Bypassed retained scripts so this run must generate a fresh model-authored script.",
      {
        initialUrl,
        reason: "FORMWEAVE_FORCE_FRESH_GENERATION",
      },
    );
  }
  if (retained) {
    for (const statePlan of retained.plan.states || []) {
      assertExecutablePlanSafety(statePlan);
    }
    const firstPlan = retained.plan.states?.[0];
    const toolbox = new PhysicsToolbox(page);
    await toolbox.prepare();
    const retainedCapture = await captureNovelStateInput({
      page,
      toolbox,
      existingContract: null,
      priorStates: [],
    });
    const entry = inferJourneyEntryMode(retainedCapture.observation);
    const issues = firstPlan
      ? await planResolutionIssues(toolbox, firstPlan)
      : [
          {
            targetKey: "form_script",
            problem: "The retained form script contains no states.",
            selectorCandidates: [],
          },
        ];
    for (const statePlan of retained.plan.states || []) {
      issues.push(
        ...replayAuthorityIssues(
          statePlan,
          executionMode,
          fixtureAuthorities,
        ),
      );
    }
    if (
      executionMode === "fixture_submit" &&
      !retained.plan.submissionResultCriteria
    ) {
      issues.push({
        targetKey: "submission_result",
        problem:
          "The retained script has no LLM-authored post-submit success criteria.",
        selectorCandidates: [],
      });
    }
    issues.push(...terminalEligibilityIssues(retained.plan));
    if (
      firstPlan &&
      retainedCapture.observation.normalizedRoute !== firstPlan.state.route
    ) {
      issues.push({
        targetKey: firstPlan.state.key,
        problem: `The observed route ${retainedCapture.observation.normalizedRoute} does not match retained route ${firstPlan.state.route}.`,
        selectorCandidates: [],
      });
    }
    if (issues.length === 0) {
      await onEvent?.(
        "retained_generated_script_selected",
        `Selected retained LLM-authored form script ${retained.plan.artifactId}@${retained.plan.scriptVersion}; replay will not call the model.`,
        {
          id: retained.plan.artifactId,
          version: retained.plan.scriptVersion,
          sourceHash: retained.sourceHash,
          path: retained.directory,
          states: retained.plan.states.length,
          modelCallsDuringThisRun: 0,
        },
      );
      return replayStoredFormScript({
        page,
        stored: retained,
        executionMode,
        fixtureAuthorities,
        browserMode,
        authorizeWrites,
        onEvent,
        entry,
      });
    }
    await onEvent?.(
      "retained_generated_script_preflight_failed",
      `Retained form script ${retained.plan.artifactId}@${retained.plan.scriptVersion} did not match the initial rendered state; no retained action was performed and a new script will be generated.`,
      {
        id: retained.plan.artifactId,
        version: retained.plan.scriptVersion,
        issues,
      },
    );
  }
  const generationStates = [];
  const generatedEvents = [];
  const journeyUrls = new Set([initialUrl]);
  let samePageBranchDepth = 0;
  let entry = {
    mode: "unknown",
    detail: "The initial state has not been examined yet.",
  };
  let generationJourney = mergeTraversalResults({
    actions: [],
    evidence: [],
    observedFields: [],
    fieldsEntered: 0,
    entryFailures: 0,
    branchStates: 0,
    submissionsAttempted: 0,
    submissionsSucceeded: 0,
    finalSubmission: "not_requested",
    certificationStatus: "generation_in_progress",
    reconScriptId: "",
    reconScriptVersion: 0,
    generatedArtifact: null,
    journeyUrls: [initialUrl],
    journeyComplete: true,
  });

  for (let index = 0; index < MAX_GENERATED_STATES; index += 1) {
    const sequence = index + 1;
    const toolbox = new PhysicsToolbox(page);
    await toolbox.prepare();
    const existingContract = generationStates.length
      ? existingContractFromStates(generationStates)
      : null;
    let captured = await captureNovelStateInput({
      page,
      toolbox,
      existingContract,
      priorStates: generationStates.map((item) => item.proposal.state),
    });
    const challenge = await detectCaptcha(page);
    if (challenge.detected) {
      const detail =
        "An interactive CAPTCHA or human-verification challenge was detected after navigation. No challenge answer or subsequent form action was attempted.";
      await onEvent?.(
        "interactive_captcha",
        detail,
        {
          sequence,
          evidence: challenge.evidence,
          frameUrl: challenge.frameUrl,
          failureCode: "challenge_detected",
        },
      );
      const challengePlan = {
        schemaVersion: 1,
        scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
        proposalId: `safety_challenge_${sequence}`,
        model: "",
        promptVersion: "",
        state: {
          key: `challenge_state_${sequence}`,
          description: detail,
          kind: "review",
          route: captured.observation.normalizedRoute,
        },
        fields: [],
        sections: [],
        guidance: [],
        choiceCoverage: [],
        samePageBranchDepth,
        progression: {
          key: "challenge_blocked",
          kind: "advance",
          selectors: [],
          rationale: detail,
          modelProposed: false,
          operatorAuthorizationRequired: true,
        },
      };
      const halted = await couldNotTestGeneratedState({
        page,
        plan: challengePlan,
        fieldResults: [],
        onEvent,
        priorResult: generationJourney,
        journeyUrls: [...journeyUrls, page.url()],
        stateExaminations: sequence,
        detail,
      });
      return {
        ...halted,
        captchaDetected: true,
        unresolvedGate: "captcha",
      };
    }
    const visibleSubmitActions = captured.observation.actions.filter(
      (action) =>
        action.visible &&
        String(action.rawType || "").toLowerCase() === "submit",
    );
    const visibleButtonActions = captured.observation.actions.filter(
      (action) =>
        action.visible &&
        ["button", "submit"].includes(
          String(action.rawType || "").toLowerCase(),
        ),
    );
    const entryPreview = inferJourneyEntryMode(captured.observation);
    const ambiguousUntypedTerminal =
      visibleSubmitActions.length === 0 &&
      visibleButtonActions.length >= 2 &&
      entryPreview.mode === "unknown";
    if (visibleSubmitActions.length >= 2 || ambiguousUntypedTerminal) {
      await onEvent?.(
        "ambiguous_submit",
        ambiguousUntypedTerminal
          ? `Observed ${visibleButtonActions.length} visible button actions with no submit semantics or progress indicator. The LLM must distinguish draft/progression/terminal meaning; the ambiguity is retained as a finding.`
          : `Observed ${visibleSubmitActions.length} visible submit-typed controls. The LLM must supply corroborating progression evidence before any one can be treated as nonterminal.`,
        {
          sequence,
          actions: (
            ambiguousUntypedTerminal
              ? visibleButtonActions
              : visibleSubmitActions
          ).map((action) => ({
            factId: action.factId,
            text: action.rawText,
            rawType: action.rawType,
            formMethod: action.formMethod,
          })),
        },
      );
    }
    if (index === 0) {
      entry = inferJourneyEntryMode(captured.observation);
      generationJourney.entryMode = entry.mode;
      generationJourney.entryDetail = entry.detail;
      await onEvent?.(
        entry.mode === "mid_flow"
          ? "mid_flow_entry_detected"
          : "journey_entry_classified",
        entry.detail,
        {
          entryMode: entry.mode,
          initialUrl,
          currentStep: entry.currentStep,
          totalSteps: entry.totalSteps,
        },
      );
    }
    const stateEvents = [];
    const modelLog = async (kind, metadata) => {
      const event = {
        at: new Date().toISOString(),
        kind,
        metadata,
      };
      stateEvents.push(event);
      generatedEvents.push(event);
      await onEvent?.(
        kind,
        kind === "semantic_generation_started"
          ? `Calling the LLM for novel state ${sequence}.`
          : kind === "semantic_generation_completed"
            ? `LLM generated state ${sequence} semantics and actions.`
            : kind.replaceAll("_", " "),
        { sequence, ...metadata },
      );
    };
    let generated;
    let safety;
    let plan;
    const repairHistory = [];
    const maxRepairAttempts = 2;
    const semanticRepairDeadlineAt = Date.now() + 120_000;
    for (
      let repairAttempt = 1;
      repairAttempt <= maxRepairAttempts;
      repairAttempt += 1
    ) {
      const remainingSemanticMs = semanticRepairDeadlineAt - Date.now();
      if (remainingSemanticMs <= 1_000 && plan) {
        const detail =
          "Semantic script validation exceeded its two-minute repair budget. The rendered observation was retained and no form action was executed.";
        await onEvent?.("generated_script_validation_exhausted", detail, {
          sequence,
          repairAttempt,
          issues: repairHistory.at(-1)?.issues || [],
          failureCode: "semantic_repair_budget_exhausted",
        });
        return couldNotTestGeneratedState({
          page,
          plan,
          fieldResults: [],
          onEvent,
          priorResult: generationJourney,
          journeyUrls: [...journeyUrls, page.url()],
          stateExaminations: sequence,
          detail,
        });
      }
      generated = await generateSemanticProposal(captured, {
        log: modelLog,
        maxSchemaAttempts: repairAttempt === 1 ? 2 : 1,
        timeoutMs: remainingSemanticMs,
      });
      safety = validateProposalSafety({
        proposal: generated.proposal,
        observation: captured.observation,
        existingContract,
        fixtureAuthorities,
      });
      plan = generatedStatePlan({
        proposal: generated.proposal,
        observation: captured.observation,
        safety,
        provenance: generated.provenance,
      });
      assertExecutablePlanSafety(plan);
      const resolutionIssues = await planResolutionIssues(toolbox, plan);
      const contractIssues = [
        ...proposalFactBindingIssues(
          generated.proposal,
          captured.observation,
        ),
        ...radioGroupProposalIssues(
          generated.proposal,
          captured.observation,
        ),
        ...sourceFactOwnershipIssues(
          generated.proposal,
          captured.observation,
        ),
        ...progressionActionContractIssues(generated.proposal),
        ...pendingDisclosureIssues(
          generated.proposal,
          captured.observation,
        ),
        ...exhaustedDisclosureProgressionIssues(
          generated.proposal,
          captured.observation,
        ),
      ];
      const valueSafetyIssues = safety.rejections
        .filter((item) => item.code === "unsafe_value")
        .map((item) => {
          const action = generated.proposal.proposedActions.find(
            (candidate) => candidate.proposalId === item.proposalId,
          );
          return {
            type: "unsafe_value",
            targetKey: action?.targetKey || item.proposalId,
            detail: item.detail,
          instruction:
              "Replace this value with a format-valid, conspicuously synthetic value. Preserve strict field formats: use 99999 for a five-digit US postal/ZIP code, 99999-9999 for ZIP+4, 9999 for currency/income/rent text controls, reserved 9 digits and Z/X letters (or FW for exactly two letters) when an observed pattern cannot contain test wording, and FORMWEAVE TEST wording only where free text is permitted.",
          };
        });
      const protectedKindRepairIssues = safety.rejections
        .map((item) => {
          const action = generated.proposal.proposedActions.find(
            (candidate) => candidate.proposalId === item.proposalId,
          );
          if (
            action?.kind !== "field_actuation" ||
            ![
              "captcha_interaction",
              "credential_interaction",
              "legal_acceptance_interaction",
              "login_interaction",
              "payment_interaction",
              "upload_interaction",
            ].includes(item.code)
          ) {
            return null;
          }
          return {
            type: "protected_action_kind",
            targetKey: action.targetKey,
            detail: item.detail,
            instruction: `Keep the model-authored target and rationale, but classify its primary action as ${item.code}. Do not provide credentials, payment data, CAPTCHA answers, or upload paths/content.`,
          };
        })
        .filter(Boolean);
      const repairIssues = [
        ...contractIssues,
        ...resolutionIssues,
        ...valueSafetyIssues,
        ...protectedKindRepairIssues,
      ];
      if (repairIssues.length === 0) break;
      await onEvent?.(
        "generated_script_resolution_repair",
        `The generated state script had ${repairIssues.length} validation issue${repairIssues.length === 1 ? "" : "s"}; requesting one targeted LLM repair before actuation.`,
        {
          sequence,
          repairAttempt,
          issues: repairIssues,
        },
      );
      if (repairAttempt === maxRepairAttempts) {
        const detail = `Generated script validation issues remained after repair: ${repairIssues.map((item) => item.targetKey).join(", ")}. No field or progression action from the unresolved state was executed.`;
        await onEvent?.(
          "generated_script_validation_exhausted",
          detail,
          {
            sequence,
            repairAttempt,
            issues: repairIssues,
          },
        );
        return couldNotTestGeneratedState({
          page,
          plan,
          fieldResults: [],
          onEvent,
          priorResult: generationJourney,
          journeyUrls: [...journeyUrls, page.url()],
          stateExaminations: sequence,
          detail,
        });
      }
      repairHistory.push({
        attempt: repairAttempt,
        priorProposalId: generated.proposal.proposalId,
        issues: repairIssues,
      });
      captured = {
        ...captured,
        observation: {
          ...captured.observation,
          runtimeValidationFeedback: {
            priorProposalId: generated.proposal.proposalId,
            priorProposal: generated.proposal,
            issues: repairIssues,
            failureHistory: repairHistory,
            instruction:
              "Use priorProposal as the base. Correct only the listed invalid paths and references that necessarily depend on them, preserving every unrelated valid field and action byte-for-byte where the schema permits. Return the complete proposal required by the response schema. Do not emit choice_probe actions; shared code derives them deterministically. Use exact selectorCandidates that resolve uniquely and format-valid synthetic values. No action has been taken.",
          },
        },
      };
    }
    const stateRecordId = `state_${String(sequence).padStart(3, "0")}`;
    const recordPath = await writeSemanticGenerationRecord({
      dataRoot: generatedRoot,
      runId: stateRecordId,
      observation: captured.observation,
      screenshot: captured.screenshot,
      proposal: generated.proposal,
      provenance: generated.provenance,
      safety,
      events: stateEvents,
    });
    let stored = await writeAndLoadPlan(
      statePlansRoot,
      stateRecordId,
      assertExecutablePlanSafety(plan),
      {
        schemaVersion: 1,
        kind: "generated_state_script",
        runId,
        stateSequence: sequence,
        stateKey: plan.state.key,
        scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
        proposalId: plan.proposalId,
        model: plan.model,
        promptVersion: plan.promptVersion,
        sourceHash: sha256(planSource(plan)),
        generatedAt: new Date().toISOString(),
        semanticRecord: recordPath,
      },
    );
    await onEvent?.(
      "generated_script_state_stored",
      `Stored and loaded generated state script ${plan.state.key}.`,
      {
        id: `generated:${runId}`,
        version: GENERATED_FORM_SCRIPT_VERSION,
        stateKey: plan.state.key,
        sequence,
        sourceHash: stored.sourceHash,
        path: stored.directory,
      },
    );
    const inaccessibleChoices = inaccessibleChoiceGroups(
      captured.observation,
    );
    if (inaccessibleChoices.length > 0) {
      const detail =
        "A rendered choice group is backed only by inaccessible native controls, so its options cannot be verified without guessing the custom widget contract.";
      await onEvent?.(
        "probe_actuation_failed",
        detail,
        {
          failureCode: "locators_unresolved",
          groups: inaccessibleChoices,
          stateKey: plan.state.key,
        },
      );
      return couldNotTestGeneratedState({
        page,
        plan: stored.plan,
        fieldResults: [],
        onEvent,
        priorResult: generationJourney,
        journeyUrls: [...journeyUrls, page.url()],
        entryMode: entry.mode,
        entryDetail: entry.detail,
        stateExaminations: sequence,
        detail,
      });
    }
    if (
      plan.progression.kind === "advance" &&
      !plan.progression.modelProposed
    ) {
      const progressionProposal = generated.proposal.proposedActions.find(
        (action) => action.targetKey === plan.progression.key,
      );
      const progressionRejection = progressionProposal
        ? safety.rejections.find(
            (rejection) =>
              rejection.proposalId === progressionProposal.proposalId,
          )
        : null;
      if (
        progressionRejection &&
        [
          "captcha_interaction",
          "credential_interaction",
          "login_interaction",
          "payment_interaction",
          "upload_interaction",
          "legal_acceptance_interaction",
        ].includes(progressionRejection.code)
      ) {
        const protectedResults = await enterPlanFields({
          page,
          toolbox,
          plan: stored.plan,
          authorizeWrites,
          onEvent,
          source: `generation:${plan.proposalId}`,
        });
        const detail = `The LLM identified the next action, but deterministic safety rejected it as ${progressionRejection.code}. The protected gate was captured without actuation.`;
        const protectedFindingCode =
          {
            captcha_interaction: "interactive_captcha",
            credential_interaction: "login_required",
            login_interaction: "login_required",
            payment_interaction: "payment_field",
            upload_interaction: "upload_interaction",
            legal_acceptance_interaction:
              "legal_acceptance_interaction",
          }[progressionRejection.code] ||
          "protected_progression_gate";
        await onEvent?.(
          protectedFindingCode,
          detail,
          {
            stateKey: plan.state.key,
            progressionKey: plan.progression.key,
            failureCode: progressionRejection.code,
          },
        );
        await onEvent?.(
          "protected_progression_gate",
          detail,
          {
            stateKey: plan.state.key,
            progressionKey: plan.progression.key,
            failureCode: progressionRejection.code,
            proposalId: progressionProposal.proposalId,
          },
        );
        return couldNotTestGeneratedState({
          page,
          plan: stored.plan,
          fieldResults: protectedResults,
          onEvent,
          priorResult: generationJourney,
          journeyUrls: [...journeyUrls, page.url()],
          entryMode: entry.mode,
          entryDetail: entry.detail,
          stateExaminations: sequence,
          detail,
        });
      }
      throw new Error(
        `LLM did not propose the declared advance for state ${plan.state.key}.`,
      );
    }
    const omittedFields = plan.fields.filter(
      (field) => field.skipReason === "model_action_missing",
    );
    if (omittedFields.length > 0) {
      throw new Error(
        `The LLM omitted typed actions for: ${omittedFields.map((field) => field.label).join(", ")}.`,
      );
    }
    const probeExecution = await executeChoiceProbes({
      page,
      toolbox,
      plan: stored.plan,
      beforeCapture: captured,
      existingContract,
      priorStates: generationStates.map((item) => item.proposal.state),
      fixtureAuthorities,
      authorizeWrites,
      onEvent,
      generatedRoot,
      statePlansRoot,
      dynamicsRoot,
      evidenceSequenceStart: generationJourney.evidence.length + 1,
      branchDepth: samePageBranchDepth,
      recordPrefix: `${stateRecordId}_choice`,
    });
    if (probeExecution.coverage.length > 0) {
      generationJourney = mergeTraversalResults(generationJourney, {
        actions: [
          ...probeExecution.coverage.map((row) => ({
            category: "choice_probe",
            label: `${row.label}: ${String(row.value)}`,
            strategy: "stored deterministic exhaustive option probe",
            timestamp: new Date().toISOString(),
            classification: "deterministic",
            rationale:
              row.assessment?.rationale ||
              "The generated script retained this deterministic option probe.",
            source: `generated:${plan.proposalId}@${plan.scriptVersion}`,
            testValue: row.value,
            outcome:
              row.status === "verified" ? "landed" : "could_not_test",
            stateId: row.evidenceId,
            ...(row.failureCode
              ? {
                  failureCode: row.failureCode,
                  error: row.detail,
                }
              : {}),
          })),
          ...probeExecution.variantActions,
        ],
        evidence: probeExecution.evidence,
        observedFields: probeExecution.variantObservedFields,
        fieldsEntered: probeExecution.variantFieldsEntered,
        entryFailures:
          probeExecution.coverage.filter(
            (row) => row.status !== "verified",
          ).length + probeExecution.variantEntryFailures,
        branchStates: probeExecution.variantProposals.length,
        submissionsAttempted: 0,
        submissionsSucceeded: 0,
        finalSubmission: "not_requested",
        certificationStatus: "generation_in_progress",
        journeyUrls: [...journeyUrls],
        journeyComplete: true,
        entryMode: entry.mode,
        entryDetail: entry.detail,
      });
      plan = probeExecution.plan;
      stored = await writeAndLoadPlan(
        statePlansRoot,
        `${stateRecordId}_resolved`,
        assertExecutablePlanSafety(plan),
        {
          schemaVersion: 1,
          kind: "generated_state_script_after_choice_probes",
          runId,
          stateSequence: sequence,
          stateKey: plan.state.key,
          scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
          proposalId: plan.proposalId,
          model: plan.model,
          promptVersion: plan.promptVersion,
          sourceHash: sha256(planSource(plan)),
          generatedAt: new Date().toISOString(),
          semanticRecord: recordPath,
          optionProbes: probeExecution.coverage.length,
        },
      );
      await onEvent?.(
        "generated_script_choice_coverage_stored",
        `Stored ${probeExecution.coverage.length} verified/attempted deterministic option probe result${probeExecution.coverage.length === 1 ? "" : "s"} for ${plan.state.key}.`,
        {
          stateKey: plan.state.key,
          sequence,
          complete: probeExecution.complete,
          sourceHash: stored.sourceHash,
          path: stored.directory,
        },
      );
    }
    if (!probeExecution.complete) {
      const depthExceeded = /second-level/i.test(
        probeExecution.haltReason,
      );
      await onEvent?.(
        depthExceeded
          ? "same_page_branch_depth_exceeded"
          : "choice_probe_incomplete",
        probeExecution.haltReason ||
          "Required LLM-authored option coverage was incomplete.",
        {
          stateKey: plan.state.key,
          branchDepth: samePageBranchDepth,
          coverage: probeExecution.coverage,
        },
      );
      return couldNotTestGeneratedState({
        page,
        plan: stored.plan,
        fieldResults: [],
        onEvent,
        priorResult: generationJourney,
        journeyUrls: [...journeyUrls, page.url()],
        entryMode: entry.mode,
        entryDetail: entry.detail,
        stateExaminations: sequence,
        detail:
          probeExecution.haltReason ||
          "Required option coverage was incomplete. No progression or submission was attempted.",
      });
    }
    const generationFieldResults = await enterPlanFields({
      page,
      toolbox,
      plan: stored.plan,
      authorizeWrites,
      onEvent,
      source: `generation:${plan.proposalId}`,
    });
    const requiredGenerationFailures = generationFieldResults.filter(
      (result) =>
        result.field.required &&
        (!result.outcome.verified || result.outcome.skipped),
    );
    if (requiredGenerationFailures.length > 0) {
      return couldNotTestGeneratedState({
        page,
        plan: stored.plan,
        fieldResults: generationFieldResults,
        onEvent,
        priorResult: generationJourney,
        journeyUrls: [...journeyUrls, page.url()],
        entryMode: entry.mode,
        entryDetail: entry.detail,
        stateExaminations: sequence,
        detail: `Required generated field verification failed for: ${requiredGenerationFailures
          .map((result) => result.field.label)
          .join(", ")}. No progression or submission was attempted.`,
      });
    }
    await clearInactiveBranchVariantFields({
      toolbox,
      plan: stored.plan,
      onEvent,
    });
    const selectedVariants = await populateSelectedBranchVariants({
      page,
      toolbox,
      plan: stored.plan,
      authorizeWrites,
      onEvent,
      evidenceSequenceStart: generationJourney.evidence.length + 1,
      source: `generation-final-branch:${plan.proposalId}`,
    });
    if (selectedVariants.evidence.length > 0) {
      generationJourney = mergeTraversalResults(
        generationJourney,
        {
          ...selectedVariants,
          branchStates: 0,
          submissionsAttempted: 0,
          submissionsSucceeded: 0,
          finalSubmission: "not_requested",
          certificationStatus: "generation_in_progress",
          journeyUrls: [...journeyUrls],
          journeyComplete: true,
          entryMode: entry.mode,
          entryDetail: entry.detail,
        },
      );
    }
    journeyUrls.add(page.url());
    const populatedEvidence = await captureEvidence({
      page,
      plan: stored.plan,
      fieldResults: generationFieldResults,
      sequence: generationJourney.evidence.length + 1,
      kind: "populated",
      label: `Generated values verified for ${plan.state.description}`,
      onEvent,
    });
    generationJourney = mergeTraversalResults(generationJourney, {
      actions: generatedFieldActions(
        stored.plan,
        generationFieldResults,
        populatedEvidence.id,
      ),
      evidence: [populatedEvidence],
      observedFields: generatedObservedFields(
        stored.plan,
        generationFieldResults,
      ),
      fieldsEntered: generationFieldResults.filter(
        (result) => result.outcome.verified,
      ).length,
      entryFailures: countEntryFailures(generationFieldResults),
      branchStates: 0,
      submissionsAttempted: 0,
      submissionsSucceeded: 0,
      finalSubmission: "not_requested",
      certificationStatus: "generation_in_progress",
      journeyUrls: [...journeyUrls],
      journeyComplete: true,
      entryMode: entry.mode,
      entryDetail: entry.detail,
    });
    const postActuation = await captureNovelStateInput({
      page,
      toolbox,
      existingContract,
      priorStates: generationStates.map((item) => item.proposal.state),
    });
    const variantCoveredFactIds = new Set(
      probeExecution.coverage.flatMap(
        (coverage) => coverage.variantSourceFactIds || [],
      ),
    );
    const revealedControls = newlyVisibleControls(
      captured.observation,
      postActuation.observation,
    ).filter((control) => !variantCoveredFactIds.has(control.factId));
    if (revealedControls.length > 0) {
      const nextBranchDepth = samePageBranchDepth + 1;
      const branchTriggerFields = plan.fields
        .filter((field) =>
          ["checkbox", "radio", "select", "switch"].includes(field.controlType),
        )
        .map((field) => field.key);
      const dynamics = await assessDynamics({
        transitionKind: "same_page_visibility_change",
        beforeCapture: captured,
        afterCapture: postActuation,
        trigger: {
          fieldKeys: branchTriggerFields,
          source: "final generated field values",
        },
        enteredValues: generationFieldResults
          .filter((result) => result.outcome.verified)
          .map((result) => ({
            fieldKey: result.field.key,
            label: result.field.label,
            value: result.field.testValue,
          })),
        branchDepth: nextBranchDepth,
        onEvent,
        dynamicsRoot,
        recordId: `${stateRecordId}_reveal`,
      });
      const supportedClassification = [
        "same_page_branch",
        "same_page_companion",
      ].includes(dynamics.assessment.outcome);
      if (
        nextBranchDepth > MAX_SAME_PAGE_BRANCH_DEPTH ||
        !supportedClassification
      ) {
        const depthExceeded =
          nextBranchDepth > MAX_SAME_PAGE_BRANCH_DEPTH;
        const detail = depthExceeded
          ? `A same-page conditional reveal reached depth ${nextBranchDepth}; only one reveal level is supported.`
          : `The LLM classified newly visible controls as ${dynamics.assessment.outcome}; the state is not safe to continue automatically.`;
        await onEvent?.(
          depthExceeded
            ? "same_page_branch_depth_exceeded"
            : "same_page_branch_classification_uncertain",
          detail,
          {
            sequence,
            stateKey: plan.state.key,
            branchDepth: nextBranchDepth,
            assessment: dynamics.assessment,
            revealedControls: revealedControls.map((fact) => ({
              factId: fact.factId,
              id: fact.id,
              name: fact.name,
              rawLabel: fact.rawLabel,
              rawType: fact.rawType,
            })),
          },
        );
        return couldNotTestGeneratedState({
          page,
          plan: stored.plan,
          fieldResults: generationFieldResults,
          onEvent,
          priorResult: generationJourney,
          journeyUrls: [...journeyUrls, page.url()],
          entryMode: entry.mode,
          entryDetail: entry.detail,
          stateExaminations: sequence,
          detail: `${detail} No progression or submission was attempted.`,
        });
      }
      await onEvent?.(
        "branching_logic_detected",
        `Deterministic probes revealed ${revealedControls.length} additional visible control${revealedControls.length === 1 ? "" : "s"} at supported depth ${nextBranchDepth}; the revealed state will be sent to the LLM before any progression.`,
        {
          sequence,
          stateKey: plan.state.key,
          triggerFieldCandidates: branchTriggerFields,
          branchDepth: nextBranchDepth,
          semanticClassification: dynamics.assessment.outcome,
          dynamicsAssessmentId: dynamics.assessment.assessmentId,
          revealedControls: revealedControls.map((fact) => ({
            factId: fact.factId,
            id: fact.id,
            name: fact.name,
            rawLabel: fact.rawLabel,
            rawType: fact.rawType,
          })),
        },
      );
      generationJourney = {
        ...generationJourney,
        branchStates: generationJourney.branchStates + 1,
      };
      samePageBranchDepth = nextBranchDepth;
      const dynamicPlan = {
        ...stored.plan,
        samePageBranchDepth,
        samePageAssessment: dynamics.assessment,
      };
      const dynamicStored = await writeAndLoadPlan(
        statePlansRoot,
        `${stateRecordId}_dynamic`,
        assertExecutablePlanSafety(dynamicPlan),
        {
          schemaVersion: 1,
          kind: "generated_state_script_with_same_page_assessment",
          runId,
          stateSequence: sequence,
          stateKey: dynamicPlan.state.key,
          scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
          proposalId: dynamicPlan.proposalId,
          model: dynamicPlan.model,
          promptVersion: dynamicPlan.promptVersion,
          sourceHash: sha256(planSource(dynamicPlan)),
          generatedAt: new Date().toISOString(),
          semanticRecord: recordPath,
          dynamicsAssessmentId: dynamics.assessment.assessmentId,
        },
      );
      generationStates.push({
        proposal: generated.proposal,
        branchVariantProposals: probeExecution.variantProposals,
        branchVariantProvenance: probeExecution.variantProvenance,
        observation: captured.observation,
        provenance: generated.provenance,
        safety,
        plan: dynamicStored.plan,
        sourceHash: dynamicStored.sourceHash,
        dynamicContinuation: true,
      });
      continue;
    }
    if (plan.progression.kind === "terminal_submit") {
      generationStates.push({
        proposal: generated.proposal,
        branchVariantProposals: probeExecution.variantProposals,
        branchVariantProvenance: probeExecution.variantProvenance,
        observation: captured.observation,
        provenance: generated.provenance,
        safety,
        plan: {
          ...stored.plan,
          samePageBranchDepth,
        },
        sourceHash: stored.sourceHash,
        dynamicContinuation: false,
      });
      break;
    }
    const advanced = await advanceWithPlan({
      page,
      toolbox,
      plan: stored.plan,
      authorizeWrites,
      onEvent,
    });
    if (!advanced.clicked) {
      throw new Error(
        `Generated advance could not execute for state ${plan.state.key}.`,
      );
    }
    journeyUrls.add(page.url());
    const afterAdvanceCapture = await captureNovelStateInput({
      page,
      toolbox,
      existingContract,
      priorStates: generationStates.map((item) => item.proposal.state),
    });
    const unexpectedResult = await assessUnexpectedResultPage({
      page,
      captured: afterAdvanceCapture,
      onEvent,
    });
    if (unexpectedResult) {
      const terminalPlan = {
        ...stored.plan,
        samePageBranchDepth,
        crossPageAssessment: null,
        progression: {
          ...stored.plan.progression,
          kind: "terminal_submit",
          operatorAuthorizationRequired: true,
          reclassifiedFromAdvance: true,
          resultAssessmentId:
            unexpectedResult.assessment.assessmentId,
        },
      };
      const terminalStored = await writeAndLoadPlan(
        statePlansRoot,
        `${stateRecordId}_terminal_result`,
        assertExecutablePlanSafety(terminalPlan),
        {
          schemaVersion: 1,
          kind: "generated_state_script_reclassified_terminal",
          runId,
          stateSequence: sequence,
          stateKey: terminalPlan.state.key,
          scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
          proposalId: terminalPlan.proposalId,
          model: terminalPlan.model,
          promptVersion: terminalPlan.promptVersion,
          sourceHash: sha256(planSource(terminalPlan)),
          generatedAt: new Date().toISOString(),
          semanticRecord: recordPath,
          submissionAssessmentId:
            unexpectedResult.assessment.assessmentId,
        },
      );
      const submittedEvidence = await captureEvidence({
        page,
        plan: terminalStored.plan,
        fieldResults: generationFieldResults,
        sequence: generationJourney.evidence.length + 1,
        kind: "submitted",
        label:
          unexpectedResult.assessment.outcome === "success"
            ? "LLM verified an explicit completion page after the authored advance"
            : "LLM verified an explicit failure page after the authored advance",
        onEvent,
      });
      generationJourney = mergeTraversalResults(generationJourney, {
        actions: [
          {
            category: "terminal_result_detected",
            label: plan.progression.key,
            strategy: "fresh LLM post-transition result assessment",
            timestamp: new Date().toISOString(),
            classification: "llm_generated_probe",
            rationale: unexpectedResult.assessment.rationale,
            source: `generated:${plan.proposalId}@${plan.scriptVersion}`,
            outcome:
              unexpectedResult.assessment.outcome === "success"
                ? "landed"
                : "could_not_test",
            stateId: submittedEvidence.id,
          },
        ],
        evidence: [submittedEvidence],
        observedFields: [],
        fieldsEntered: 0,
        entryFailures: 0,
        branchStates: 0,
        submissionsAttempted: 1,
        submissionsSucceeded:
          unexpectedResult.assessment.outcome === "success" ? 1 : 0,
        finalSubmission:
          unexpectedResult.assessment.outcome === "success"
            ? "submitted"
            : "submitted_unverified",
        submissionResult: {
          verified:
            unexpectedResult.assessment.outcome === "success",
          outcome: unexpectedResult.assessment.outcome,
          source: "fresh_llm_assessment",
          detail: unexpectedResult.assessment.rationale,
          criteria: unexpectedResult.assessment,
          provenance: unexpectedResult.provenance,
        },
        certificationStatus: "generation_in_progress",
        journeyUrls: [...journeyUrls],
        journeyComplete: true,
        entryMode: entry.mode,
        entryDetail: entry.detail,
      });
      await onEvent?.(
        "unexpected_terminal_result_detected",
        `The LLM-authored advance landed on an explicit ${unexpectedResult.assessment.outcome} result. The action was reclassified as terminal and traversal stopped.`,
        {
          stateKey: plan.state.key,
          progressionKey: plan.progression.key,
          outcome: unexpectedResult.assessment.outcome,
          assessmentId:
            unexpectedResult.assessment.assessmentId,
          markers: unexpectedResult.assessment.markers,
        },
      );
      generationStates.push({
        proposal: generated.proposal,
        branchVariantProposals: probeExecution.variantProposals,
        branchVariantProvenance: probeExecution.variantProvenance,
        observation: captured.observation,
        provenance: generated.provenance,
        safety,
        plan: terminalStored.plan,
        sourceHash: terminalStored.sourceHash,
        dynamicContinuation: false,
      });
      break;
    }
    const sameDocumentTransition =
      postActuation.observation.normalizedRoute ===
        afterAdvanceCapture.observation.normalizedRoute &&
      (() => {
        try {
          return (
            new URL(postActuation.observation.url).origin ===
            new URL(afterAdvanceCapture.observation.url).origin
          );
        } catch {
          return false;
        }
      })();
    if (sameDocumentTransition) {
      const revealed = newlyVisibleControls(
        postActuation.observation,
        afterAdvanceCapture.observation,
      );
      const changed = visibleControlSemanticChanges(
        postActuation.observation,
        afterAdvanceCapture.observation,
      );
      const nextBranchDepth = samePageBranchDepth + 1;
      const samePageDynamics = await assessDynamics({
        transitionKind: "same_page_visibility_change",
        beforeCapture: postActuation,
        afterCapture: afterAdvanceCapture,
        trigger: {
          progressionKey: plan.progression.key,
          beforeUrl: postActuation.observation.url,
          afterUrl: afterAdvanceCapture.observation.url,
        },
        enteredValues: generationFieldResults
          .filter((result) => result.outcome.verified)
          .map((result) => ({
            fieldKey: result.field.key,
            label: result.field.label,
            value: result.field.testValue,
          })),
        branchDepth: nextBranchDepth,
        onEvent,
        dynamicsRoot,
        recordId: `${stateRecordId}_same_page_advance`,
      });
      const postAdvanceEvidence = await captureEvidence({
        page,
        plan: stored.plan,
        fieldResults: [],
        sequence: generationJourney.evidence.length + 1,
        kind: "post_advance",
        label: `Same-page state reached after ${plan.progression.key}`,
        onEvent,
      });
      generationJourney = mergeTraversalResults(generationJourney, {
        actions: [
          {
            category: "form_advance",
            label: plan.progression.key,
            strategy: "stored LLM-authored progression action",
            timestamp: new Date().toISOString(),
            classification: "llm_generated_probe",
            rationale: plan.progression.rationale,
            source: `generated:${plan.proposalId}@${plan.scriptVersion}`,
            outcome: "landed",
            stateId: populatedEvidence.id,
          },
        ],
        evidence: [postAdvanceEvidence],
        observedFields: [],
        fieldsEntered: 0,
        entryFailures: 0,
        branchStates: 0,
        submissionsAttempted: 0,
        submissionsSucceeded: 0,
        finalSubmission: "not_requested",
        certificationStatus: "generation_in_progress",
        journeyUrls: [...journeyUrls],
        journeyComplete: true,
        entryMode: entry.mode,
        entryDetail: entry.detail,
      });
      const supported = [
        "same_page_branch",
        "same_page_companion",
        "same_page_disclosure",
      ].includes(samePageDynamics.assessment.outcome);
      const conditionalReveal = [
        "same_page_branch",
        "same_page_companion",
      ].includes(samePageDynamics.assessment.outcome);
      const resolvedBranchDepth = conditionalReveal
        ? nextBranchDepth
        : samePageBranchDepth;
      if (
        !supported ||
        resolvedBranchDepth > MAX_SAME_PAGE_BRANCH_DEPTH
      ) {
        const detail =
          resolvedBranchDepth > MAX_SAME_PAGE_BRANCH_DEPTH
            ? `The authored progression exposed a second-level same-page branch at depth ${resolvedBranchDepth}; only one level is supported.`
            : `The authored same-page progression was classified ${samePageDynamics.assessment.outcome}; automatic traversal stopped.`;
        await onEvent?.(
          resolvedBranchDepth > MAX_SAME_PAGE_BRANCH_DEPTH
            ? "same_page_branch_depth_exceeded"
            : "same_page_branch_classification_uncertain",
          detail,
          {
            stateKey: plan.state.key,
            progressionKey: plan.progression.key,
            branchDepth: resolvedBranchDepth,
            assessment: samePageDynamics.assessment,
            revealedControls: revealed.length,
            changedControls: changed.length,
          },
        );
        return couldNotTestGeneratedState({
          page,
          plan: stored.plan,
          fieldResults: [],
          onEvent,
          priorResult: generationJourney,
          journeyUrls: [...journeyUrls],
          entryMode: entry.mode,
          entryDetail: entry.detail,
          stateExaminations: sequence,
          detail: `${detail} No newly revealed control or terminal action was actuated.`,
        });
      }
      const dynamicPlan = {
        ...stored.plan,
        samePageBranchDepth: resolvedBranchDepth,
        samePageAssessment: samePageDynamics.assessment,
        progression: {
          ...stored.plan.progression,
          samePageRevealAction: true,
        },
      };
      const dynamicStored = await writeAndLoadPlan(
        statePlansRoot,
        `${stateRecordId}_same_page_transition`,
        assertExecutablePlanSafety(dynamicPlan),
        {
          schemaVersion: 1,
          kind: "generated_state_script_with_same_page_progression",
          runId,
          stateSequence: sequence,
          stateKey: dynamicPlan.state.key,
          scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
          proposalId: dynamicPlan.proposalId,
          model: dynamicPlan.model,
          promptVersion: dynamicPlan.promptVersion,
          sourceHash: sha256(planSource(dynamicPlan)),
          generatedAt: new Date().toISOString(),
          semanticRecord: recordPath,
          dynamicsAssessmentId:
            samePageDynamics.assessment.assessmentId,
        },
      );
      await onEvent?.(
        conditionalReveal
          ? "branching_logic_detected"
          : "same_page_disclosure_detected",
        `The LLM-authored progression exposed a supported ${samePageDynamics.assessment.outcome.replaceAll("_", " ")} state with ${revealed.length} new and ${changed.length} changed control${revealed.length + changed.length === 1 ? "" : "s"}.`,
        {
          stateKey: plan.state.key,
          progressionKey: plan.progression.key,
          branchDepth: nextBranchDepth,
          assessment: samePageDynamics.assessment,
          revealedControls: revealed.length,
          changedControls: changed.length,
        },
      );
      if (conditionalReveal) {
        generationJourney = {
          ...generationJourney,
          branchStates: generationJourney.branchStates + 1,
        };
      }
      samePageBranchDepth = resolvedBranchDepth;
      generationStates.push({
        proposal: generated.proposal,
        branchVariantProposals: probeExecution.variantProposals,
        branchVariantProvenance: probeExecution.variantProvenance,
        observation: captured.observation,
        provenance: generated.provenance,
        safety,
        plan: dynamicStored.plan,
        sourceHash: dynamicStored.sourceHash,
        dynamicContinuation: true,
      });
      continue;
    }
    const crossPageDynamics = await assessDynamics({
      transitionKind: "page_advance",
      beforeCapture: postActuation,
      afterCapture: afterAdvanceCapture,
      trigger: {
        progressionKey: plan.progression.key,
        beforeUrl: postActuation.observation.url,
        afterUrl: afterAdvanceCapture.observation.url,
      },
      enteredValues: generationFieldResults
        .filter((result) => result.outcome.verified)
        .map((result) => ({
          fieldKey: result.field.key,
          label: result.field.label,
          value: result.field.testValue,
        })),
      branchDepth: samePageBranchDepth,
      onEvent,
      dynamicsRoot,
      recordId: `${stateRecordId}_advance`,
    });
    const postAdvanceEvidence = await captureEvidence({
      page,
      plan: stored.plan,
      fieldResults: [],
      sequence: generationJourney.evidence.length + 1,
      kind: "post_advance",
      label: `State reached after ${plan.progression.key}`,
      onEvent,
    });
    generationJourney = mergeTraversalResults(generationJourney, {
      actions: [
        {
          category: "form_advance",
          label: plan.progression.key,
          strategy: "stored LLM-authored progression action",
          timestamp: new Date().toISOString(),
          classification: "llm_generated_probe",
          rationale: plan.progression.rationale,
          source: `generated:${plan.proposalId}@${plan.scriptVersion}`,
          outcome: "landed",
          stateId: populatedEvidence.id,
        },
      ],
      evidence: [postAdvanceEvidence],
      observedFields: [],
      fieldsEntered: 0,
      entryFailures: 0,
      branchStates: 0,
      submissionsAttempted: 0,
      submissionsSucceeded: 0,
      finalSubmission: "not_requested",
      certificationStatus: "generation_in_progress",
      journeyUrls: [...journeyUrls],
      journeyComplete: true,
      entryMode: entry.mode,
      entryDetail: entry.detail,
    });
    if (crossPageDynamics.assessment.outcome !== "independent") {
      const detected =
        crossPageDynamics.assessment.outcome === "cross_page_dependency";
      const detail = detected
        ? "The LLM detected cross-page conditional behavior. Phase 1 records but does not execute cross-page branches."
        : "The LLM could not rule out cross-page conditional behavior. Phase 1 halts before new-page actuation.";
      await onEvent?.(
        detected
          ? "cross_page_branching"
          : "cross_page_dependency_uncertain",
        detail,
        {
          stateKey: plan.state.key,
          progressionKey: plan.progression.key,
          assessment: crossPageDynamics.assessment,
          beforeUrl: postActuation.observation.url,
          afterUrl: afterAdvanceCapture.observation.url,
        },
      );
      return couldNotTestGeneratedState({
        page,
        plan: stored.plan,
        fieldResults: [],
        onEvent,
        priorResult: generationJourney,
        journeyUrls: [...journeyUrls],
        entryMode: entry.mode,
        entryDetail: entry.detail,
        stateExaminations: sequence,
        detail: `${detail} No fields on the dependent page and no terminal control were actuated.`,
      });
    }
    const transitionPlan = {
      ...stored.plan,
      samePageBranchDepth,
      crossPageAssessment: crossPageDynamics.assessment,
    };
    const transitionStored = await writeAndLoadPlan(
      statePlansRoot,
      `${stateRecordId}_transition`,
      assertExecutablePlanSafety(transitionPlan),
      {
        schemaVersion: 1,
        kind: "generated_state_script_with_cross_page_assessment",
        runId,
        stateSequence: sequence,
        stateKey: transitionPlan.state.key,
        scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
        proposalId: transitionPlan.proposalId,
        model: transitionPlan.model,
        promptVersion: transitionPlan.promptVersion,
        sourceHash: sha256(planSource(transitionPlan)),
        generatedAt: new Date().toISOString(),
        semanticRecord: recordPath,
        dynamicsAssessmentId:
          crossPageDynamics.assessment.assessmentId,
      },
    );
    generationStates.push({
      proposal: generated.proposal,
      branchVariantProposals: probeExecution.variantProposals,
      branchVariantProvenance: probeExecution.variantProvenance,
      observation: captured.observation,
      provenance: generated.provenance,
      safety,
      plan: transitionStored.plan,
      sourceHash: transitionStored.sourceHash,
      dynamicContinuation: false,
    });
    samePageBranchDepth = 0;
  }

  if (
    generationStates.length === 0 ||
    generationStates.at(-1).plan.progression.kind !== "terminal_submit"
  ) {
    throw new Error(
      `Generated traversal did not reach a terminal state within ${MAX_GENERATED_STATES} states.`,
    );
  }

  const completePlan = {
    schemaVersion: 1,
    artifactId: `form_${sha256(initialUrl).slice(0, 24)}`,
    scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
    generatedAt: new Date().toISOString(),
    initialUrl,
    submissionResultCriteria: null,
    states: generationStates.map((item) => ({
      ...item.plan,
      progression: {
        ...item.plan.progression,
        dynamicContinuation: item.dynamicContinuation === true,
      },
    })),
    provenance: generationStates.flatMap((item) => [
      {
        proposalId: item.proposal.proposalId,
        model: item.provenance.model,
        promptVersion: item.provenance.promptVersion,
        responseId: item.provenance.responseId,
        sourceHash: item.sourceHash,
      },
      ...(item.branchVariantProposals || []).map((proposal, index) => {
        const variantPlan = (item.plan.choiceCoverage || []).find(
          (coverage) =>
            coverage.variantProposalId === proposal.proposalId,
        )?.variantPlan;
        const provenance = item.branchVariantProvenance?.[index] || {};
        return {
          proposalId: proposal.proposalId,
          model: provenance.model || item.provenance.model,
          promptVersion:
            provenance.promptVersion || item.provenance.promptVersion,
          responseId: provenance.responseId || null,
          sourceHash: variantPlan
            ? sha256(planSource(variantPlan))
            : null,
          branchVariant: true,
        };
      }),
    ]),
  };
  for (const statePlan of completePlan.states) {
    assertExecutablePlanSafety(statePlan);
  }
  assertTerminalEligible(completePlan);
  const scriptRoot = path.join(generatedRoot, "form-script");
  await mkdir(scriptRoot, { recursive: true });
  const finalStored = await writeAndLoadPlan(
    scriptRoot,
    `v${GENERATED_FORM_SCRIPT_VERSION}`,
    completePlan,
    {
      schemaVersion: 1,
      kind: "generated_form_script",
      artifactId: completePlan.artifactId,
      scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
      sourceHash: sha256(planSource(completePlan)),
      generatedAt: completePlan.generatedAt,
      stateCount: completePlan.states.length,
      modelCalls: completePlan.provenance.length,
    },
  );
  await writeFile(
    path.join(finalStored.directory, "contract.json"),
    stableJson(
      existingContractFromStates(generationStates, {
        includeBranchVariants: true,
      }),
    ),
    { encoding: "utf8", flag: "wx" },
  );
  await onEvent?.(
    "recon_script_selected",
    `Loaded generated form script ${completePlan.artifactId}@${GENERATED_FORM_SCRIPT_VERSION}.`,
    {
      id: completePlan.artifactId,
      version: GENERATED_FORM_SCRIPT_VERSION,
      sourceHash: finalStored.sourceHash,
      path: finalStored.directory,
      modelCalls: completePlan.provenance.length,
    },
  );

  await page.goto(initialUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  const evidence = [];
  const actions = [];
  const observedFields = [];
  let fieldsEntered = 0;
  let entryFailures = 0;
  let submissionsAttempted = 0;
  let submissionsSucceeded = 0;
  let finalSubmission = "blocked";
  let submissionResult = null;
  const replayJourneyUrls = new Set([page.url()]);
  let replayFailure = "";

  try {
    for (const [index, plan] of finalStored.plan.states.entries()) {
    assertExecutablePlanSafety(plan);
    assertReplayAuthorities(plan, executionMode, fixtureAuthorities);
    const toolbox = new PhysicsToolbox(page);
    await toolbox.prepare();
    const replayedProbes = await replayChoiceProbes({
      page,
      toolbox,
      plan,
      executionMode,
      fixtureAuthorities,
      authorizeWrites,
      onEvent,
      evidenceSequenceStart: evidence.length + 1,
    });
    actions.push(...replayedProbes.actions);
    evidence.push(...replayedProbes.evidence);
    observedFields.push(...replayedProbes.observedFields);
    fieldsEntered += replayedProbes.fieldsEntered;
    entryFailures += replayedProbes.entryFailures;
    const stateActionStart = actions.length;
    const results = await enterPlanFields({
      page,
      toolbox,
      plan,
      authorizeWrites,
      onEvent,
      source: `replay:${completePlan.artifactId}@${completePlan.scriptVersion}`,
    });
    fieldsEntered += results.filter((result) => result.outcome.verified).length;
    entryFailures += countEntryFailures(results);
    for (const field of plan.fields) {
      const result = results.find((item) => item.field.key === field.key);
      observedFields.push(
        observedField(field, plan, result, plan.state.key),
      );
      actions.push({
        category: "field_entry",
        label: field.label,
        strategy: "stored LLM-authored script",
        timestamp: new Date().toISOString(),
        classification: "deterministic_replay",
        rationale: field.rationale,
        source: `generated:${completePlan.artifactId}@${completePlan.scriptVersion}`,
        testValue: field.testValue,
        outcome: result?.outcome.verified ? "landed" : "could_not_test",
        ...(result?.outcome.detail
          ? {
              failureCode: result.outcome.failureCode,
              error: result.outcome.detail,
            }
          : {}),
      });
    }
    const evidenceKind =
      plan.progression.dynamicContinuation
        ? "branch"
        : plan.progression.kind === "terminal_submit"
        ? executionMode === "fixture_submit"
          ? "pre_advance"
          : "blocked_final"
        : "populated";
    const populatedEvidence = await captureEvidence({
      page,
      plan,
      fieldResults: results,
      sequence: evidence.length + 1,
      kind: evidenceKind,
      label:
        plan.progression.dynamicContinuation
          ? `Conditional state revealed by ${plan.state.description}`
          : plan.progression.kind === "terminal_submit"
          ? "Completed generated values at the terminal boundary"
          : `Completed generated values for ${plan.state.description}`,
      onEvent,
    });
    evidence.push(populatedEvidence);
    for (const action of actions.slice(stateActionStart)) {
      action.stateId = populatedEvidence.id;
    }
    if (
      results.some(
        (result) =>
          result.field.required &&
          (!result.outcome.verified || result.outcome.skipped),
      )
    ) {
      throw new Error(
        `Validation replay failed a required field in ${plan.state.key}.`,
      );
    }
    await clearInactiveBranchVariantFields({
      toolbox,
      plan,
      onEvent,
    });
    const selectedVariants = await populateSelectedBranchVariants({
      page,
      toolbox,
      plan,
      authorizeWrites,
      onEvent,
      evidenceSequenceStart: evidence.length + 1,
      source: `replay-final-branch:${completePlan.artifactId}@${completePlan.scriptVersion}`,
    });
    actions.push(...selectedVariants.actions);
    evidence.push(...selectedVariants.evidence);
    observedFields.push(...selectedVariants.observedFields);
    fieldsEntered += selectedVariants.fieldsEntered;
    entryFailures += selectedVariants.entryFailures;
    if (plan.progression.dynamicContinuation) {
      if (plan.progression.samePageRevealAction) {
        const advanced = await advanceWithPlan({
          page,
          toolbox,
          plan,
          authorizeWrites,
          onEvent,
        });
        if (!advanced.clicked) {
          throw new Error(
            `Validation replay could not execute same-page reveal ${plan.progression.key}.`,
          );
        }
      }
      actions.push({
        category: "branch_reveal",
        label: plan.state.description,
        strategy: "stored LLM-authored script",
        timestamp: new Date().toISOString(),
        classification: "deterministic_replay",
        rationale:
          "This state intentionally reveals another same-page state before progression.",
        source: `generated:${completePlan.artifactId}@${completePlan.scriptVersion}`,
        outcome: "landed",
        stateId: populatedEvidence.id,
      });
      continue;
    }
    if (plan.progression.kind === "terminal_submit") {
      if (executionMode === "fixture_submit") {
        submissionsAttempted += 1;
        const terminalResult = await submitCrawlTerminal({
          page,
          toolbox,
          plan,
          authorizeWrites,
          onEvent,
          storedResultCriteria: null,
          allowResultModel: true,
        });
        submissionResult = terminalResult;
        if (terminalResult.verified) {
          submissionsSucceeded += 1;
          finalSubmission = "submitted";
        } else {
          finalSubmission = "submitted_unverified";
        }
        evidence.push(
          await captureEvidence({
            page,
            plan,
            fieldResults: results,
            sequence: evidence.length + 1,
            kind: "submitted",
            label: terminalResult.verified
              ? "Generated crawl-time submission verified"
              : terminalResult.outcome === "failure"
                ? "Generated crawl-time submission failed"
                : "Generated crawl-time submission could not be verified",
            onEvent,
          }),
        );
      } else {
        actions.push({
          category: "final_submit_blocked",
          label: plan.progression.key,
          strategy: "generated script terminal boundary",
          timestamp: new Date().toISOString(),
          classification: "human_review",
          rationale: plan.progression.rationale,
          source: `generated:${completePlan.artifactId}@${completePlan.scriptVersion}`,
          outcome: "landed",
          stateId: populatedEvidence.id,
        });
      }
      break;
    }
    const advanced = await advanceWithPlan({
      page,
      toolbox,
      plan,
      authorizeWrites,
      onEvent,
    });
    actions.push({
      category: "form_advance",
      label: plan.progression.key,
      strategy: "stored LLM-authored script",
      timestamp: new Date().toISOString(),
      classification: "deterministic_replay",
      rationale: plan.progression.rationale,
      source: `generated:${completePlan.artifactId}@${completePlan.scriptVersion}`,
      outcome: advanced.clicked ? "landed" : "could_not_test",
      stateId: populatedEvidence.id,
      ...(!advanced.clicked
        ? {
            failureCode: "advance_no_navigation",
            error: advanced.detail || "Generated advance did not execute.",
          }
        : {}),
    });
    if (!advanced.clicked) {
      throw new Error(`Validation replay could not advance ${plan.state.key}.`);
    }
    replayJourneyUrls.add(page.url());
    evidence.push(
      await captureEvidence({
        page,
        plan,
        fieldResults: [],
        sequence: evidence.length + 1,
        kind: "post_advance",
        label: `State reached after ${plan.progression.key}`,
        onEvent,
      }),
    );
    }
  } catch (error) {
    replayFailure =
      error instanceof Error ? error.message : String(error);
    await onEvent?.(
      "generated_script_replay_failed",
      `Fresh generated-script replay halted safely: ${replayFailure}`,
      {
        artifactId: completePlan.artifactId,
        scriptVersion: completePlan.scriptVersion,
        evidenceRetained:
          generationJourney.evidence.length + evidence.length,
        fieldsEntered:
          generationJourney.fieldsEntered + fieldsEntered,
        entryFailures:
          generationJourney.entryFailures + entryFailures,
      },
    );
  }

  if (replayFailure) {
    return mergeTraversalResults(generationJourney, {
      actions,
      evidence,
      observedFields,
      fieldsEntered,
      entryFailures,
      branchStates: generatedBranchStateCount(finalStored.plan),
      stateExaminations: completePlan.provenance.length,
      submissionsAttempted,
      submissionsSucceeded,
      submissionResult,
      finalSubmission,
      certificationStatus: "could_not_test",
      reconScriptId: completePlan.artifactId,
      reconScriptVersion: completePlan.scriptVersion,
      generatedArtifact: {
        artifactId: completePlan.artifactId,
        scriptVersion: completePlan.scriptVersion,
        sourceHash: finalStored.sourceHash,
        path: finalStored.directory,
        modelCalls: completePlan.provenance.length,
        modelCallsThisRun: completePlan.provenance.length,
        states: completePlan.states.length,
        lifecycle: "generated_replay_failed",
      },
      browserMode,
      journeyUrls: [...replayJourneyUrls],
      journeyComplete: false,
      haltReason: replayFailure,
      entryMode: entry.mode,
      entryDetail: entry.detail,
    });
  }

  const result = {
    actions,
    evidence,
    observedFields,
    fieldsEntered,
    entryFailures,
    branchStates: generatedBranchStateCount(finalStored.plan),
    stateExaminations: completePlan.provenance.length,
    submissionsAttempted,
    submissionsSucceeded,
    submissionResult,
    finalSubmission,
    certificationStatus:
      finalSubmission === "submitted"
        ? "fixture_submitted"
        : "generated_script_validated",
    reconScriptId: completePlan.artifactId,
    reconScriptVersion: completePlan.scriptVersion,
    generatedArtifact: {
      artifactId: completePlan.artifactId,
      scriptVersion: completePlan.scriptVersion,
      sourceHash: finalStored.sourceHash,
      path: finalStored.directory,
      modelCalls: completePlan.provenance.length,
      modelCallsThisRun: completePlan.provenance.length,
      states: completePlan.states.length,
      lifecycle: "generated_and_validated",
    },
    browserMode,
    journeyUrls: [...replayJourneyUrls],
    journeyComplete: true,
    haltReason: "",
    entryMode: entry.mode,
    entryDetail: entry.detail,
  };
  let publicationCandidate = finalStored;
  if (submissionResult?.verified && submissionResult.criteria) {
    const resultAwarePlan = {
      ...finalStored.plan,
      submissionResultCriteria: submissionResult.criteria,
    };
    publicationCandidate = await writeAndLoadPlan(
      scriptRoot,
      `validated-v${GENERATED_FORM_SCRIPT_VERSION}`,
      resultAwarePlan,
      {
        schemaVersion: 1,
        kind: "generated_form_script_with_submission_result",
        artifactId: resultAwarePlan.artifactId,
        scriptVersion: GENERATED_FORM_SCRIPT_VERSION,
        sourceHash: sha256(planSource(resultAwarePlan)),
        generatedAt: new Date().toISOString(),
        stateCount: resultAwarePlan.states.length,
        modelCalls: resultAwarePlan.provenance.length,
        submissionAssessmentId:
          submissionResult.criteria.assessmentId,
      },
    );
  }
  if (
    executionMode === "fixture_submit" &&
    !submissionResult?.verified
  ) {
    await onEvent?.(
      "generated_script_not_published",
      "The generated script was not published because the rendered submission result was not verified as successful.",
      {
        id: completePlan.artifactId,
        renderedOutcome: submissionResult?.outcome || "unknown",
        detail: submissionResult?.detail || "",
      },
    );
    result.generatedArtifact = {
      ...result.generatedArtifact,
      lifecycle: "generated_not_published",
    };
    return result;
  }
  const published = await publishFormScript(
    scriptRegistryRoot,
    publicationCandidate,
  );
  result.reconScriptVersion = published.plan.scriptVersion;
  result.generatedArtifact = {
    ...result.generatedArtifact,
    scriptVersion: published.plan.scriptVersion,
    sourceHash: published.sourceHash,
    path: published.directory,
    lifecycle: "generated_and_published",
  };
  await onEvent?.(
    "generated_script_published",
    `Published validated generated script ${completePlan.artifactId}@${published.plan.scriptVersion} for deterministic reuse.`,
    {
      id: completePlan.artifactId,
      version: published.plan.scriptVersion,
      sourceHash: published.sourceHash,
      path: published.directory,
    },
  );
  return result;
}

function everyPlanField(plan) {
  const rows = [];
  const visit = (statePlan, branch = null) => {
    for (const field of statePlan?.fields || []) {
      rows.push({ field, branch });
    }
    for (const coverage of statePlan?.choiceCoverage || []) {
      if (coverage.variantPlan) {
        visit(coverage.variantPlan, {
          fieldKey: coverage.fieldKey,
          value: coverage.value,
          classification: coverage.classification,
        });
      }
    }
  };
  for (const state of plan?.states || []) visit(state);
  return [
    ...new Map(rows.map((row) => [row.field.key, row])).values(),
  ];
}

function inputPropertyFor(field) {
  const controlType = String(field.controlType || "text");
  const browserPattern = {
    "datetime-local":
      "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?$",
    month: "^\\d{4}-(?:0[1-9]|1[0-2])$",
    week: "^\\d{4}-W(?:0[1-9]|[1-4]\\d|5[0-3])$",
    time: "^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d{1,3})?)?$",
  }[controlType];
  const description = [
    field.label,
    field.required ? "Required when this field is active." : "Optional.",
    field.sensitive ? "Sensitive; never persisted in execution logs." : "",
    {
      date: "Supply an ISO calendar date in YYYY-MM-DD format.",
      "datetime-local":
        "Supply a local date and time in YYYY-MM-DDTHH:mm format; no timezone offset.",
      month: "Supply a calendar month in YYYY-MM format.",
      week: "Supply an ISO week in YYYY-Www format.",
      time: "Supply a time in 24-hour HH:mm format.",
    }[controlType] || "",
  ]
    .filter(Boolean)
    .join(" ");
  if (controlType === "file") {
    return {
      type: "object",
      description,
      required: ["filename", "contentType", "contentBase64"],
      properties: {
        filename: { type: "string", minLength: 1 },
        contentType: { type: "string", minLength: 1 },
        contentBase64: {
          type: "string",
          contentEncoding: "base64",
        },
      },
      additionalProperties: false,
      "x-formweave-upload-constraints": field.upload || {},
    };
  }
  if (["checkbox", "switch"].includes(controlType)) {
    return { type: "boolean", description };
  }
  if (controlType === "number") {
    const minimum =
      field.validation?.min !== undefined &&
      field.validation?.min !== null &&
      String(field.validation.min).trim() !== ""
        ? Number(field.validation.min)
        : null;
    const maximum =
      field.validation?.max !== undefined &&
      field.validation?.max !== null &&
      String(field.validation.max).trim() !== ""
        ? Number(field.validation.max)
        : null;
    const step =
      field.validation?.step !== undefined &&
      field.validation?.step !== null &&
      String(field.validation.step).trim() !== "" &&
      String(field.validation.step).toLowerCase() !== "any"
        ? Number(field.validation.step)
        : null;
    return {
      type: "number",
      description,
      ...(Number.isFinite(minimum) ? { minimum } : {}),
      ...(Number.isFinite(maximum) ? { maximum } : {}),
      ...(Number.isFinite(step) && step > 0 ? { multipleOf: step } : {}),
    };
  }
  const values = (field.options || [])
    .map((option) => option.value)
    .filter((value) => String(value).trim() !== "");
  return {
    type: "string",
    description,
    ...(["date", "email", "url"].includes(controlType)
      ? {
          format: {
            date: "date",
            email: "email",
            url: "uri",
          }[controlType],
        }
      : {}),
    ...(browserPattern ? { pattern: browserPattern } : {}),
    ...(values.length ? { enum: values } : {}),
    ...(field.validation?.pattern && !browserPattern
      ? { pattern: field.validation.pattern }
      : {}),
    ...(field.validation?.minLength
      ? { minLength: Number(field.validation.minLength) }
      : {}),
    ...(field.validation?.maxLength
      ? { maxLength: Number(field.validation.maxLength) }
      : {}),
  };
}

function schemaTestValueFor(field, property) {
  if (
    field.actuate === false ||
    field.browserConstraints?.disabled === true ||
    field.browserConstraints?.readOnly === true
  ) {
    return undefined;
  }
  if (field.controlType === "file") {
    const upload = generatedUploadPayload(field.upload || {});
    return upload.ok
      ? {
          filename: upload.name,
          contentType: upload.mimeType,
          contentBase64: upload.buffer.toString("base64"),
        }
      : undefined;
  }
  const value = field.testValue;
  if (value === undefined || value === null) return undefined;
  if (property.type === "boolean") {
    if (typeof value === "boolean") return value;
    if (String(value).toLowerCase() === "true") return true;
    if (String(value).toLowerCase() === "false") return false;
    return undefined;
  }
  if (property.type === "number" || property.type === "integer") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  if (property.type === "string") return String(value);
  return undefined;
}

export function approvedInputSchemaForPlan(plan) {
  const rows = everyPlanField(plan);
  const testData = {};
  const properties = Object.fromEntries(
    rows.map(({ field, branch }) => {
      const property = inputPropertyFor(field);
      const testValue = schemaTestValueFor(field, property);
      if (testValue !== undefined) testData[field.key] = testValue;
      return [
        field.key,
        {
          ...property,
          "x-formweave-label": field.label,
          "x-formweave-control": field.controlType,
          "x-formweave-sensitive": Boolean(field.sensitive),
          "x-formweave-native-name": field.rawIdentity?.name || field.key,
          "x-formweave-options": (field.options || []).map((option) => ({
            value: option.value,
            label: option.label,
          })),
          "x-formweave-input-format":
            {
              date: "YYYY-MM-DD",
              "datetime-local": "YYYY-MM-DDTHH:mm",
              month: "YYYY-MM",
              week: "YYYY-Www",
              time: "HH:mm",
            }[field.controlType] || null,
          "x-formweave-browser-constraints": {
            rawType:
              field.browserConstraints?.rawType || field.controlType || "",
            placeholder: field.browserConstraints?.placeholder || "",
            autocomplete: field.browserConstraints?.autocomplete || "",
            inputMode: field.browserConstraints?.inputMode || "",
            min: field.validation?.min || "",
            max: field.validation?.max || "",
            step: field.validation?.step || "",
            multiple: field.browserConstraints?.multiple === true,
            disabled: field.browserConstraints?.disabled === true,
            readOnly: field.browserConstraints?.readOnly === true,
          },
          ...(field.browserConstraints?.disabled === true ||
          field.browserConstraints?.readOnly === true
            ? { readOnly: true }
            : {}),
          "x-formweave-legal-acceptance-type":
            field.legalAcceptanceType || null,
          ...(branch ? { "x-formweave-branch": branch } : {}),
          ...(testValue !== undefined
            ? {
                "x-formweave-test-value": testValue,
                "x-formweave-test-value-source":
                  field.controlType === "file"
                    ? "crawler-generated-harmless-upload"
                    : "llm-authored-generated-script",
              }
            : {}),
        },
      ];
    }),
  );
  const baseRequired = rows
    .filter(({ field, branch }) => !branch && field.required)
    .map(({ field }) => field.key);
  const conditional = rows
    .filter(({ field, branch }) => branch && field.required)
    .map(({ field, branch }) => ({
      if: {
        properties: {
          [branch.fieldKey]: { const: branch.value },
        },
        required: [branch.fieldKey],
      },
      then: { required: [field.key] },
    }));
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    "x-formweave-contract-version": 3,
    "x-formweave-test-data": testData,
    "x-formweave-test-data-purpose":
      "Synthetic values used to validate the pinned crawl-generated script. They are debugging and approval aids, not real applicant data.",
    "x-formweave-test-data-script": {
      artifactId: plan.artifactId || null,
      scriptVersion: plan.scriptVersion || null,
      proposalId: plan.proposalId || null,
    },
    type: "object",
    properties,
    required: [...new Set(baseRequired)].sort(),
    additionalProperties: false,
    ...(conditional.length ? { allOf: conditional } : {}),
  };
}

function scalarInput(value) {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function sameInputValue(left, right) {
  return `${typeof left}:${String(left)}` ===
    `${typeof right}:${String(right)}`;
}

function validCalendarDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function browserFormatIssue(controlType, value) {
  const text = String(value);
  if (controlType === "date" && !validCalendarDate(text)) {
    return "Date inputs require YYYY-MM-DD, for example 1980-12-14.";
  }
  if (
    controlType === "datetime-local" &&
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(
      text,
    )
  ) {
    return "Local date-time inputs require YYYY-MM-DDTHH:mm without a timezone offset.";
  }
  if (
    controlType === "month" &&
    !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(text)
  ) {
    return "Month inputs require YYYY-MM.";
  }
  if (
    controlType === "week" &&
    !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(text)
  ) {
    return "Week inputs require YYYY-Www.";
  }
  if (
    controlType === "time" &&
    !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(text)
  ) {
    return "Time inputs require 24-hour HH:mm.";
  }
  if (
    controlType === "email" &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
  ) {
    return "Email inputs require a valid email address.";
  }
  if (controlType === "url") {
    try {
      new URL(text);
    } catch {
      return "URL inputs require an absolute URL.";
    }
  }
  return "";
}

function validateProvidedValue(field, value) {
  if (field.controlType === "file") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.filename !== "string" ||
      typeof value.contentType !== "string" ||
      typeof value.contentBase64 !== "string"
    ) {
      return "File input requires filename, contentType, and contentBase64.";
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value.contentBase64)) {
      return "contentBase64 is not valid base64.";
    }
    const bytes = Buffer.from(value.contentBase64, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > 5_000_000) {
      return "Decoded files must contain 1 to 5,000,000 bytes.";
    }
    const accept = String(field.upload?.accept || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (
      accept.length > 0 &&
      !accept.includes(value.contentType.toLowerCase()) &&
      !accept.some(
        (item) =>
          item.startsWith(".") &&
          value.filename.toLowerCase().endsWith(item),
      ) &&
      !accept.some(
        (item) =>
          item.endsWith("/*") &&
          value.contentType.toLowerCase().startsWith(item.slice(0, -1)),
      )
    ) {
      return `File does not satisfy accept="${field.upload.accept}".`;
    }
    return "";
  }
  if (["checkbox", "switch"].includes(field.controlType)) {
    return typeof value === "boolean"
      ? ""
      : "Checkbox and switch inputs require a boolean.";
  }
  if (field.controlType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "Number inputs require a finite JSON number.";
    }
    const min =
      field.validation?.min === "" ? null : Number(field.validation?.min);
    const max =
      field.validation?.max === "" ? null : Number(field.validation?.max);
    if (Number.isFinite(min) && value < min) return `Value is below ${min}.`;
    if (Number.isFinite(max) && value > max) return `Value is above ${max}.`;
    const step =
      field.validation?.step === "" ||
      String(field.validation?.step || "").toLowerCase() === "any"
        ? null
        : Number(field.validation?.step);
    if (Number.isFinite(step) && step > 0) {
      const base = Number.isFinite(min) ? min : 0;
      const quotient = (value - base) / step;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
        return `Value does not satisfy the crawled step size ${step}.`;
      }
    }
    return "";
  }
  if (!scalarInput(value) || typeof value !== "string") {
    return "This input requires a string.";
  }
  const formatIssue = browserFormatIssue(field.controlType, value);
  if (formatIssue) return formatIssue;
  if (
    ["date", "datetime-local", "month", "week", "time"].includes(
      field.controlType,
    )
  ) {
    const min = String(field.validation?.min || "");
    const max = String(field.validation?.max || "");
    if (min && value < min) return `Value is earlier than ${min}.`;
    if (max && value > max) return `Value is later than ${max}.`;
  }
  const allowed = (field.options || [])
    .map((option) => option.value)
    .filter((option) => String(option).trim() !== "");
  if (
    allowed.length > 0 &&
    !allowed.some((option) => sameInputValue(option, value))
  ) {
    return "Value is outside the crawled option contract.";
  }
  if (field.validation?.pattern) {
    try {
      if (!new RegExp(`^(?:${field.validation.pattern})$`).test(value)) {
        return "Value does not satisfy the crawled validation pattern.";
      }
    } catch {
      return "The crawled validation pattern is invalid.";
    }
  }
  if (
    field.validation?.minLength &&
    value.length < Number(field.validation.minLength)
  ) {
    return `Value is shorter than ${field.validation.minLength}.`;
  }
  if (
    field.validation?.maxLength &&
    value.length > Number(field.validation.maxLength)
  ) {
    return `Value is longer than ${field.validation.maxLength}.`;
  }
  return "";
}

export function validateApprovedInput(plan, inputData) {
  if (!inputData || typeof inputData !== "object" || Array.isArray(inputData)) {
    return {
      ok: false,
      issues: [
        {
          fieldKey: "",
          code: "type_mismatch",
          detail: "data must be a JSON object keyed by the crawl contract.",
        },
      ],
    };
  }
  const rows = everyPlanField(plan);
  const byKey = new Map(rows.map((row) => [row.field.key, row]));
  const issues = [];
  for (const key of Object.keys(inputData)) {
    if (!byKey.has(key)) {
      issues.push({
        fieldKey: key,
        code: "outside_contract",
        detail: "Input key is not declared by this form.",
      });
    }
  }
  for (const { field, branch } of rows) {
    const active =
      !branch ||
      Object.hasOwn(inputData, branch.fieldKey) &&
        sameInputValue(inputData[branch.fieldKey], branch.value);
    if (!active && Object.hasOwn(inputData, field.key)) {
      issues.push({
        fieldKey: field.key,
        code: "outside_certified_branch",
        detail: `Field is inactive unless ${branch.fieldKey} equals ${String(branch.value)}.`,
      });
      continue;
    }
    if (active && field.required && !Object.hasOwn(inputData, field.key)) {
      issues.push({
        fieldKey: field.key,
        code: "validation_blocked",
        detail: "A required active field is missing.",
      });
      continue;
    }
    if (active && Object.hasOwn(inputData, field.key)) {
      if (
        field.browserConstraints?.disabled === true ||
        field.browserConstraints?.readOnly === true
      ) {
        issues.push({
          fieldKey: field.key,
          code: "outside_contract",
          detail:
            "The crawled control is disabled or read-only and cannot accept client input.",
        });
        continue;
      }
      const detail = validateProvidedValue(field, inputData[field.key]);
      if (detail) {
        issues.push({
          fieldKey: field.key,
          code: "type_mismatch",
          detail,
        });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

function providedFile(value) {
  return {
    name: path.basename(value.filename).slice(0, 180),
    mimeType: value.contentType,
    buffer: Buffer.from(value.contentBase64, "base64"),
  };
}

function planWithApprovedValues(plan, inputData) {
  return {
    ...plan,
    fields: (plan.fields || []).map((field) => {
      const supplied = Object.hasOwn(inputData, field.key);
      return {
        ...field,
        actuate: supplied,
        testValue:
          supplied && field.controlType !== "file"
            ? inputData[field.key]
            : field.testValue,
        ...(supplied && field.controlType === "file"
          ? { providedFile: providedFile(inputData[field.key]) }
          : {}),
      };
    }),
  };
}

function selectedVariantPlans(plan, inputData) {
  return (plan.choiceCoverage || [])
    .filter(
      (coverage) =>
        coverage.variantPlan &&
        Object.hasOwn(inputData, coverage.fieldKey) &&
        sameInputValue(inputData[coverage.fieldKey], coverage.value),
    )
    .map((coverage) => planWithApprovedValues(coverage.variantPlan, inputData));
}

export async function loadApprovedFormScript(directory) {
  return loadPlanDirectory(directory);
}

export async function executeApprovedFormScript({
  page,
  stored,
  inputData,
  submit,
  authorizeWrites,
  onEvent,
}) {
  const completePlan = stored.plan;
  assertTerminalEligible(completePlan);
  const validation = validateApprovedInput(completePlan, inputData);
  if (!validation.ok) {
    return {
      status: "failed",
      outcome: "validation_blocked",
      failureCode: validation.issues[0]?.code || "validation_blocked",
      detail: validation.issues
        .map((issue) => `${issue.fieldKey || "data"}: ${issue.detail}`)
        .join(" "),
      issues: validation.issues,
      fieldsAttempted: 0,
      fieldsVerified: 0,
      fieldsFailed: 0,
      submitted: false,
      submissionResult: null,
    };
  }
  let fieldsAttempted = 0;
  let fieldsVerified = 0;
  let fieldsFailed = 0;
  let submissionResult = null;
  for (const originalPlan of completePlan.states) {
    if (
      originalPlan.crossPageAssessment &&
      originalPlan.crossPageAssessment.outcome !== "independent"
    ) {
      return {
        status: "failed",
        outcome: "unsupported_cross_page_branch",
        failureCode:
          originalPlan.crossPageAssessment.outcome ===
          "cross_page_dependency"
            ? "cross_page_branching"
            : "cross_page_dependency_uncertain",
        detail:
          originalPlan.crossPageAssessment.outcome ===
          "cross_page_dependency"
            ? "Cross-page conditional execution is intentionally unsupported."
            : "Approved execution requires a high-confidence independent page advance.",
        issues: [],
        fieldsAttempted,
        fieldsVerified,
        fieldsFailed,
        submitted: false,
        submissionResult: null,
      };
    }
    const plan = planWithApprovedValues(originalPlan, inputData);
    assertExecutablePlanSafety(plan);
    const toolbox = new PhysicsToolbox(page);
    await toolbox.prepare();
    const results = await enterPlanFields({
      page,
      toolbox,
      plan,
      authorizeWrites,
      onEvent,
      source: `approved-live:${completePlan.artifactId}@${completePlan.scriptVersion}`,
      valueMode: "approved_live",
    });
    fieldsAttempted += results.filter((result) => result.field.actuate).length;
    fieldsVerified += results.filter((result) => result.outcome.verified).length;
    fieldsFailed += results.filter(
      (result) => result.field.actuate && !result.outcome.verified,
    ).length;
    const firstFailure = results.find(
      (result) => result.field.actuate && !result.outcome.verified,
    );
    if (firstFailure) {
      return {
        status: "failed",
        outcome: "actuation_failed",
        failureCode:
          firstFailure.outcome.failureCode || "actuation_unverified",
        detail:
          firstFailure.outcome.detail ||
          `Could not verify ${firstFailure.field.label}.`,
        issues: [
          {
            fieldKey: firstFailure.field.key,
            code:
              firstFailure.outcome.failureCode || "actuation_unverified",
            detail:
              firstFailure.outcome.detail ||
              `Could not verify ${firstFailure.field.label}.`,
          },
        ],
        fieldsAttempted,
        fieldsVerified,
        fieldsFailed,
        submitted: false,
        submissionResult: null,
      };
    }
    for (const variantPlan of selectedVariantPlans(originalPlan, inputData)) {
      const variantResults = await enterPlanFields({
        page,
        toolbox,
        plan: variantPlan,
        authorizeWrites,
        onEvent,
        source: `approved-live-branch:${completePlan.artifactId}@${completePlan.scriptVersion}`,
        valueMode: "approved_live",
      });
      fieldsAttempted += variantResults.filter(
        (result) => result.field.actuate,
      ).length;
      fieldsVerified += variantResults.filter(
        (result) => result.outcome.verified,
      ).length;
      fieldsFailed += variantResults.filter(
        (result) => result.field.actuate && !result.outcome.verified,
      ).length;
      const variantFailure = variantResults.find(
        (result) => result.field.actuate && !result.outcome.verified,
      );
      if (variantFailure) {
        return {
          status: "failed",
          outcome: "actuation_failed",
          failureCode:
            variantFailure.outcome.failureCode || "actuation_unverified",
          detail:
            variantFailure.outcome.detail ||
            `Could not verify ${variantFailure.field.label}.`,
          issues: [
            {
              fieldKey: variantFailure.field.key,
              code:
                variantFailure.outcome.failureCode ||
                "actuation_unverified",
              detail:
                variantFailure.outcome.detail ||
                `Could not verify ${variantFailure.field.label}.`,
            },
          ],
          fieldsAttempted,
          fieldsVerified,
          fieldsFailed,
          submitted: false,
          submissionResult: null,
        };
      }
    }
    if (plan.progression.kind === "terminal_submit") {
      if (!submit) {
        return {
          status: "completed",
          outcome: "dry_run_completed",
          failureCode: null,
          detail: "Approved data was entered and verified; terminal submission was not requested.",
          issues: [],
          fieldsAttempted,
          fieldsVerified,
          fieldsFailed,
          submitted: false,
          submissionResult: null,
        };
      }
      submissionResult = await submitCrawlTerminal({
        page,
        toolbox,
        plan,
        authorizeWrites,
        onEvent,
        storedResultCriteria: completePlan.submissionResultCriteria || null,
        allowResultModel: !completePlan.submissionResultCriteria,
        approvedLive: true,
        redactionValues: Object.values(inputData).flatMap((value) => {
          if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value)
          ) {
            return value.filename ? [value.filename] : [];
          }
          return [value];
        }),
      });
      return {
        status: submissionResult.verified ? "completed" : "failed",
        outcome: submissionResult.verified
          ? "submission_verified"
          : "submission_unverified",
        failureCode: submissionResult.verified
          ? null
          : "terminal_submission_unverified",
        detail: submissionResult.detail,
        issues: [],
        fieldsAttempted,
        fieldsVerified,
        fieldsFailed,
        submitted: true,
        submissionResult,
      };
    }
    const advanced = await advanceWithPlan({
      page,
      toolbox,
      plan,
      authorizeWrites,
      onEvent,
    });
    if (!advanced.clicked) {
      return {
        status: "failed",
        outcome: "advance_failed",
        failureCode: "advance_no_navigation",
        detail: advanced.detail || `Could not advance ${plan.state.key}.`,
        issues: [],
        fieldsAttempted,
        fieldsVerified,
        fieldsFailed,
        submitted: false,
        submissionResult: null,
      };
    }
  }
  return {
    status: "failed",
    outcome: "terminal_not_reached",
    failureCode: "terminal_not_reached",
    detail: "The approved script ended without reaching its terminal state.",
    issues: [],
    fieldsAttempted,
    fieldsVerified,
    fieldsFailed,
    submitted: false,
    submissionResult,
  };
}
