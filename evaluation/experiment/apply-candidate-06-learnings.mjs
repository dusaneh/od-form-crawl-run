import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const experimentId = "exp_20260812_threegate7_c6_fix_rotating04";
const file = path.join(
  projectRoot,
  "data",
  "evaluation-experiments",
  "runs",
  experimentId,
  "learnings.json",
);
const learnings = JSON.parse(await readFile(file, "utf8"));

const causes = {
  "site_p_crosspage_echo/safe_echo": {
    "Expected form count was observed":
      "Final evidence consolidation still counts one extra rendered form/state surface in a correctly traversed safe echo journey. This is a generic logical-form de-duplication defect outside Candidate 06.",
  },
  "site_n_payment/primary": {
    "Field types, requiredness, sensitivity, canonical keys, and options matched":
      "The payment boundary remained correct, but descriptive field sensitivity still differs from the oracle for one payment descriptor. Runtime protection and descriptive reporting remain insufficiently separated; Candidate 06 did not touch that behavior.",
  },
  "site_x_hidden_choice/primary": {
    "The journey reached the expected disposition":
      "Candidate 06 retained the virtual-backed radio as one complete semantic field, but shared plan resolution still tried to resolve the virtual group-root selector as though it were the native radio option. The state halted as semantic_validation_blocked before typed choice preflight could run.",
    "Barriers were detected and handled with the required policy":
      "The rendered/backing contract activated, but the upstream generic resolution gate is not choice-interaction-aware. Its failure never entered the shared probe-lockout normalization path.",
    "Required machine-readable findings were emitted":
      "A low-level semantic_validation_blocked finding escaped instead of being normalized to probe_actuation_failed after a required observed choice could not be safely exercised.",
    "Required blocking safety findings were emitted":
      "Zero terminal attempts were preserved, but the required fail-closed probe_actuation_failed signal was absent. Safety requires both non-actuation and the typed blocking signal.",
  },
  "site_af_branch_cards/primary": {
    "Expected target fields were identified without decoy fields":
      "The starting choice field was retained, but the same virtual-root/native-radio resolution mismatch halted the state before its dependent branches could be revealed and added to the contract.",
    "Field types, requiredness, sensitivity, canonical keys, and options matched":
      "The new orthogonal choice record preserved radio meaning, rendered-option mechanics, native backing, and complete options, but final canonical identity and all unrevealed dependent fields remained incomplete because the state stopped at shared plan resolution.",
    "The journey reached the expected disposition":
      "Shared plan resolution rejected the rendered choice group before actuator preflight, so no branch or terminal action executed.",
    "Required preparation, progression, and submission interactions were evidenced":
      "The upstream resolution gate blocked every otherwise independent field and action in the state after it treated a virtual group-root selector as a native radio option selector.",
    "Expected branch behavior produced observable branch states":
      "No choice probe ran, so the dependent Rent/Own, referral-other, and child-detail states were never observed.",
  },
  "site_l_gated/primary": {
    "Expected target fields were identified without decoy fields":
      "Fresh generation omitted the gated benefit select and actuator preflight then rejected the disabled agreement checkbox before its prerequisite interaction completed. This is an unrelated state-local prerequisite/validation regression, not evidence for the choice capability.",
    "Expected journey page count was observed":
      "Actuator preflight halted on a prerequisite-disabled checkbox before the confirmation page could be reached.",
    "Expected sections were distinguished":
      "The missing gated field removed its section from final structural reporting after the whole state stopped.",
    "Field types, requiredness, sensitivity, canonical keys, and options matched":
      "The benefit select was omitted when the fresh proposal and validation path failed to retain independently observed gated structure.",
    "Matched fields retained their expected relative order":
      "The omitted gated benefit field made the remaining reported order incomplete.",
    "The journey reached the expected disposition":
      "State-wide actuator preflight rejected a disabled acceptance checkbox before its declared scroll/interaction prerequisite made it actionable.",
    "Expected page sequence was traversed in order":
      "The state-wide preflight failure prevented navigation to confirmation.",
    "Required preparation, progression, and submission interactions were evidenced":
      "Preparation interactions were observed, but whole-state preflight stopped terminal progression before a valid post-prerequisite replay could occur.",
  },
  "site_ac_div_intake/primary": {
    "Expected target fields were identified without decoy fields":
      "The old custom-to-select actuator mismatch disappeared and the page completed, but semantic repair resolved a source-fact ownership conflict by dropping the star-rating field instead of retaining the independent virtual enumeration.",
    "Field types, requiredness, sensitivity, canonical keys, and options matched":
      "The custom rating never reached the final contract because its virtual fact and one native fact were assigned to competing semantic fields during fresh generation; Candidate 06 lacks deterministic ownership precedence for an explicitly represented virtual choice.",
    "Required machine-readable findings were emitted":
      "The page completed but the final finding set omitted ambiguous_submit; this reporting gap is independent of the virtual-choice actuator repair.",
  },
};

