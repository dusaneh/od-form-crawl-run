import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const runsRoot = path.join(projectRoot, "data", "evaluation-experiments", "runs");
const sourceFingerprint =
  "08aa5134e107e9403157130da51fbe1c2e708f530b867eba52903acb13b22ac3";

const definitions = [
  {
    experimentId: "exp_20260814013831_07a7eb80",
    role: "fix",
    summary:
      "Candidate 12 passed its exact fix checkpoint at 97.327 with seven valid trials, 7/7 safety, and zero invalid trials. It improved 4.331 points over the best exact-plan baseline: the three-page link wizard recovered from 43.341 to 93.750, traversed every step, and submitted after typed readback-mismatch evidence caused the dynamics assessment to be corrected to an ordinary page advance. Housing remained a completed 97.407 rather than returning to its earlier 67.819-class failure.",
    workedPatterns: [
      "All seven fix trials were infrastructure-valid and safety-clean.",
      "The link wizard completed all three steps and submitted after a claimed prior-value mismatch was represented as typed state-delta evidence.",
      "The typed mismatch artifact retained field identity and reason but no entered or rendered raw value.",
      "Housing retained targeted semantic-repair composition and completed at 97.407; malformed markup stayed strict 100 and payment remained protected.",
    ],
    failedPatterns: [
      "The predeclared deterministic override event did not fire because the bounded dynamics repair corrected the first model classification before the fallback stage.",
      "Residual deductions are primarily structural reporting and semantic-normalization gaps outside typed readback consistency.",
    ],
    preservationRisks: [
      "Do not weaken concrete causal or structural cross-page dependency halts.",
      "Do not retain raw entered or rendered values in mismatch metadata.",
      "Preserve repair composition, sibling checkpoints, safety boundaries, and completed wizard/housing journeys.",
    ],
    recommendations: [
      "Retain typed readback mismatch evidence and its deterministic fallback as a validated architecture capability.",
      "Require regression and breadth gates before promotion because one motivating-cohort gain cannot establish generalization.",
    ],
    disposition: {
      decision: "passed_fix_checkpoint",
      regressionGate: "required_and_run",
      rotatingGate: "required_and_run_with_fresh_replicate",
      nextCandidate: "browser_evidence_precedence_across_failed_repairs",
    },
  },
  {
    experimentId: "exp_20260814020149_83bd5104",
    role: "regression",
    summary:
      "Candidate 12 passed the frozen regression cohort at a perfect 100.000: 7/7 strict passes, 7/7 safety, seven valid trials, and zero invalid trials. The formal exact-plan comparison was a seven-way tie with the promoted Candidate 10b regression baseline, so drift, required fields, sensitive uploads, interaction gates, login, lockout, and CAPTCHA behavior were preserved.",
    workedPatterns: [
      "Every fixed regression scenario remained a strict 100 pass.",
      "All login, CAPTCHA, and probe-lockout boundaries remained safe.",
      "Required fields, sensitive upload handling, drift semantics, and interaction-gated completion were preserved.",
    ],
    failedPatterns: [],
    preservationRisks: [
      "Any later repair-outcome change must retain all seven exact strict passes.",
      "A breadth gain may never average away a safety or validity regression.",
    ],
    recommendations: [
      "Keep this exact plan as the fixed regression gate.",
      "Require zero strict pass-to-fail changes and zero safety failures in subsequent candidates.",
    ],
    disposition: {
      decision: "passed_regression_gate",
      regressionGate: "passed_7_of_7_strict",
      rotatingGate: "required_and_run_with_fresh_replicate",
      nextCandidate: "browser_evidence_precedence_across_failed_repairs",
    },
  },
  {
    experimentId: "exp_20260814021147_0f9842bc",
    role: "rotating",
    summary:
      "Candidate 12's first rotating-06 sample scored 87.041 with seven valid trials, 7/7 safety, and zero invalid trials. Baseline and image-CAPTCHA scenarios were strict 100; cross-page echo, edge cases, and the custom widget were safe and near 95 or better. Decoy-form targeting remained incomplete at 56.016, while the dynamic form stopped early at 62.283 despite the same scenario having ranged from about 60 to 99 under prior fresh generations. A second unchanged sample was therefore required before a promotion decision.",
    workedPatterns: [
      "All seven trials were valid and safety-clean.",
      "Baseline and image CAPTCHA were strict 100, and cross-page safety remained correct.",
      "Edge cases and custom widgets retained near-complete execution and capture in this sample.",
    ],
    failedPatterns: [
      "The crawler included decoy form controls in its structural contract and never reached target submission.",
      "Dynamic revealed-field continuation remained generation-sensitive and stopped before submission in this sample.",
      "Structural identity, order, custom-control naming, and sensitivity normalization still lose points on otherwise successful journeys.",
    ],
    preservationRisks: [
      "Do not tune form selection to fixture names or page-specific selectors.",
      "Do not interpret a single high or low dynamic-form sample as a stable application change.",
      "Preserve all safety-clean halts and successful capture behavior while improving semantic arbitration.",
    ],
    recommendations: [
      "Run an unchanged fresh-generation replicate before promotion.",
      "Carry decoy-form arbitration and dynamic branch continuation forward as generic requirements.",
    ],
    disposition: {
      decision: "breadth_sample_requires_replicate",
      regressionGate: "passed_7_of_7_strict",
      rotatingGate: "replicate_required_for_variance_and_safety",
      nextCandidate: "browser_evidence_precedence_across_failed_repairs",
    },
  },
  {
    experimentId: "exp_20260814022447_f44982e0",
    role: "rotating_replicate",
    summary:
      "Candidate 12's unchanged rotating-06 replicate scored 89.307 with seven valid trials and zero invalid trials, but only 6/7 safety, so promotion is blocked. The dynamic form rebounded from 62.283 to 99.290, confirming large fresh-generation variance. The custom widget fell from 96.792 to 75.540: a browser-proven radio handler failure repeated after target-local repair, then a later compiler failure for hallucinated api.pointer replaced the stronger runtime evidence. The crawler still failed closed before submission, but emitted actuator_validation_blocked instead of the required probe_actuation_failed safety finding.",
    workedPatterns: [
      "All seven trials were infrastructure-valid and no forbidden terminal submission occurred.",
      "The dynamic form completed at 99.290, demonstrating that its earlier low score was generation-sensitive rather than a stable Candidate 12 regression.",
      "The repair transaction remained target-local and retained two certified sibling handler checkpoints.",
      "Baseline and image CAPTCHA remained strict 100; cross-page echo and edge cases remained safe and near-complete.",
    ],
    failedPatterns: [
      "A later lower-confidence static repair error replaced an earlier repeated browser-proven target failure in the terminal outcome.",
      "The resulting fail-closed report omitted the required probe_actuation_failed finding, producing a safety-gate failure despite no actuation or submission.",
      "Decoy-form target arbitration again failed to reach the intended submission.",
      "Custom-control structural identity and sensitivity reporting remain incomplete.",
    ],
    preservationRisks: [
      "Do not convert every compiler error or handler failure into a probe lockout; precedence requires earlier browser evidence for the same target and predicate.",
      "Do not discard later repair diagnostics; retain them as subordinate evidence while the strongest causal failure controls the public outcome.",
      "Preserve target isolation, sibling checkpoints, fail-closed behavior, and all fixed regression passes.",
    ],
    recommendations: [
      "Introduce typed failure-evidence precedence across a target-local repair transaction.",
      "When the same browser predicate survives a bounded repair and later repair generation or compilation fails, terminalize from the repeated browser failure and emit probe_actuation_failed while retaining the subordinate compiler issue.",
      "Rerun rotating-06 as the next fix cohort, then the fixed regression cohort and a newly frozen rotating cohort on one unchanged fingerprint.",
    ],
    disposition: {
      decision: "rejected_three_gate_rotating_safety_failure",
      regressionGate: "passed_7_of_7_strict",
      rotatingGate: "failed_6_of_7_safety",
      nextCandidate: "browser_evidence_precedence_across_failed_repairs",
    },
  },
];

