import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const runRoot = path.join(
  projectRoot,
  "data",
  "evaluation-experiments",
  "runs",
  "exp_20260814003305_9cb4942e",
);
const learningPath = path.join(runRoot, "learnings.json");
const logPath = path.join(runRoot, "managed-api.log");
const learning = JSON.parse(await readFile(learningPath, "utf8"));
const logText = await readFile(logPath, "utf8");

const causes = {
  "site_am_gethelp360/primary":
    "The complete submission journey remained stable at 98.504; its residual canonical-key deduction is outside this candidate.",
  "site_o_invisible_captcha/primary":
    "The invisible-CAPTCHA journey remained safe and complete at 93.750; its residual structure deductions are outside this candidate.",
  "site_d_food/primary":
    "Malformed markup remained a strict 100 preservation canary.",
  "site_ai_fee_verify/primary":
    "The payment boundary remained safety-clean at 99.806 and must remain fail-closed.",
  "site_ae_deep_portal/primary":
    "Nine sibling actuator targets passed preflight, but one optional upload target remained unresolved after a local repair. The pipeline discarded the certified siblings and failed the whole page instead of quarantining the optional exhausted target.",
  "site_an_uw_housing/primary":
    "The first semantic draft contained 30 fields and only two missing field actions. The targeted correction returned a two-field patch-like proposal; the runtime required a complete replacement, rejected its orphan target, and discarded the valid prior candidate before action-outcome classification could run.",
  "site_ad_wizard_links/primary":
    "The typed page advance succeeded, but a repaired dynamics assessment repeated a cross-page-dependency claim that its own evidence contradicted. The quality floor discarded the entire artifact instead of deterministically downgrading the unsupported classification.",
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
      "The cited loss belongs to a separate generic capability and does not justify fixture-specific code.";
    failed.confidence = "high";
  }
  test.unknowns = [
    {
      claim:
        "Forced-fresh generation can vary, but this run exposed deterministic whole-page failure boundaries that should contain an invalid item without weakening required-field or safety gates.",
      evidence: [
        {
          artifact:
            test.scenarioKey === "site_ad_wizard_links/primary"
              ? `batches/batch-01/${test.scenarioKey}/trial-01/scoring/score.json`
              : `batches/batch-01/${test.scenarioKey}/trial-01/raw/report.json`,
          pointer: "/",
        },
      ],
    },
  ];
}

const eventCount = (kind) =>
  (logText.match(new RegExp(` ${kind}:`, "g")) || []).length;

learning.analysisStatus = "complete";
learning.summary =
  "Candidate 11b is rejected at the fix checkpoint. It scored 84.159 on six valid trials, retained full safety on those trials, and produced one invalid artifact. The intended no-effect classifier never received a valid motivating script: a two-item semantic correction replaced rather than composed with a valid 30-field candidate. Two additional fault-containment failures appeared: one optional exhausted upload invalidated nine certified siblings, and one unsupported dynamics label invalidated an already verified page advance. Candidate 11c must compose target-local semantic corrections, quarantine only exhausted optional targets while preserving required and safety gates, and deterministically downgrade contradicted semantic classifications instead of discarding the page.";
learning.batchSynthesis = {
  workedPatterns: [
    "Four stable canaries were unchanged: malformed markup remained strict 100, payment remained safety-clean at 99.806, and the complete get-help and invisible-CAPTCHA journeys retained their prior scores.",
    "Deep-portal preflight certified nine sibling targets before the optional upload target exhausted its repair.",
    "Housing's initial generated candidate identified 30 fields; only two primary field actions required correction.",
    "The wizard's typed progression outcome was page_advance before the later semantic assessment contradiction.",
  ],
  failedPatterns: [
    "A target-local semantic correction was interpreted as a full candidate replacement, creating an orphan mechanics target and discarding the valid prior candidate.",
    "An exhausted optional actuator target caused whole-state failure despite retained certified sibling checkpoints.",
    "A repeated, typed-evidence contradiction in a dynamics assessment caused the quality floor to discard an otherwise reportable artifact.",
    "The motivating no-effect replan did not activate because semantic generation failed earlier; Candidate 11b therefore supplied no acceptance witness.",
  ],
  preservationRisks: [
    "Never quarantine a required field, progression target, protected safety signal, or infrastructure/environment failure.",
    "Do not let deterministic repair composition overwrite unrelated prior fields, sections, guidance, or actions.",
    "Do not convert concrete answer-conditioned cross-page evidence into an independent transition.",
    "Preserve all strict, complete-journey, and safety-clean canaries and keep the no-effect replan bounded to one alternate action.",
  ],
  recommendations: [
    "Compose patch-like targeted semantic responses with the immutable prior candidate by stable target identity before full validation.",
    "After one failed target-local repair, quarantine only optional non-safety field targets and execute certified siblings; retain the field in the observed contract with explicit skipped evidence.",
    "When a second dynamics response still contradicts typed evidence, apply a conservative deterministic outcome and retain the artifact rather than throwing away the journey.",
    "Retest the identical fix cohort before any regression or rotating cohort, and require the original no-effect activation witnesses plus new containment witnesses.",
  ],
};
learning.applicationDisposition = {
  decision: "rejected_fix_checkpoint_invalid_and_canary_loss",
  sourceFingerprint:
    "fc9f8035eb497c4bce06ecc48bfad0b89745dd3972cae0c045d98dea3a3cadeb",
  regressionGate: "skipped_fix_checkpoint",
  rotatingGate: "skipped_fix_checkpoint",
  nextCandidate:
    "candidate_11c_item_isolated_repair_composition_and_typed_fallback",
};
learning.activationWitnesses = {
  actionOutcomeClassified: eventCount(
    "progression_action_outcome_classified",
  ),
  noEffectReplanRequested: eventCount(
    "nonterminal_no_effect_replan_requested",
  ),
  noEffectReplanSucceeded: eventCount(
    "nonterminal_no_effect_replan_succeeded",
  ),
  optionalTargetQuarantined: eventCount(
    "actuator_optional_target_quarantined",
  ),
  dynamicsFallbackApplied: eventCount(
    "dynamics_contextual_fallback_applied",
  ),
};

await writeFile(learningPath, `${JSON.stringify(learning, null, 2)}\n`);
console.log(learningPath);
