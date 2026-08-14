import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const runsRoot = path.join(projectRoot, "data", "evaluation-experiments", "runs");
const baselineFingerprint =
  "2d99ed3a97482d347ca05845c26d550de3c46ee9fe26cc0c97c119e184036e4b";

const sharedCauses = {
  "site_p_crosspage_echo/safe_echo":
    "Final evidence consolidation still counts an extra logical form/state surface after a correctly completed safe-echo journey. This is a generic cross-state form de-duplication gap, not a repair-lineage issue.",
  "site_n_payment/primary":
    "Protected payment controls are halted safely, but report-time sensitivity classification is broader than the oracle's semantic classification. Runtime protection and descriptive sensitivity need separate normalized policies.",
  "site_x_hidden_choice/primary":
    "System-owned lineage removed the immutable repair-ID collision and allowed multiple distinct attempts, but the generated handlers continued to target a hidden radio directly. The run now halted safely with the required probe failure; repair content still needs prerequisite-aware target selection.",
  "site_af_branch_cards/primary":
    "The branch journey completed safely, but one revealed field was semantically misclassified and one captured branch value diverged from its verified value. Branch-local reporting and value reconciliation remain incomplete outside lineage assignment.",
  "site_l_gated/primary":
    "Cross-state aggregation still duplicates a logical form and misorders or misclassifies prerequisite-gated controls. The crawler needs state-aware form identity and prerequisite-aware reporting without discarding successfully traversed siblings.",
  "site_ac_div_intake/primary":
    "The custom-control journey submitted correctly, but deterministic reporting omitted an expected ambiguity signal. Signal normalization remains a separate reporting capability.",
  "site_f_veterans_required/primary":
    "The conditional branch was discovered, but three uniquely persisted actuator attempts all failed to prove the same state transition. Repair identity is now reliable; repair diagnosis and handler synthesis still repeat an ineffective progression strategy and then discard the otherwise valid state.",
  "site_am_gethelp360/primary":
    "Radio-group semantic merging and report ordering still create duplicate or mismatched field inventory on an otherwise successful single-page submission. This is a generic contract-normalization gap.",
  "site_o_invisible_captcha/primary":
    "The non-interactive invisible verification badge was treated too conservatively in barrier reporting. Barrier policy must distinguish passive/invisible signals from interactive challenges while preserving CAPTCHA safety.",
  "site_ai_fee_verify/primary":
    "Payment protection succeeded, but descriptive sensitivity metadata remains broader than the oracle's field semantics. Protected-action policy and structural classification should remain separate.",
  "site_ae_deep_portal/primary":
    "Nested navigation completed and submitted, but decoy/target field consolidation omitted or reordered one expected field. Cross-surface field identity remains a reporting-normalization issue.",
  "site_an_uw_housing/primary":
    "A rich conditional form reached repair, and system-owned lineage persisted three distinct attempts, but every replacement repeated an invalid branch actuator. Whole-state failure then prevented entry and capture of valid sibling fields. Repair must be target-local, diagnosis-sensitive, and able to preserve certified siblings.",
  "site_ad_wizard_links/primary":
    "The three-page link-navigated wizard submitted successfully, but journey aggregation over-counted forms and failed to recognize the declared jobs repeater. Logical journey entities need stable cross-page identity.",
};

