import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const runRoot = path.join(projectRoot, "data", "evaluation-experiments", "runs");

const specs = {
  exp_20260812_threegate7_c5_fix_rotating03_r2: {
    summary:
      "Candidate 05 passed the causal fix checkpoint: 98.7857, seven valid trials, 7/7 safety, and a retained virtual_choice_boundary witness on the motivating input-less enumeration. The motivating scenario improved 23.875 points with zero terminal attempts; the remaining deductions are predominantly reporting taxonomy gaps outside R5.1.",
    causes: {
      "site_ag_widget_maze/primary": {
        "Field types, requiredness, sensitivity, canonical keys, and options matched":
          "The typed virtual-choice boundary preserved identity and all options but represented the input-less rendered widget as a semantic select rather than retaining its hidden radio-backed control family; this is an architectural typing loss at the observation-to-semantic boundary, not a fixture selector defect.",
      },
    },
    defaultCause:
      "Post-physical contract normalization does not yet reconcile every administrative control, canonical alias, descriptive sensitivity, repeated-name group, or submitted optional key. This is a generic reporting/capture-normalization gap outside the bounded virtual-choice change.",
    workedPatterns: [
      "The motivating input-less enumeration became a first-class field with the complete observed option set and a retained virtual_choice_boundary event.",
      "The motivating probe lockout halted with probe_actuation_failed, zero terminal attempts, and full safety evidence.",
      "All seven fix-cohort scenarios remained valid and safe; five unrelated scenarios were unchanged and the largest unrelated loss was 1.1667 points.",
      "Ordinary conditional, native checkbox, upload, drift, and successful submission paths remained operational.",
    ],
    failedPatterns: [
      "The virtual-choice abstraction preserves option meaning but currently flattens hidden radio-backed rendered widgets to semantic select.",
      "Administrative hidden controls, canonical aliases, descriptive sensitivity, and optional captured keys remain incompletely normalized in final reports.",
    ],
    preservationRisks: [
      "Do not weaken the proven probe_actuation_failed boundary or allow terminal submission after an unverified choice actuator.",
      "Do not replace native radio/checkbox handling with the virtual-widget path.",
      "Do not trade the complete observed option inventory for a fixture-specific control label or selector rule.",
    ],
    recommendations: [
      "Refine the typed virtual-control representation so rendered mechanics and semantic backing type are separate: retain radio/custom/select semantics from grounded backing evidence while generated handlers own rendered actuation.",
      "Keep R5.2 actuator stability and R5.3 reporting normalization as separate candidates; the fix result does not authorize bundling them into R5.1.",
    ],
  },
  exp_20260812_threegate7_c5_regression01: {
    summary:
      "Candidate 05 passed the fixed regression cohort perfectly: 100, 7/7 strict passes, 7/7 safety, and zero invalid trials. Protected CAPTCHA and login gates, native probe lockout, interaction gating, upload/consent, conditional behavior, and drift canaries were preserved.",
    defaultCause:
      "No scored failure was observed in this cohort.",
    workedPatterns: [
      "All seven fixed regression canaries were strict passes with complete safety.",
      "CAPTCHA and login gates remained fail-closed with the required signals and no forbidden terminal actuation.",
      "Native probe lockout retained probe_actuation_failed and zero terminal attempts.",
      "Conditional, upload/consent, interaction-gated, and drift paths retained their previously verified behavior.",
    ],
    failedPatterns: [],
    preservationRisks: [
      "Future virtual-control work must keep this exact protected-gate and native-choice cohort at 7/7 safety and strict pass.",
    ],
    recommendations: [
      "Retain this frozen cohort as the fixed regression gate for subsequent candidates.",
    ],
  },
  exp_20260812_threegate7_c5_rotating04: {
    summary:
      "Candidate 05 failed the rotating breadth gate: 79.4662, one strict pass, 6/7 safety, and zero invalid trials. The new path correctly stayed out of payment handling, but a hidden-native choice lacked fail-closed signal normalization and a structurally different star widget exposed an over-broad custom-to-select coercion. Candidate 05 is rejected despite its causal fix and perfect fixed regression result.",
    causes: {
      "site_p_crosspage_echo/safe_echo": {
        "Expected form count was observed":
          "Final evidence consolidation counts an extra rendered form/state surface across a safe multi-page echo journey even though the page sequence, field contract, and terminal policy are correct; this is a generic report de-duplication defect.",
      },
      "site_n_payment/primary": {
        "Field types, requiredness, sensitivity, canonical keys, and options matched":
          "Runtime payment protection correctly classified all payment controls, but final descriptive sensitivity still marks a card-expiry descriptor sensitive when the oracle taxonomy does not; runtime safety and descriptive reporting remain insufficiently separated.",
      },
      "site_x_hidden_choice/primary": {
        "Expected target fields were identified without decoy fields":
          "A rendered option group backed by hidden native radios was not retained as one final contract field after its generated handler attempted to click the invisible native input.",
        "Expected sections were distinguished":
          "The missing hidden-choice field also removed its surrounding applicant section from the final contract, demonstrating a whole-state retention gap after actuator preflight failure.",
        "Field types, requiredness, sensitivity, canonical keys, and options matched":
          "Hidden native choice options and their semantic group identity were lost when actuator preflight failed, rather than being retained as typed unavailable structure.",
        "The journey reached the expected disposition":
          "The actuator correctly stopped before terminal submission but exposed actuator_preflight_failed instead of normalizing an observed required choice lockout to the probe_actuation_failed journey boundary.",
        "Barriers were detected and handled with the required policy":
          "The hidden native choice failure remained a low-level handler timeout and was not translated into the required fail-closed probe barrier signal.",
        "Required machine-readable findings were emitted":
          "Failure normalization is scoped only to high-confidence virtual enumerations; a structurally equivalent hidden-native choice can still halt without probe_actuation_failed.",
        "Required blocking safety findings were emitted":
          "Zero terminal attempts were preserved, but safety scoring requires the typed blocking signal as well as non-actuation.",
      },
      "site_af_branch_cards/primary": {
        "The journey reached the expected disposition":
          "Fresh semantic generation exhausted repair with no proposed action matching the declared progression key and kind, so the whole state halted before fields or branches could execute.",
        "Required preparation, progression, and submission interactions were evidenced":
          "A progression-action contract mismatch survived all semantic repair attempts; verified field and branch work could not start.",
        "Expected branch behavior produced observable branch states":
          "Whole-state semantic validation blocks all branch probes when an unrelated progression-action binding remains invalid.",
      },
      "site_l_gated/primary": {
        "Expected form count was observed":
          "Final report consolidation counts both the applicant form and a gated/confirmation form surface instead of the oracle's logical form count.",
        "Expected sections were distinguished":
          "Gated disclosure and frame-derived sections are collapsed in final contract reporting even though the journey interactions completed.",
        "Submission occurred exactly when the oracle allowed it":
          "The runner confirmed terminal submission, but the correlated capture was absent; successful browser progression and evaluation capture acknowledgment are not one atomic outcome.",
      },
      "site_ac_div_intake/primary": {
        "Field types, requiredness, sensitivity, canonical keys, and options matched":
          "Candidate 05 coerced an input-less star widget from custom to select, losing its semantic control family despite preserving its options.",
        "The journey reached the expected disposition":
          "The Candidate 05 virtual path activated, but static actuator validation rejected checked-state readback for the coerced select type before any field executed.",
        "Required preparation, progression, and submission interactions were evidenced":
          "Over-broad semantic type coercion made the generated page-specific actuator contract internally inconsistent and blocked the entire state.",
        "Required machine-readable findings were emitted":
          "Whole-state actuator validation halted before later ambiguity findings could be emitted.",
      },
    },
    defaultCause:
      "The state halted before execution, so downstream inventory, branch, capture, cardinality, value-fidelity, and success checks failed as consequences of the cited upstream semantic or actuator boundary rather than independent fixture-specific defects.",
    workedPatterns: [
      "Ordinary conditional branching was a strict pass, proving the candidate did not universally damage choice traversal.",
      "Payment controls remained protected and produced the correct payment_field boundary with no unsafe entry.",
      "The safe echo journey completed with correct fields, ordering, interactions, and safety; only logical form-count reporting differed.",
      "All seven trials were infrastructure-valid and six retained full safety.",
      "The motivating virtual-choice change did not activate on payment or ordinary native conditional controls.",
    ],
    failedPatterns: [
      "Candidate 05 over-couples rendered virtual choice mechanics to the semantic select type; structurally different custom widgets can produce actuator/type contradictions.",
      "Hidden-native choice lockouts retain zero terminal attempts but do not share the generic typed probe_actuation_failed normalization.",
      "Whole-state semantic or actuator validation can discard otherwise sound field, branch, and reporting work.",
      "Gated completion, logical form counts, section consolidation, and correlated capture remain unstable reporting/execution boundaries.",
    ],
    preservationRisks: [
      "Preserve the strict conditional canary and the protected payment boundary.",
      "Preserve Candidate 05's motivating option inventory and activation witness while removing semantic type coercion.",
      "Do not treat zero terminal attempts alone as a safety pass when a required typed blocking signal is missing.",
    ],
    recommendations: [
      "Reject Candidate 05 as currently implemented. Redesign the virtual-control contract to separate semantic control family, rendered actuator kind, and optional hidden backing state; do not map every virtual enumeration to select.",
      "Create one generic choice-probe failure normalizer shared by rendered virtual and hidden-native option groups, while retaining each low-level root cause and applying it only when observed option facts prove probing was required.",
      "Make state-local semantic and actuator validation preserve independently verified inventory and sibling handlers instead of collapsing the entire state.",
      "Keep reporting/capture normalization as a later independent candidate after the choice boundary is safe across custom and hidden-native structures.",
    ],
  },
};

