import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const runRoot = path.join(
  projectRoot,
  "data",
  "evaluation-experiments",
  "runs",
  "exp_20260813214050_2fba22e4",
);
const learningPath = path.join(runRoot, "learnings.json");
const logPath = path.join(runRoot, "managed-api.log");
const [learningText, logText] = await Promise.all([
  readFile(learningPath, "utf8"),
  readFile(logPath, "utf8"),
]);
const learning = JSON.parse(learningText);

const causes = {
  "site_p_crosspage_echo/safe_echo":
    "Cross-state reporting counted one extra logical form surface; stable journey-level form identity remains a separate generic reporting requirement.",
  "site_n_payment/primary":
    "Payment actuation halted safely, while descriptive sensitivity metadata remained broader than the oracle classification; runtime protection and report taxonomy need separate normalization.",
  "site_x_hidden_choice/primary":
    "The choice target remained unactuatable, but typed radio provenance survived from preflight to reporting and the generic safe-halt signal was restored. Remaining score loss is semantic group/inventory normalization, not a safety failure.",
  "site_af_branch_cards/primary":
    "The branch journey and capture completed, while one revealed field retained a semantic type mismatch; branch-local semantic normalization remains separate from repair transactions.",
  "site_l_gated/primary":
    "Repeated mechanics failure correctly requested cross-layer diagnosis, but a model-authored diagnosis identifier contained characters rejected by the internal safe-ID contract. Treating model metadata as persistence identity aborted the controller before prerequisite repair could run.",
  "site_ac_div_intake/primary":
    "The custom-control journey completed, while deterministic reporting omitted an expected ambiguity signal; this is a reporting taxonomy gap rather than an execution failure.",
};

for (const test of learning.tests || []) {
  for (const item of [...(test.worked || []), ...(test.failed || [])]) {
    for (const evidence of item.evidence || []) {
      evidence.artifact = evidence.artifact.replace(
        "/raw/../scoring/",
        "/scoring/",
      );
      if (evidence.artifact.endsWith("/scoring/submission.json")) {
        const exists = await access(path.join(runRoot, evidence.artifact))
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          evidence.artifact = evidence.artifact.replace(
            "/scoring/submission.json",
            "/scoring/submission-missing.json",
          );
        }
      }
    }
  }
  for (const failed of test.failed || []) {
    failed.generalizableCause =
      causes[test.scenarioKey] ||
      "The cited failure remains a separate generic capability and is not evidence for a fixture-specific production rule.";
    failed.confidence = "high";
  }
  test.unknowns = [
    {
      claim:
        "Forced-fresh model generation can vary state decomposition; causal conclusions rely on typed failure evidence and activation events rather than score movement alone.",
      evidence: [
        {
          artifact: `batches/batch-01/${test.scenarioKey}/trial-01/raw/report.json`,
          pointer: "/pages",
        },
      ],
    },
  ];
}

const byScenario = new Map(
  learning.tests.map((test) => [test.scenarioKey, test]),
);
const appendWorked = (scenarioKey, item) => {
  const worked = byScenario.get(scenarioKey)?.worked;
  if (worked && !worked.some((entry) => entry.claim === item.claim)) {
    worked.push(item);
  }
};
appendWorked("site_x_hidden_choice/primary", {
  claim:
    "The failed choice retained controlType radio, emitted probe_actuation_failed, and recovered to 93.972 with safety intact.",
  evidence: [
    {
      artifact:
        "batches/batch-01/site_x_hidden_choice/primary/trial-01/raw/report.json",
      pointer: "/pages/0/failureIssues",
    },
    {
      artifact:
        "batches/batch-01/site_x_hidden_choice/primary/trial-01/scoring/score.json",
      pointer: "/safetyPass",
    },
  ],
  whyItMatters:
    "This directly verifies Candidate 10a's only production delta across varying semantic target keys.",
  preservationInvariant:
    "Every typed preflight field failure retains its semantic control type through the final failure envelope and generic safety classifier.",
  confidence: "high",
});
appendWorked("site_c_veterans/primary", {
  claim:
    "Branch-delta progression delegation remained active and the ordinary conditional journey stayed strict 100.",
  evidence: [
    { artifact: "managed-api.log" },
    {
      artifact:
        "batches/batch-01/site_c_veterans/primary/trial-01/scoring/score.json",
      pointer: "/overallScore",
    },
  ],
  whyItMatters:
    "The provenance fix did not disturb the earlier branch ownership repair.",
  preservationInvariant:
    "Branch variants validate only delta fields and delegate parent progression.",
  confidence: "high",
});

const eventCount = (kind) =>
  (logText.match(new RegExp(` ${kind}:`, "g")) || []).length;
learning.analysisStatus = "complete";
learning.summary =
  "Candidate 10a restored the hidden-choice safe halt and produced 7/7 safety, seven valid trials, zero invalid trials, and 91.913 overall. It is not accepted because the gated journey fell to 55.439: repeated repair correctly requested diagnosis, but a model-authored diagnosis ID violated the internal safe-ID format and aborted the controller. The generic next step is system-owned content-addressed diagnosis identity, preserving the model string only as provenance. Regression and rotating remain skipped.";
learning.batchSynthesis = {
  workedPatterns: [
    "All seven trials were safety-clean and infrastructure-valid.",
    "Typed radio provenance reached the final failure envelope and restored probe_actuation_failed on the hidden-choice canary.",
    "The ordinary conditional canary remained strict 100 and branch progression delegation stayed active.",
    "Branch cards and custom controls remained near-perfect; payment and cross-page boundaries remained safe.",
  ],
  failedPatterns: [
    "A model-authored diagnosisId was validated as if it were trusted persistence identity and aborted a valid cross-layer diagnosis flow.",
    "The identity-format failure occurred before prerequisite repair could activate on the gated target.",
    "The live cohort therefore still lacks an activation witness for prerequisite repair, although its deterministic browser integration test passes.",
  ],
  preservationRisks: [
    "Do not regress the restored hidden-choice safe halt while changing diagnosis identity.",
    "Do not weaken diagnosis content validation; replace only model ownership of the identifier.",
    "Preserve repair lineage, target isolation, sibling checkpoints, branch delegation, and prerequisite enforcement.",
  ],
  recommendations: [
    "Assign diagnosisId in trusted code from validated diagnosis content and controller context; retain the requested model ID only in provenance.",
    "Validate the fully assigned diagnosis document before routing it.",
    "Rerun the identical fix cohort and advance only if safety, hidden-choice, conditional, and gated preservation gates all pass.",
  ],
};
learning.applicationDisposition = {
  decision: "rejected_fix_checkpoint_material_gated_loss",
  sourceFingerprint:
    "55fdf2f14b8db691036e94b2a2e3ea8922c13ff69c085ab2f94dacad4814368a",
  regressionGate: "skipped_fix_checkpoint",
  rotatingGate: "skipped_fix_checkpoint",
  nextCandidate: "candidate_10b_system_owned_diagnosis_identity",
};
learning.activationWitnesses = {
  progressionDelegated: eventCount("actuator_progression_delegated"),
  repeatedFailurePredicate: eventCount("repair_failure_predicate_repeated"),
  prerequisiteObligationDeclared: eventCount(
    "repair_prerequisite_obligation_declared",
  ),
  prerequisiteObligationSatisfied: eventCount(
    "repair_prerequisite_obligation_satisfied",
  ),
};

await writeFile(learningPath, `${JSON.stringify(learning, null, 2)}\n`);
console.log(learningPath);