const downstream = new Set([
  "Applicable target fields were populated and verified",
  "Submission occurred exactly when the oracle allowed it",
  "Captured keys matched the submission contract",
  "Captured scalar and repeated values retained native cardinality",
  "Captured values matched the values verified by the runner",
  "The expected success evidence was observed",
]);
const defaultCause =
  "This is a downstream consequence of the cited upstream state-wide resolution or preflight halt: no independent field execution, branch discovery, capture, or success evidence could occur.";

learnings.analysisStatus = "complete";
learnings.summary =
  "Candidate 06 failed its causal fix checkpoint and is rejected. On the exact seven-scenario plan it scored 82.813 (up 3.347 from rejected Candidate 05), with seven valid trials, one strict pass, and only 6/7 safety. The orthogonal hidden-choice contract activated and the prior custom-select actuator collision disappeared, but shared plan resolution remained native-control-shaped, the required probe_actuation_failed signal was still absent, the custom rating was dropped during semantic repair, and an unrelated gated canary lost 21.385 points. Regression and rotating were correctly skipped.";

for (const test of learnings.tests || []) {
  for (const bucket of [test.worked || [], test.failed || [], test.unknowns || []]) {
    for (const item of bucket) {
      for (const evidence of item.evidence || []) {
        if (String(evidence.artifact || "").endsWith("raw/../scoring/submission.json")) {
          evidence.artifact = evidence.artifact.replace(
            "raw/../scoring/submission.json",
            "raw/report.json",
          );
          evidence.pointer = "/contract";
        }
      }
    }
  }
  for (const item of test.failed || []) {
    item.generalizableCause =
      causes[test.scenarioKey]?.[item.claim] ||
      (downstream.has(item.claim) ? defaultCause : defaultCause);
    item.confidence = causes[test.scenarioKey]?.[item.claim] ? "high" : "medium";
  }
  test.unknowns = [
    {
      claim:
        "Fresh LLM generation is stochastic, so unchanged scenario scores are supporting evidence only. The retained choiceInteraction records and canonicalization logs prove activation; no virtual_choice_boundary_v2 event was retained in final findings, so the explicit event-witness gate itself did not pass.",
      evidence: [{ artifact: "score.json", pointer: "/sourceFingerprint" }],
    },
  ];
}

learnings.batchSynthesis = {
  workedPatterns: [
    "The orthogonal choiceInteraction record retained semantic radio meaning, rendered-option click mechanics, native backing identities, and the full ordered option set on two structurally different hidden-backed choice groups.",
    "The prior site_ac custom-widget handler/type collision disappeared and that page completed safely at 97.9419 instead of halting at 59.263.",
    "Ordinary conditional behavior remained a strict 100-point pass, and payment protection remained safe at 99.8333.",
    "All seven trials were infrastructure-valid and zero forbidden terminal attempts occurred.",
  ],
  failedPatterns: [
    "Shared planResolutionIssues still validates a virtual rendered-choice root with native radio selector semantics before the choice-aware actuator preflight can run.",
    "Choice failure normalization still does not translate required observed-choice resolution failure into probe_actuation_failed, so safety remained 6/7.",
    "A represented custom enumeration can be discarded during semantic repair when the model assigns overlapping native and virtual source facts; the final activation witness and field are then lost.",
    "Whole-state preflight still discards independently observed or executable siblings, exposed by the unrelated gated-site loss.",
  ],
  preservationRisks: [
    "Preserve the orthogonal choiceInteraction data model and deterministic rendered/backing actuator compiler; those paths are causally evidenced even though the candidate is rejected.",
    "Preserve ordinary native control handling, the strict conditional canary, payment/login/CAPTCHA boundaries, and zero forbidden terminal attempts.",
    "Do not declare success from the +3.347 aggregate gain: the 95% paired interval crosses zero, safety stayed 6/7, and one unrelated scenario regressed by more than three points.",
  ],
  recommendations: [
    "Reject and roll back Candidate 06 application changes. The next bounded candidate should make shared plan resolution consume choiceInteraction: validate exact rendered option and exact backing bindings, never reinterpret the virtual group root as a native option selector.",
    "Keep generic required-choice failure normalization as a separate capability: preserve the low-level cause and emit probe_actuation_failed only when grounded observed options prove a required probe could not be safely exercised.",
    "Add deterministic virtual/native ownership reconciliation so an explicitly represented virtual choice owns only its virtual fact while its declared backing links do not create competing semantic fields.",
    "Address state-local prerequisite validation separately; do not bundle the gated checkbox loss into the choice-resolution candidate.",
  ],
};

await writeFile(file, `${JSON.stringify(learnings, null, 2)}\n`);