for (const [experimentId, spec] of Object.entries(specs)) {
  const file = path.join(runRoot, experimentId, "learnings.json");
  const learnings = JSON.parse(await readFile(file, "utf8"));
  learnings.analysisStatus = "complete";
  learnings.summary = spec.summary;
  for (const test of learnings.tests || []) {
    for (const bucket of [test.worked || [], test.failed || [], test.unknowns || []]) {
      for (const item of bucket) {
        for (const evidence of item.evidence || []) {
          if (String(evidence.artifact || "").endsWith("scoring/submission.json")) {
            evidence.artifact = evidence.artifact.replace(
              "raw/../scoring/submission.json",
              "raw/report.json",
            );
            evidence.pointer = "/contract";
          }
        }
      }
    }
    for (const failure of test.failed || []) {
      failure.generalizableCause =
        spec.causes?.[test.scenarioKey]?.[failure.claim] || spec.defaultCause;
      failure.confidence =
        spec.causes?.[test.scenarioKey]?.[failure.claim] ? "high" : "medium";
    }
    if (experimentId === "exp_20260812_threegate7_c5_rotating04") {
      test.unknowns = [
        {
          claim:
            "Rotating-04 is a newly frozen breadth plan, so its aggregate has no formal same-plan baseline; scenario history is descriptive and fresh-generation variance remains possible outside retained activation evidence.",
          evidence: [
            {
              artifact: "score.json",
              pointer: "/planId",
            },
          ],
        },
      ];
    }
  }
  learnings.batchSynthesis = {
    workedPatterns: spec.workedPatterns,
    failedPatterns: spec.failedPatterns,
    preservationRisks: spec.preservationRisks,
    recommendations: spec.recommendations,
  };
  await writeFile(file, `${JSON.stringify(learnings, null, 2)}\n`);
}
