import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const experimentRoot = path.join(
  projectRoot,
  "data",
  "evaluation-experiments",
  "runs",
  "exp_20260812_threegate7_c7_fix_rotating04_r2",
);
const file = path.join(experimentRoot, "learnings.json");
const learning = JSON.parse(await readFile(file, "utf8"));

const causes = {
  "site_p_crosspage_echo/safe_echo":
    "Final evidence consolidation counts one extra logical form/state surface after a correctly traversed safe echo journey. This is a generic form de-duplication defect outside the candidate's failure-normalization boundary.",
  "site_c_veterans/primary": "",
  "site_n_payment/primary":
    "Payment protection halted safely, but descriptive field reporting still conflates protected runtime handling with the oracle's narrower sensitivity classification and can reorder one matched payment field. This is a reporting/ordering policy issue outside Candidate 07.",
  "site_x_hidden_choice/primary":
    "The bounded state-actuator repair path failed before locator normalization because an immutable repair-attempt identifier collided with an existing artifact. The target choice field was consequently omitted, the candidate's grounded_probe_failure_normalized witness never activated, and the required safety signal remained absent. Repair-attempt identity and retry lineage must be made content-addressed or uniquely scoped before downstream failure normalization can run reliably.",
  "site_af_branch_cards/primary":
    "A first-level branch variant produced a semantic progression/mechanics contract mismatch. Whole-variant failure then prevented the remaining revealed controls and later branch from entering the contract, showing that branch repair is still an all-or-nothing state boundary rather than an independently recoverable variant boundary.",
  "site_l_gated/primary":
    "Whole-state actuator preflight evaluated a prerequisite-disabled agreement checkbox before its enabling scroll/disclosure sequence and rejected the entire state. Prerequisite-dependent controls need ordered or state-local certification so one temporarily disabled field does not discard safe siblings.",
  "site_ac_div_intake/primary":
    "The full custom-control contract executed and submitted safely, but structural reporting over-split headings into one extra section and omitted the ambiguous-submit finding. These are deterministic reporting normalization gaps outside Candidate 07.",
};

for (const test of learning.tests || []) {
  const cause = causes[test.scenarioKey];
  for (const failed of test.failed || []) {
    failed.generalizableCause = cause;
    failed.confidence = "high";
  }
  test.unknowns = [
    {
      claim:
        test.scenarioKey === "site_x_hidden_choice/primary"
          ? "Candidate 07 did not activate on the motivating case; the earlier immutable repair conflict means no score movement can be attributed to its changed normalization path."
          : "One forced-fresh generation trial cannot distinguish all model variance from stable runtime behavior; paired scenario deltas are preservation evidence, not proof of causation without the activation witness.",
      evidence: [
        {
          artifact: `batches/batch-01/${test.scenarioKey}/trial-01/raw/report.json`,
          pointer:
            test.scenarioKey === "site_x_hidden_choice/primary"
              ? "/pages/0/failureIssues"
              : "/pages",
        },
      ],
    },
  ];

  // The draft generator can retain a lexical `raw/../scoring` path from a
  // missing-submission check. Canonicalize it to the frozen artifact that is
  // actually present so qualitative evidence remains portable and verifiable.
  for (const observation of [...(test.worked || []), ...(test.failed || [])]) {
    for (const reference of observation.evidence || []) {
      if (
        reference.artifact?.endsWith("/raw/../scoring/submission.json") ||
        reference.artifact?.endsWith("/scoring/submission-missing.json")
      ) {
        const captured = new Set([
          "site_c_veterans/primary",
          "site_ac_div_intake/primary",
        ]).has(test.scenarioKey);
        reference.artifact = reference.artifact
          .replace("/raw/../scoring/submission.json", "/scoring/submission.json")
          .replace(
            /\/scoring\/submission(?:-missing)?\.json$/,
            `/scoring/submission${captured ? "" : "-missing"}.json`,
          );
      }
    }
  }
}

learning.analysisStatus = "complete";
learning.summary =
  "Candidate 07 is rejected at the fix checkpoint. The exact seven-scenario plan scored 82.766 with seven valid trials, one strict pass, and 6/7 safety. It was +3.300 versus Candidate 05 but statistically inconclusive, and -0.047 versus Candidate 06. The motivating case remained 72.722 and unsafe because an immutable actuator-repair attempt conflict occurred before the candidate's grounded locator normalizer could activate; the required activation witness count was zero. Regression and rotating are therefore skipped.";
learning.batchSynthesis = {
  workedPatterns: [
    "All seven trials were infrastructure-valid and no forbidden terminal boundary was crossed.",
    "The ordinary conditional-branch canary remained a strict 100-point pass with exact capture fidelity.",
    "Payment protection halted safely without entering protected card fields, and the safe cross-page echo journey preserved its required terminal boundary.",
    "The structurally custom div-built intake retained all expected fields, executed safely, and reached confirmed submission despite minor reporting deductions.",
  ],
  failedPatterns: [
    "The predeclared grounded_probe_failure_normalized path never activated on the motivating choice case because immutable actuator-repair identity failed earlier in the pipeline.",
    "The required probe_actuation_failed finding remained absent on the motivating case, leaving fix safety at 6/7.",
    "Branch-variant semantic validation remains whole-variant: one progression/mechanics mismatch discards later revealed controls and prevents complete branch coverage.",
    "Whole-state preflight still rejects safe siblings when a prerequisite-dependent field is temporarily disabled.",
    "Logical form, section, sensitivity, ordering, and finding normalization still create small deterministic reporting deductions on otherwise safe journeys.",
  ],
  preservationRisks: [
    "Preserve the strict conditional canary, zero forbidden terminal attempts, payment/login/CAPTCHA boundaries, and exact correlated capture behavior.",
    "Do not retain Candidate 07 merely because its mean exceeded Candidate 05; activation was zero, safety did not improve, and the paired interval crossed zero.",
    "A repair-lineage change must preserve append-only artifact history and never overwrite an earlier generated or repaired actuator attempt.",
    "State-local certification must not bypass prerequisite order, legal review, protected-action policy, or final submission guards.",
  ],
  recommendations: [
    "Reject and roll back Candidate 07 application changes. Keep its evidence and requirements, but do not promote a dormant normalization path.",
    "Prioritize a separate generic repair-lineage capability: derive each repair-attempt identity from state identity, parent artifact hash, attempt ordinal, and candidate content hash so repeated fresh generations cannot collide while every superseded attempt remains immutable and auditable.",
    "Validate repair-lineage behavior with a positive retry that creates two distinct immutable attempts, a negative replay that refuses overwrite, and a structurally different branch repair that reaches downstream validation after one rejected draft.",
    "Keep choice failure normalization, branch-local semantic recovery, state-local prerequisite certification, and reporting normalization as separate bounded candidates.",
  ],
};
learning.applicationDisposition = {
  decision: "rejected_fix_checkpoint_activation_absent",
  candidateChangesRetained: false,
  rollbackStatus: "verified",
  restoredSourceFingerprint:
    "2d99ed3a97482d347ca05845c26d550de3c46ee9fe26cc0c97c119e184036e4b",
  sourceFiles: 98,
};

await writeFile(file, `${JSON.stringify(learning, null, 2)}\n`);
console.log(file);