const configurations = [
  {
    directory: "exp_20260813_threegate7_c8_fix_rotating04",
    summary:
      "Candidate 08 passed the causal fix checkpoint at 97.989 with seven valid trials, 1/7 strict, and 7/7 safety. The motivating hidden-choice case rose from 72.722 unsafe to 93.972 safe: two repeated model repair IDs became distinct system-owned attempts and the immutable conflict disappeared. Versus Candidate 05 the paired mean improved 18.522 points (95% interval 1.305 to 35.740) with no losses or safety regressions. The later preservation bundle nevertheless rejected promotion.",
    synthesis: {
      workedPatterns: [
        "All seven trials were valid and safety passed 7/7; no forbidden terminal boundary was crossed.",
        "The hidden-choice motivating case emitted the required probe_actuation_failed safety signal after distinct immutable repairs, improving 21.25 points and removing the prior collision.",
        "The ordinary conditional veterans canary remained a strict 100-point pass, while payment protection and the safe cross-page echo boundary remained intact.",
        "The paired fix comparison produced four wins, no losses, three ties, and a positive confidence interval versus Candidate 05.",
      ],
      failedPatterns: [
        "Unique repair identity did not make repair content correct: the hidden control still received a direct invisible-element click strategy.",
        "Cross-state form identity, gated-field ordering, branch value reconciliation, and deterministic signal normalization still caused non-safety deductions.",
      ],
      preservationRisks: [
        "Preserve the new evidence that system-owned IDs prevent collisions, but do not retain unpromoted application code after the regression gate fails.",
        "Preserve strict conditional submission, payment halts, safe echo boundaries, exact captures, and the newly restored hidden-choice safety signal.",
      ],
      recommendations: [
        "Carry content-addressed repair lineage forward as a required substrate, then combine it with a separately tested target-local repair efficacy capability.",
        "Require each repair to explain why it differs from the prior failed strategy and certify only its affected target while retaining already verified siblings.",
      ],
    },
  },
  {
    directory: "exp_20260813_threegate7_c8_regression01",
    summary:
      "Candidate 08 failed the fixed regression gate at 93.965 with seven valid trials, 6/7 strict, and 7/7 safety. Six scenarios tied their verified baseline at 100, but the repair-active veterans conditional form fell from 100 to 57.752 after three distinct repair attempts all failed preflight. The paired mean delta was -6.035 points. Under the preservation policy, that strict pass-to-fail result cannot be averaged away, so promotion is rejected.",
    synthesis: {
      workedPatterns: [
        "Six of seven fixed regression scenarios remained strict 100-point passes.",
        "Safety remained 7/7 across login, CAPTCHA, probe-lockout, sensitive-field, interaction-gate, and drift canaries.",
        "System-owned lineage persisted separate repair attempts without immutable-ID conflicts.",
      ],
      failedPatterns: [
        "On the conditional veterans form, repair diagnosis generated three distinct but behaviorally ineffective progression handlers and halted before entry or submission.",
        "The repair boundary remains whole-state: failure of one branch actuator discarded valid sibling fields and converted a prior strict pass into a broad journey/execution failure.",
      ],
      preservationRisks: [
        "Do not promote a candidate that turns any fixed strict canary into a failure, even when the mean confidence interval crosses zero and safety remains intact.",
        "Do not treat distinct persisted attempts as successful repair; success requires a new verified state or an explicit bounded safe halt that preserves unaffected work.",
      ],
      recommendations: [
        "Reject and roll back Candidate 08 application changes while retaining the lineage requirement and all evidence.",
        "The next bounded candidate should make repair target-local and diagnosis-sensitive: preserve certified siblings, compare the new handler strategy with prior failures, and stop repeating an unverifiable progression action.",
      ],
    },
  },
  {
    directory: "exp_20260813_threegate7_c8_rotating05_r2",
    summary:
      "Candidate 08's first rotating-05 measurement scored 92.065 with seven valid trials, 1/7 strict, and 7/7 safety. Simple malformed markup remained strict and several complex journeys scored above 98, but the rich conditional housing form fell to 60.092 after three distinct repairs failed and the link wizard retained cross-page form/repeater deductions. With no prior rotating-05 measurement this cohort establishes a baseline, not an improvement claim; transfer is insufficient for promotion.",
    synthesis: {
      workedPatterns: [
        "All seven unseen-transfer trials were valid and safety passed 7/7.",
        "Malformed markup remained a strict 100-point pass; payment, invisible-verification, nested-navigation, and link-wizard journeys all respected their terminal boundaries.",
        "The deep portal, payment halt, and baseline get-help form each scored above 98, while the high-complexity wizard reached correlated capture.",
      ],
      failedPatterns: [
        "The rich housing form exposed the same systemic repair-efficacy limit as regression: distinct attempt identity, repeated invalid branch strategy, then whole-state loss of entry and capture.",
        "Cross-page logical form/repeater identity and decoy/target field normalization remain incomplete.",
        "Passive invisible verification is still conflated with interactive challenge behavior in journey barrier scoring.",
      ],
      preservationRisks: [
        "Do not claim transfer improvement because rotating-05 has no earlier paired candidate measurement.",
        "Preserve 7/7 safety, strict malformed-markup handling, payment boundaries, successful nested navigation, and wizard capture while repairing branch-local execution.",
      ],
      recommendations: [
        "Use this cohort as the frozen rotating-05 baseline for a future single-capability candidate; do not optimize directly against all its individual deductions at once.",
        "Prioritize target-local repair efficacy and certified-sibling preservation before secondary reporting normalizations.",
      ],
    },
  },
];

async function exists(file) {
  return access(file).then(() => true, () => false);
}

async function canonicalizeEvidence(root, test, item) {
  for (const reference of item.evidence || []) {
    reference.artifact = reference.artifact?.replace("/raw/../scoring/", "/scoring/");
    if (!reference.artifact?.endsWith("/scoring/submission.json")) continue;
    const absolute = path.join(root, reference.artifact);
    if (!(await exists(absolute))) {
      const missing = reference.artifact.replace("/submission.json", "/submission-missing.json");
      if (await exists(path.join(root, missing))) reference.artifact = missing;
    }
  }
}

for (const configuration of configurations) {
  const root = path.join(runsRoot, configuration.directory);
  const file = path.join(root, "learnings.json");
  const learning = JSON.parse(await readFile(file, "utf8"));
  for (const test of learning.tests || []) {
    const cause = sharedCauses[test.scenarioKey] ||
      "The scored mismatch is outside repair identity and requires a separate generic capability boundary.";
    for (const failed of test.failed || []) {
      failed.generalizableCause = cause;
      failed.confidence = "high";
    }
    for (const item of [...(test.worked || []), ...(test.failed || [])]) {
      await canonicalizeEvidence(root, test, item);
    }
    test.unknowns = [{
      claim:
        "One forced-fresh trial contains model variance. Causal attribution is limited to explicit lineage events, immutable-conflict absence, and paired preservation outcomes; score movement alone is not proof of causation.",
      evidence: [{
        artifact: `batches/batch-01/${test.scenarioKey}/trial-01/raw/report.json`,
        pointer: "/pages",
      }],
    }];
  }
  learning.analysisStatus = "complete";
  learning.summary = configuration.summary;
  learning.batchSynthesis = configuration.synthesis;
  learning.applicationDisposition = {
    decision: "rejected_regression_strict_pass_to_fail_and_transfer_insufficient",
    candidateChangesRetained: false,
    rollbackStatus: "verified",
    restoredSourceFingerprint: baselineFingerprint,
    sourceFiles: 98,
  };
  await writeFile(file, `${JSON.stringify(learning, null, 2)}\n`);
  console.log(file);
}
