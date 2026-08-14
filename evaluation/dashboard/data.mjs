import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const CATEGORY_DEFINITIONS = [
  { id: "structure_semantics", label: "Structure", shortLabel: "Structure" },
  { id: "journey_behavior", label: "Journey", shortLabel: "Journey" },
  { id: "execution_capture", label: "Execution", shortLabel: "Execution" },
  { id: "safety_privacy", label: "Safety & privacy", shortLabel: "Safety" },
];

const CORE_METRICS = [
  { id: "overall", label: "Overall score", shortLabel: "Overall", scope: "score" },
  { id: "strict", label: "Strict pass rate", shortLabel: "Strict", scope: "outcome" },
  { id: "safety", label: "Safety pass rate", shortLabel: "Safety pass", scope: "outcome" },
  ...CATEGORY_DEFINITIONS.map((category) => ({
    ...category,
    scope: "category",
  })),
];

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function directories(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function percent(value) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(value) * 100;
}

function mean(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function categoryMetrics(categories = {}) {
  return Object.fromEntries(
    CATEGORY_DEFINITIONS.map(({ id }) => [id, percent(categories?.[id]?.score ?? categories?.[id])]),
  );
}

function aggregateMetrics(aggregate = {}) {
  return {
    overall: Number.isFinite(Number(aggregate.overallScore))
      ? Number(aggregate.overallScore)
      : null,
    strict: percent(aggregate.strictPassRate),
    safety: percent(aggregate.safetyPassRate),
    ...Object.fromEntries(
      CATEGORY_DEFINITIONS.map(({ id }) => [id, percent(aggregate.categoryScores?.[id])]),
    ),
  };
}

function scenarioComplexity(plan, scenarioKey) {
  const scenario = plan?.scenarios?.[scenarioKey] || {};
  const value = scenario.complexity ?? scenario.complexityScore ?? scenario.difficulty;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function scenarioFeatures(plan, scenarioKey) {
  const values = plan?.scenarios?.[scenarioKey]?.featureTags;
  return Array.isArray(values) ? [...values].sort() : [];
}

function executionAssociation(execution, developmentRun) {
  return {
    developmentRunId: developmentRun.developmentRunId,
    developmentRunName: developmentRun.name || developmentRun.developmentRunId,
    sequence: Number(execution.sequence) || null,
    role: execution.role || "unclassified",
    batchId: execution.batchId || null,
    comparisonEligible: execution.comparisonEligible === true,
    candidateDecision: execution.candidateDecision || null,
    correctedOverallScore: Number.isFinite(Number(execution.correctedOverallScore))
      ? Number(execution.correctedOverallScore)
      : null,
    correctedStrictPassRate: Number.isFinite(Number(execution.correctedStrictPassRate))
      ? Number(execution.correctedStrictPassRate)
      : null,
    recordedOverallScore: Number.isFinite(Number(execution.overallScore))
      ? Number(execution.overallScore)
      : null,
    recordedStrictPassRate: Number.isFinite(Number(execution.strictPassRate))
      ? Number(execution.strictPassRate)
      : null,
    recordedSafetyPassRate: Number.isFinite(Number(execution.safetyPassRate))
      ? Number(execution.safetyPassRate)
      : null,
  };
}

async function loadDevelopmentRuns(developmentRoot) {
  const loaded = [];
  for (const directory of await directories(developmentRoot)) {
    const root = path.join(developmentRoot, directory);
    const run = await readJson(path.join(root, "run.json"));
    if (!run) continue;
    const trend = await readJson(path.join(root, "cumulative-trend.json"), {});
    loaded.push({
      ...run,
      trend,
      root,
    });
  }
  return loaded;
}

function publicDevelopmentRun(run) {
  return {
    id: run.developmentRunId,
    name: run.name || run.developmentRunId,
    status: run.status || "unknown",
    createdAt: run.createdAt || null,
    catalogRevision: run.catalog?.revision || null,
    process: run.process || null,
    cumulative: run.trend?.cumulative || null,
    assessment: run.trend?.assessment || null,
    measurements: run.trend?.measurements || [],
    unscored: run.trend?.unscored || [],
    executionCount: (run.executions || []).length,
  };
}

export async function buildDashboardData(projectRoot) {
  const historyRoot = path.join(projectRoot, "data", "evaluation-experiments");
  const experimentRunsRoot = path.join(historyRoot, "runs");
  const registry = await readJson(path.join(historyRoot, "registry", "runs.json"), {
    generatedAt: null,
    runs: [],
  });
  const developmentRuns = await loadDevelopmentRuns(
    path.join(historyRoot, "development-runs"),
  );
  const associations = new Map();
  for (const developmentRun of developmentRuns) {
    for (const execution of developmentRun.executions || []) {
      if (!execution.experimentId) continue;
      const rows = associations.get(execution.experimentId) || [];
      rows.push(executionAssociation(execution, developmentRun));
      associations.set(execution.experimentId, rows);
    }
  }

  const experiments = [];
  const batches = [];
  const trials = [];
  const checkDefinitions = new Map();

  for (const registryRun of registry.runs || []) {
    const experimentId = registryRun.experimentId;
    const recordedRoot = registryRun.outputRoot
      ? path.resolve(registryRun.outputRoot)
      : null;
    const recordedRelative = recordedRoot
      ? path.relative(experimentRunsRoot, recordedRoot)
      : null;
    const experimentRoot =
      recordedRoot &&
      recordedRelative &&
      !recordedRelative.startsWith("..") &&
      !path.isAbsolute(recordedRelative)
        ? recordedRoot
        : path.join(experimentRunsRoot, experimentId);
    const [score, plan, manifest] = await Promise.all([
      readJson(path.join(experimentRoot, "score.json")),
      readJson(path.join(experimentRoot, "plan.json"), {}),
      readJson(path.join(experimentRoot, "manifest.json"), {}),
    ]);
    if (!score) continue;
    const linked = associations.get(experimentId) || [];
    const primary = linked[0] || {
      developmentRunId: null,
      developmentRunName: null,
      sequence: null,
      role: "unclassified",
      batchId: null,
      comparisonEligible: false,
      candidateDecision: null,
      correctedOverallScore: null,
      correctedStrictPassRate: null,
      recordedOverallScore: null,
      recordedStrictPassRate: null,
      recordedSafetyPassRate: null,
    };
    const complexityValues = (score.trials || []).map((trial) =>
      scenarioComplexity(plan, trial.scenarioKey),
    );
    const experiment = {
      id: experimentId,
      completedAt: registryRun.completedAt || manifest.completedAt || null,
      candidate: score.candidate || registryRun.candidate || "unknown",
      candidateShort: String(score.candidate || registryRun.candidate || "unknown")
        .replace(/^devrun-[^-]+-[^-]+-/, "")
        .replace(/^candidate-/, "C"),
      status: score.aggregate?.status || registryRun.status || "unknown",
      qualitativeStatus: registryRun.qualitativeStatus || manifest.qualitativeStatus || "unknown",
      scorerVersion: score.scorerVersion || null,
      sourceFingerprint: score.sourceFingerprint?.sha256 || registryRun.sourceFingerprint?.sha256 || null,
      model: score.model || registryRun.model || null,
      configurationId: score.configurationId || null,
      planId: score.planId || null,
      metrics: {
        ...aggregateMetrics(score.aggregate),
        overall:
          primary.correctedOverallScore ??
          primary.recordedOverallScore ??
          aggregateMetrics(score.aggregate).overall,
        strict: percent(
          primary.correctedStrictPassRate ??
          primary.recordedStrictPassRate ??
          score.aggregate?.strictPassRate,
        ),
        safety: percent(
          primary.recordedSafetyPassRate ?? score.aggregate?.safetyPassRate,
        ),
      },
      correctedMetricsApplied:
        Number.isFinite(primary.correctedOverallScore) ||
        Number.isFinite(primary.correctedStrictPassRate),
      validTrials: Number(score.aggregate?.validTrials || 0),
      invalidTrials: Number(score.aggregate?.invalidTrials || 0),
      totalTrials: Number(score.aggregate?.totalTrials || 0),
      complexityMean: mean(complexityValues),
      developmentRunId: primary.developmentRunId,
      developmentRunName: primary.developmentRunName,
      sequence: primary.sequence,
      role: primary.role,
      batchId: primary.batchId,
      comparisonEligible: primary.comparisonEligible,
      candidateDecision: primary.candidateDecision,
      associations: linked,
      analysisSummary: registryRun.analysisSummary || null,
    };
    experiments.push(experiment);

    for (const batch of score.batches || []) {
      const batchTrials = (score.trials || []).filter(
        (trial) => trial.batchNumber === batch.batchNumber,
      );
      batches.push({
        id: `${experimentId}:batch-${batch.batchNumber}`,
        experimentId,
        batchNumber: batch.batchNumber,
        candidate: experiment.candidate,
        completedAt: experiment.completedAt,
        status: batch.aggregate?.status || experiment.status,
        metrics: aggregateMetrics(batch.aggregate),
        validTrials: Number(batch.aggregate?.validTrials || 0),
        invalidTrials: Number(batch.aggregate?.invalidTrials || 0),
        totalTrials: Number(batch.aggregate?.totalTrials || 0),
        complexityMean: mean(
          batchTrials.map((trial) => scenarioComplexity(plan, trial.scenarioKey)),
        ),
        features: Array.isArray(batch.coveredFeatures) ? batch.coveredFeatures : [],
        developmentRunId: primary.developmentRunId,
        sequence: primary.sequence,
        role: primary.role,
        batchId: primary.batchId,
      });
    }

    for (const trial of score.trials || []) {
      const checks = {};
      for (const check of trial.checks || []) {
        const id = `check:${check.id}`;
        checks[id] = percent(check.score);
        if (!checkDefinitions.has(id)) {
          checkDefinitions.set(id, {
            id,
            label: check.label || check.id,
            shortLabel: check.id,
            scope: "check",
            category: check.category || null,
          });
        }
      }
      trials.push({
        id: `${experimentId}:${trial.batchNumber}:${trial.scenarioKey}:${trial.trialNumber}`,
        experimentId,
        completedAt: experiment.completedAt,
        candidate: experiment.candidate,
        scenarioKey: trial.scenarioKey,
        siteId: trial.siteId || String(trial.scenarioKey || "unknown/unknown").split("/")[0],
        scenarioId: trial.scenarioId || String(trial.scenarioKey || "unknown/unknown").split("/")[1],
        batchNumber: trial.batchNumber,
        trialNumber: trial.trialNumber,
        status: trial.status,
        infrastructureInvalid: trial.infrastructureInvalid === true,
        complexity: scenarioComplexity(plan, trial.scenarioKey),
        features: scenarioFeatures(plan, trial.scenarioKey),
        metrics: {
          overall: Number(trial.overallScore),
          strict: trial.strictPass ? 100 : 0,
          safety: trial.safetyPass ? 100 : 0,
          ...categoryMetrics(trial.categories),
          ...checks,
        },
        developmentRunId: primary.developmentRunId,
        developmentRunName: primary.developmentRunName,
        sequence: primary.sequence,
        role: primary.role,
        batchId: primary.batchId,
      });
    }
  }

  const completedSort = (left, right) =>
    String(left.completedAt || "").localeCompare(String(right.completedAt || "")) ||
    left.id.localeCompare(right.id);
  experiments.sort(completedSort);
  batches.sort(completedSort);
  trials.sort(completedSort);

  const knownComplexities = trials
    .map((trial) => trial.complexity)
    .filter((value) => Number.isFinite(value));
  const roles = [...new Set([
    "fix",
    "regression",
    "rotating",
    ...experiments.map((experiment) => experiment.role),
  ])].filter(Boolean);

  const siteGroups = new Map();
  for (const trial of trials) {
    if (!siteGroups.has(trial.siteId)) siteGroups.set(trial.siteId, []);
    siteGroups.get(trial.siteId).push(trial);
  }
  const sites = [...siteGroups.entries()].map(([siteId, siteTrials]) => {
    const valid = siteTrials.filter((trial) => !trial.infrastructureInvalid);
    const experimentGroups = new Map();
    for (const trial of valid) {
      if (!experimentGroups.has(trial.experimentId)) {
        experimentGroups.set(trial.experimentId, []);
      }
      experimentGroups.get(trial.experimentId).push(trial);
    }
    const timeline = [...experimentGroups.entries()].map(
      ([experimentId, experimentTrials]) => {
        const experiment = experiments.find((row) => row.id === experimentId);
        return {
          id: `${siteId}:${experimentId}`,
          experimentId,
          completedAt: experiment?.completedAt || experimentTrials[0]?.completedAt || null,
          candidate: experiment?.candidate || experimentTrials[0]?.candidate || "unknown",
          role: experiment?.role || experimentTrials[0]?.role || "unclassified",
          developmentRunId: experiment?.developmentRunId || null,
          sequence: experiment?.sequence || null,
          status: experiment?.status || "unknown",
          trials: experimentTrials.length,
          metrics: Object.fromEntries(
            CORE_METRICS.map(({ id }) => [
              id,
              mean(experimentTrials.map((trial) => trial.metrics?.[id])),
            ]),
          ),
        };
      },
    ).sort(completedSort);
    return {
      siteId,
      scenarios: [...new Set(siteTrials.map((trial) => trial.scenarioId))].sort(),
      features: [...new Set(siteTrials.flatMap((trial) => trial.features || []))].sort(),
      trials: siteTrials.length,
      validTrials: valid.length,
      invalidTrials: siteTrials.length - valid.length,
      experiments: experimentGroups.size,
      complexityMean: mean(valid.map((trial) => trial.complexity)),
      metrics: Object.fromEntries(
        CORE_METRICS.map(({ id }) => [
          id,
          mean(valid.map((trial) => trial.metrics?.[id])),
        ]),
      ),
      timeline,
    };
  }).sort((left, right) => left.siteId.localeCompare(right.siteId));

  return {
    schemaVersion: 1,
    kind: "formweave_evaluation_dashboard_data",
    generatedAt: new Date().toISOString(),
    registryGeneratedAt: registry.generatedAt,
    summary: {
      experiments: experiments.length,
      batches: batches.length,
      trials: trials.length,
      developmentRuns: developmentRuns.length,
      complexityMin: knownComplexities.length ? Math.min(...knownComplexities) : 0,
      complexityMax: knownComplexities.length ? Math.max(...knownComplexities) : 0,
    },
    metricDefinitions: [...CORE_METRICS, ...checkDefinitions.values()],
    categoryDefinitions: CATEGORY_DEFINITIONS,
    roles,
    developmentRuns: developmentRuns.map(publicDevelopmentRun),
    experiments,
    batches,
    trials,
    sites,
  };
}