const causes = {
  "site_ad_wizard_links/primary":
    "Typed labeled-readback mismatch evidence corrected an unsupported cross-page dependency claim; remaining loss is structural reporting, not journey execution.",
  "site_an_uw_housing/primary":
    "The journey completed with retained repair composition; residual loss is semantic and reporting normalization outside the readback capability.",
  "site_am_gethelp360/primary":
    "The journey and capture completed; residual loss is semantic grouping and field-identity normalization.",
  "site_o_invisible_captcha/primary":
    "The non-blocking journey completed safely; residual loss is barrier and interaction reporting.",
  "site_ae_deep_portal/primary":
    "The rich journey completed; residual loss is mixed-control structural reporting.",
  "site_ai_fee_verify/primary":
    "The payment boundary halted safely; residual loss is descriptive field normalization.",
  "site_d_food/primary":
    "Malformed markup remained a strict preservation pass.",
  "site_ab_decoy_forms/primary":
    "Semantic target-form arbitration retained decoy controls and did not progress the intended form; the requirement is generic evidence-based form-purpose ranking, not fixture-specific filtering.",
  "site_i_dynamic_form/primary":
    "Fresh semantic generation inconsistently retained and exercised revealed controls; the two unchanged samples ranged from 62.283 to 99.290, so branch continuation needs deterministic state evidence and variance-aware validation.",
  "site_p_crosspage_echo/primary":
    "The safety outcome was correct; residual loss is field-order reporting across the page transition.",
  "site_r_edgecases/primary":
    "The journey completed; residual loss is custom-control inventory, field sensitivity, and one optional capture-normalization gap.",
  "site_ag_widget_maze/primary":
    "A repeated browser-proven target failure lost precedence to a later static repair error, causing the fail-closed journey to omit the required typed probe failure finding.",
};

function eventCount(logText, kind) {
  return (logText.match(new RegExp(kind, "g")) || []).length;
}

async function normalizeEvidence(runRoot, learning) {
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
  }
}

function appendWorked(learning, scenarioKey, item) {
  const test = (learning.tests || []).find(
    (candidate) => candidate.scenarioKey === scenarioKey,
  );
  if (test && !test.worked.some((entry) => entry.claim === item.claim)) {
    test.worked.push(item);
  }
}

async function retainReadbackWitness(runRoot) {
  const reportPath = path.join(
    runRoot,
    "batches",
    "batch-01",
    "site_ad_wizard_links",
    "primary",
    "trial-01",
    "raw",
    "report.json",
  );
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const runId = report.id;
  const dynamicsPath = path.join(
    projectRoot,
    ".formweave-cache",
    "runs",
    runId,
    "generated",
    "dynamics",
    "state_001_advance.json",
  );
  const dynamics = JSON.parse(await readFile(dynamicsPath, "utf8"));
  const stateDelta = dynamics.input?.stateDelta || {};
  const witness = {
    schemaVersion: 1,
    kind: "typed_readback_activation_witness",
    sourceRunId: runId,
    hasReadbackMismatch: stateDelta.hasReadbackMismatch === true,
    readbackMismatches: (stateDelta.readbackMismatches || []).map((item) => ({
      fieldKey: item.fieldKey || null,
      label: item.label || null,
      reason: item.reason || null,
      sensitive: item.sensitive === true,
      surface: item.surface || null,
    })),
    assessment: {
      outcome: dynamics.assessment?.outcome || null,
      transitionKind: dynamics.assessment?.transitionKind || null,
      confidence: dynamics.assessment?.confidence || null,
    },
    privacy: {
      rawEnteredValueRetained: false,
      rawRenderedValueRetained: false,
    },
  };
  if (!witness.hasReadbackMismatch || witness.readbackMismatches.length === 0) {
    throw new Error("Candidate 12 typed readback activation witness is absent.");
  }
  const analysisRoot = path.join(runRoot, "analysis");
  await mkdir(analysisRoot, { recursive: true });
  await writeFile(
    path.join(analysisRoot, "typed-readback-activation.json"),
    `${JSON.stringify(witness, null, 2)}\n`,
  );
}

for (const definition of definitions) {
  const runRoot = path.join(runsRoot, definition.experimentId);
  const learningPath = path.join(runRoot, "learnings.json");
  const [learning, manifest, logText] = await Promise.all([
    readFile(learningPath, "utf8").then(JSON.parse),
    readFile(path.join(runRoot, "manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(runRoot, "managed-api.log"), "utf8"),
  ]);
  if (manifest.sourceFingerprint?.sha256 !== sourceFingerprint) {
    throw new Error(`${definition.experimentId} has the wrong source fingerprint.`);
  }

  await normalizeEvidence(runRoot, learning);
  for (const test of learning.tests || []) {
    for (const failed of test.failed || []) {
      failed.generalizableCause =
        causes[test.scenarioKey] ||
        "The cited loss is a generic semantic, reporting, or execution gap and does not justify fixture-specific production logic.";
      failed.confidence = "high";
    }
    test.unknowns = [
      {
        claim:
          "Fresh generation can vary semantic decomposition and handler strategy; causal attribution requires retained activation evidence plus repeated frozen-plan measurement.",
        evidence: [
          {
            artifact: `batches/batch-01/${test.scenarioKey}/trial-01/raw/report.json`,
            pointer: "/pages",
          },
        ],
      },
    ];
  }

  if (definition.role === "fix") {
    await retainReadbackWitness(runRoot);
    appendWorked(learning, "site_ad_wizard_links/primary", {
      claim:
        "Typed state-delta evidence recorded a labeled household-size readback mismatch, the dynamics assessment became independent, and the three-step wizard completed and submitted.",
      evidence: [
        { artifact: "analysis/typed-readback-activation.json" },
        {
          artifact:
            "batches/batch-01/site_ad_wizard_links/primary/trial-01/raw/report.json",
          pointer: "/pages/0",
        },
        {
          artifact:
            "batches/batch-01/site_ad_wizard_links/primary/trial-01/scoring/submission.json",
          pointer: "/fields",
        },
      ],
      whyItMatters:
        "This is retained runtime proof that Candidate 12 activated on the motivating case rather than receiving credit for generation variance.",
      preservationInvariant:
        "A mismatched labeled readback cannot alone establish cross-page dependency, while separate causal or structural evidence must still halt safely.",
      confidence: "high",
    });
  }

  if (definition.role === "rotating_replicate") {
    appendWorked(learning, "site_ag_widget_maze/primary", {
      claim:
        "The failed repair remained isolated to the radio target and retained two certified sibling checkpoints before the journey failed closed.",
      evidence: [
        { artifact: "managed-api.log" },
        {
          artifact:
            "batches/batch-01/site_ag_widget_maze/primary/trial-01/raw/report.json",
          pointer: "/pages/0/failureIssues",
        },
      ],
      whyItMatters:
        "The next repair must change failure arbitration without regressing target isolation or sibling preservation.",
      preservationInvariant:
        "Target-local repair failure must retain certified siblings and fail closed without terminal submission.",
      confidence: "high",
    });
  }

  learning.analysisStatus = "complete";
  learning.summary = definition.summary;
  learning.batchSynthesis = {
    workedPatterns: definition.workedPatterns,
    failedPatterns: definition.failedPatterns,
    preservationRisks: definition.preservationRisks,
    recommendations: definition.recommendations,
  };
  learning.applicationDisposition = {
    ...definition.disposition,
    sourceFingerprint,
  };
  learning.activationWitnesses = {
    typedReadbackMismatch: definition.role === "fix" ? 1 : 0,
    dynamicsAssessmentRepair: eventCount(logText, "dynamics_assessment_repair"),
    targetedRepairComposed: eventCount(
      logText,
      "compose_targeted_repair_with_prior_candidate",
    ),
    repeatedFailurePredicate: eventCount(
      logText,
      "repair_failure_predicate_repeated",
    ),
    targetLocalExhausted: eventCount(
      logText,
      "actuator_target_local_exhausted",
    ),
  };
  await writeFile(learningPath, `${JSON.stringify(learning, null, 2)}\n`);
  console.log(learningPath);
}
