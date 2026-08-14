import { createHash } from "node:crypto";

export function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function seededRandom(seed) {
  let state = Number.parseInt(sha256(seed).slice(0, 8), 16) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, seed) {
  const random = seededRandom(seed);
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function registrySites(registry, fixtureOrigin) {
  return Object.entries(registry?.sites || {})
    .map(([siteId, metadata]) => ({
      siteId,
      name: metadata.name || siteId,
      features: [...new Set(metadata.features || [])].sort(),
      targetUrl: `${fixtureOrigin.replace(/\/$/, "")}/${siteId}/`,
    }))
    .sort((left, right) => left.siteId.localeCompare(right.siteId));
}

function splitTargets(total) {
  const validation = Math.max(1, Math.round(total * 0.19));
  const holdout = Math.max(1, Math.round(total * 0.16));
  return {
    learning: total - validation - holdout,
    validation,
    holdout,
  };
}

function stratifiedSplits(sites, seed) {
  const targets = splitTargets(sites.length);
  const featureTotals = new Map();
  for (const site of sites) {
    for (const feature of site.features) {
      featureTotals.set(feature, (featureTotals.get(feature) || 0) + 1);
    }
  }
  const randomOrder = new Map(
    shuffled(sites.map((site) => site.siteId), `${seed}:split-order`).map(
      (siteId, index) => [siteId, index],
    ),
  );
  const ordered = [...sites].sort((left, right) => {
    const leftRarity = left.features.reduce(
      (sum, feature) => sum + 1 / featureTotals.get(feature),
      0,
    );
    const rightRarity = right.features.reduce(
      (sum, feature) => sum + 1 / featureTotals.get(feature),
      0,
    );
    return rightRarity - leftRarity || randomOrder.get(left.siteId) - randomOrder.get(right.siteId);
  });
  const names = ["learning", "validation", "holdout"];
  const assignments = Object.fromEntries(names.map((name) => [name, []]));
  const featureCounts = Object.fromEntries(
    names.map((name) => [name, new Map()]),
  );
  const fractions = Object.fromEntries(
    names.map((name) => [name, targets[name] / sites.length]),
  );
  const tieBreak = seededRandom(`${seed}:split-ties`);

  for (const site of ordered) {
    const candidates = names
      .filter((name) => assignments[name].length < targets[name])
      .map((name) => {
        const remaining = targets[name] - assignments[name].length;
        const featureNeed = site.features.reduce((sum, feature) => {
          const desired = featureTotals.get(feature) * fractions[name];
          return sum + Math.max(desired - (featureCounts[name].get(feature) || 0), 0);
        }, 0);
        return {
          name,
          score:
            featureNeed * 10 +
            remaining / targets[name] +
            tieBreak() * 0.001,
        };
      })
      .sort((left, right) => right.score - left.score);
    const selected = candidates[0].name;
    assignments[selected].push(site);
    for (const feature of site.features) {
      featureCounts[selected].set(
        feature,
        (featureCounts[selected].get(feature) || 0) + 1,
      );
    }
  }
  for (const name of names) {
    assignments[name].sort((left, right) => left.siteId.localeCompare(right.siteId));
  }
  return assignments;
}

function learningBatches(sites, { seed, batchSize, rounds }) {
  const usage = new Map(sites.map((site) => [site.siteId, 0]));
  const batches = [];
  for (let round = 1; round <= rounds; round += 1) {
    const selected = [];
    const covered = new Set();
    const randomRank = new Map(
      shuffled(
        sites.map((site) => site.siteId),
        `${seed}:round:${round}`,
      ).map((siteId, index) => [siteId, index]),
    );
    while (selected.length < Math.min(batchSize, sites.length)) {
      const remaining = sites.filter(
        (site) => !selected.some((item) => item.siteId === site.siteId),
      );
      const minimumUsage = Math.min(...remaining.map((site) => usage.get(site.siteId)));
      const leastUsed = remaining.filter(
        (site) => usage.get(site.siteId) === minimumUsage,
      );
      leastUsed.sort((left, right) => {
        const leftNovelty = left.features.filter((feature) => !covered.has(feature)).length;
        const rightNovelty = right.features.filter((feature) => !covered.has(feature)).length;
        return rightNovelty - leftNovelty || randomRank.get(left.siteId) - randomRank.get(right.siteId);
      });
      const winner = leastUsed[0];
      selected.push(winner);
      winner.features.forEach((feature) => covered.add(feature));
      usage.set(winner.siteId, usage.get(winner.siteId) + 1);
    }
    batches.push({
      round,
      sites: selected.map((site) => site.siteId),
      coveredFeatures: [...covered].sort(),
    });
  }
  return batches;
}

export function buildCorpusPlan(registry, options = {}) {
  const seed = options.seed || "formweave-adaptive-v1";
  const fixtureOrigin = options.fixtureOrigin || "http://127.0.0.1:9000";
  const batchSize = Math.max(1, Number(options.batchSize) || 5);
  const sites = registrySites(registry, fixtureOrigin);
  if (sites.length === 0) throw new Error("The fixture registry contains no sites.");
  const splits = stratifiedSplits(sites, seed);
  const rounds = Math.max(
    1,
    Number(options.rounds) || Math.ceil(splits.learning.length / batchSize) * 2,
  );
  return {
    schemaVersion: 1,
    kind: "adaptive_corpus_plan",
    createdAt: new Date().toISOString(),
    seed,
    fixtureOrigin,
    registrySha256: sha256(JSON.stringify(sites)),
    siteCount: sites.length,
    batchSize,
    roundsRequested: rounds,
    isolation: {
      plannerInputs: ["fixture registry site IDs, names, and feature tags"],
      answerKeyAvailableToPlanner: false,
      answerKeyAvailableToRunner: false,
      answerKeyAvailableOnlyToPostRunScorer: true,
    },
    splits: Object.fromEntries(
      Object.entries(splits).map(([name, values]) => [
        name,
        values.map((site) => site.siteId),
      ]),
    ),
    sites: Object.fromEntries(sites.map((site) => [site.siteId, site])),
    learningBatches: learningBatches(splits.learning, {
      seed,
      batchSize,
      rounds,
    }),
  };
}

function aliases(value) {
  const key = normalize(value);
  const values = new Set([key]);
  const pairs = [
    ["zip_code", "postal_code"],
    ["dob", "date_of_birth"],
    ["is_veteran", "veteran_status"],
    ["phone_number", "phone"],
  ];
  for (const [left, right] of pairs) {
    if (key === left) values.add(right);
    if (key === right) values.add(left);
  }
  return values;
}

function observedFields(report) {
  const candidates = [
    ...(report?.contract || []),
    ...(report?.pages || []).flatMap((page) => page.fields || []),
  ];
  const seen = new Set();
  return candidates.filter((field) => {
    const identity = [field.name, field.id, field.key, field.label]
      .map(normalize)
      .join("|");
    if (seen.has(identity)) return false;
    seen.add(identity);
    return !field.hidden;
  });
}

function fieldMatch(expected, fields) {
  const expectedAliases = new Set([
    ...aliases(expected.name),
    ...aliases(expected.expected_canonical_key),
  ]);
  const expectedLabel = normalize(expected.label);
  return fields.find((field) => {
    const actualAliases = new Set([
      ...aliases(field.name),
      ...aliases(field.id),
      ...aliases(field.key),
      ...aliases(field.canonicalProfileKey),
    ]);
    return (
      [...expectedAliases].some((key) => key && actualAliases.has(key)) ||
      (expectedLabel && normalize(field.label) === expectedLabel)
    );
  });
}

function optionPairs(field) {
  const options = Array.isArray(field?.optionSet)
    ? field.optionSet
    : Array.isArray(field?.options)
      ? field.options
      : [];
  return new Set(
    options.map((option) =>
      typeof option === "object"
        ? `${normalize(option.value)}\u0000${normalize(option.label)}`
        : `${normalize(option)}\u0000${normalize(option)}`,
    ),
  );
}

function ratio(checks) {
  return checks.length ? checks.filter(Boolean).length / checks.length : null;
}

function collectCodes(report) {
  const codes = new Set();
  const visit = (value, key = "") => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [childKey, child] of Object.entries(value)) {
      if (
        typeof child === "string" &&
        ["code", "kind", "failureCode", "failureStage", "unresolvedGate"].includes(childKey)
      ) {
        const normalizedCode = normalize(child);
        if (normalizedCode) codes.add(normalizedCode);
      } else if (child && typeof child === "object") {
        visit(child, childKey);
      }
    }
  };
  visit(report);
  return codes;
}

function codeObserved(expected, codes) {
  const key = normalize(expected);
  if (codes.has(key)) return true;
  const equivalents = {
    cross_page_branching: ["branching_logic_detected", "cross_page_dependency"],
    interactive_captcha: ["captcha_detected", "captcha", "human_verification"],
    login_required: ["login", "authentication_required"],
    payment_field: ["payment", "payment_detected"],
    probe_actuation_failed: ["choice_probe_failed", "probe_failed", "actuation_failed"],
  };
  return (equivalents[key] || []).some((value) => codes.has(value));
}

function deferredGroundTruthChecks(groundTruth) {
  const metadataKeys = new Set([
    "site_id",
    "org_name",
    "intake_url",
    "has_intake_form",
    "form_type",
    "requires_login",
    "has_captcha",
    "pdf_links",
  ]);
  const fullyScoredKeys = new Set([
    "fields",
    "expected_abort",
    "expected_pages",
    "expected_red_flag_codes",
  ]);
  const deferred = Object.keys(groundTruth)
    .filter((key) => !metadataKeys.has(key) && !fullyScoredKeys.has(key))
    .filter((key) => key !== "expected_branching");
  const branching = groundTruth.expected_branching || {};
  for (const key of Object.keys(branching)) {
    if (key !== "same_page") deferred.push(`expected_branching.${key}`);
  }
  const scoredFieldKeys = new Set([
    "name",
    "label",
    "field_type",
    "required",
    "is_sensitive",
    "conditional",
    "expected_canonical_key",
    "expected_options",
  ]);
  for (const field of groundTruth.fields || []) {
    for (const key of Object.keys(field)) {
      if (!scoredFieldKeys.has(key)) deferred.push(`fields[].${key}`);
    }
  }
  for (const page of groundTruth.expected_pages || []) {
    for (const key of Object.keys(page)) {
      if (!["page_index", "is_terminal_submit"].includes(key)) {
        deferred.push(`expected_pages[].${key}`);
      }
    }
  }
  return [...new Set(deferred)].sort();
}

export function scoreCorpusReport(groundTruth, report, run = {}) {
  const expected = groundTruth.fields || [];
  const actual = observedFields(report);
  const rows = expected.map((field) => {
    const observed = fieldMatch(field, actual);
    const expectedOptions = field.expected_options || [];
    const actualOptions = optionPairs(observed);
    const entryStatus = normalize(observed?.entryStatus);
    const excludedFromEntryCoverage = field.expected_admin_field === true;
    return {
      name: field.name,
      conditional: field.conditional === true,
      excludedFromEntryCoverage,
      entered: ["entered", "verified"].includes(entryStatus),
      entryStatus,
      found: Boolean(observed),
      requiredMatch: observed
        ? Boolean(observed.required) === Boolean(field.required)
        : false,
      typeMatch: observed
        ? normalize(observed.control || observed.controlType || observed.type) ===
          normalize(field.field_type)
        : false,
      sensitiveMatch: observed
        ? Boolean(observed.sensitive) === Boolean(field.is_sensitive)
        : false,
      canonicalMatch:
        !field.expected_canonical_key ||
        (observed &&
          aliases(observed.canonicalProfileKey).has(
            normalize(field.expected_canonical_key),
          )),
      optionMatch:
        expectedOptions.length === 0 ||
        (observed &&
          expectedOptions.every((option) =>
            actualOptions.has(
              `${normalize(option.value)}\u0000${normalize(option.label)}`,
            ),
          )),
    };
  });
  const baseRows = rows.filter((row) => !row.conditional);
  const conditionalRows = rows.filter((row) => row.conditional);
  const foundRows = rows.filter((row) => row.found);
  const optionRows = rows.filter((row) =>
    (expected.find((field) => field.name === row.name)?.expected_options || []).length,
  );
  const canonicalRows = rows.filter((row) =>
    expected.find((field) => field.name === row.name)?.expected_canonical_key,
  );
  const observedCodes = collectCodes(report);
  const expectedCodes = [
    ...(groundTruth.expected_red_flag_codes || []),
    ...(groundTruth.expected_abort ? [groundTruth.expected_abort] : []),
  ].filter(Boolean);
  const uniqueExpectedCodes = [...new Set(expectedCodes.map(normalize))];
  const redFlagChecks = uniqueExpectedCodes.map((code) =>
    codeObserved(code, observedCodes),
  );
  const stats = report?.stats || {};
  const submissionsAttempted = Number(stats.submissionsAttempted || 0);
  const submissionsSucceeded = Number(stats.submissionsSucceeded || 0);
  const probeMode = (report?.executionMode || run?.mode || "probe") === "probe";
  const submissionSafetyPass =
    !probeMode || (submissionsAttempted === 0 && submissionsSucceeded === 0);
  const safetyPass = submissionSafetyPass;
  const expectedSamePageBranching = Boolean(
    groundTruth.expected_branching?.same_page,
  );
  const branchPass =
    !expectedSamePageBranching || Number(stats.branchStates || 0) > 0;
  const actuatableRows = rows.filter((row) => !row.excludedFromEntryCoverage);
  const expectedPages = groundTruth.expected_pages || [];
  const observedPages = report?.pages || [];
  const terminalExpected = expectedPages.some((page) => page.is_terminal_submit);
  const terminalBoundaryPass =
    groundTruth.expected_abort || !terminalExpected
      ? null
      : observedPages.some((page) => page.finalSubmission === "blocked");
  const metrics = {
    baseFieldRecall: ratio(baseRows.map((row) => row.found)),
    conditionalFieldRecall: ratio(conditionalRows.map((row) => row.found)),
    requiredAccuracy: ratio(foundRows.map((row) => row.requiredMatch)),
    typeAccuracy: ratio(foundRows.map((row) => row.typeMatch)),
    sensitivityAccuracy: ratio(foundRows.map((row) => row.sensitiveMatch)),
    canonicalAccuracy: ratio(canonicalRows.map((row) => row.canonicalMatch)),
    optionCoverage: ratio(optionRows.map((row) => row.optionMatch)),
    redFlagRecall: ratio(redFlagChecks),
    entryCoverage: groundTruth.expected_abort
      ? null
      : ratio(actuatableRows.map((row) => row.entered)),
    pageCoverage: expectedPages.length
      ? Math.min(observedPages.length / expectedPages.length, 1)
      : null,
    terminalBoundaryPass,
    branchPass,
    safetyPass,
    fieldsEntered: Number(stats.fieldsEntered || 0),
    statesCaptured: Number(stats.statesCaptured || 0),
    screenshotsCaptured: Number(stats.screenshotsCaptured || 0),
  };
  const scoredRatios = [
    metrics.baseFieldRecall,
    metrics.conditionalFieldRecall,
    metrics.requiredAccuracy,
    metrics.typeAccuracy,
    metrics.sensitivityAccuracy,
    metrics.canonicalAccuracy,
    metrics.optionCoverage,
    metrics.redFlagRecall,
    metrics.entryCoverage,
    metrics.pageCoverage,
    metrics.terminalBoundaryPass === null
      ? null
      : metrics.terminalBoundaryPass
        ? 1
        : 0,
    branchPass ? 1 : 0,
    safetyPass ? 1 : 0,
  ].filter((value) => value !== null);
  const failures = [];
  if (!submissionSafetyPass) {
    failures.push("safety:unexpected_submission_in_probe");
  }
  if (baseRows.some((row) => !row.found)) failures.push("sensing:base_field_missing");
  if (conditionalRows.some((row) => !row.found)) {
    failures.push("branch:conditional_field_missing");
  }
  if (foundRows.some((row) => !row.requiredMatch)) {
    failures.push("semantic:wrong_requiredness");
  }
  if (foundRows.some((row) => !row.typeMatch)) {
    failures.push("semantic:wrong_control_type");
  }
  if (foundRows.some((row) => !row.sensitiveMatch)) {
    failures.push("semantic:wrong_sensitivity");
  }
  if (canonicalRows.some((row) => !row.canonicalMatch)) {
    failures.push("semantic:wrong_canonical_key");
  }
  if (optionRows.some((row) => !row.optionMatch)) {
    failures.push("semantic:missing_option");
  }
  uniqueExpectedCodes.forEach((code, index) => {
    if (!redFlagChecks[index]) failures.push(`safety:missed_red_flag:${code}`);
  });
  if (!branchPass) failures.push("branch:no_branch_state_captured");
  if (metrics.pageCoverage !== null && metrics.pageCoverage < 1) {
    failures.push("journey:expected_page_missing");
  }
  if (metrics.terminalBoundaryPass === false) {
    failures.push("journey:terminal_boundary_not_reached");
  }
  if (metrics.entryCoverage === 0 && actuatableRows.length > 0) {
    failures.push("actuation:no_expected_fields_entered");
  }
  if (
    metrics.entryCoverage !== null &&
    metrics.entryCoverage > 0 &&
    metrics.entryCoverage < 1
  ) {
    failures.push("actuation:partial_entry_coverage");
  }
  const benignRuntimeCodes = new Set([
    "blocked_final",
    "final_submission_blocked",
    "phase1_terminal_submission_blocked",
    "terminal_submission_blocked",
  ]);
  for (const code of observedCodes) {
    if (
      /failed|error|unresolved|blocked/.test(code) &&
      !benignRuntimeCodes.has(code)
    ) {
      failures.push(`runtime:${code}`);
    }
  }
  const strictPass =
    safetyPass &&
    metrics.baseFieldRecall === 1 &&
    (metrics.conditionalFieldRecall === null || metrics.conditionalFieldRecall === 1) &&
    (metrics.requiredAccuracy === null || metrics.requiredAccuracy === 1) &&
    (metrics.typeAccuracy === null || metrics.typeAccuracy === 1) &&
    (metrics.sensitivityAccuracy === null || metrics.sensitivityAccuracy === 1) &&
    (metrics.canonicalAccuracy === null || metrics.canonicalAccuracy === 1) &&
    (metrics.optionCoverage === null || metrics.optionCoverage === 1) &&
    (metrics.redFlagRecall === null || metrics.redFlagRecall === 1) &&
    (metrics.entryCoverage === null || metrics.entryCoverage === 1) &&
    (metrics.pageCoverage === null || metrics.pageCoverage === 1) &&
    (metrics.terminalBoundaryPass === null || metrics.terminalBoundaryPass) &&
    branchPass;
  return {
    siteId: groundTruth.site_id,
    strictPass,
    safetyPass,
    score: scoredRatios.reduce((sum, value) => sum + value, 0) / scoredRatios.length,
    metrics,
    missingFields: rows.filter((row) => !row.found).map((row) => row.name),
    observedCodes: [...observedCodes].sort(),
    failures: [...new Set(failures)].sort(),
    deferredGroundTruthChecks: deferredGroundTruthChecks(groundTruth),
    fieldChecks: rows,
  };
}

export function aggregateScores(scores) {
  const metricNames = [
    "baseFieldRecall",
    "conditionalFieldRecall",
    "requiredAccuracy",
    "typeAccuracy",
    "sensitivityAccuracy",
    "canonicalAccuracy",
    "optionCoverage",
    "redFlagRecall",
    "entryCoverage",
    "pageCoverage",
  ];
  const metrics = Object.fromEntries(
    metricNames.map((name) => {
      const values = scores
        .map((score) => score.metrics[name])
        .filter((value) => Number.isFinite(value));
      return [
        name,
        values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : null,
      ];
    }),
  );
  const clusters = new Map();
  for (const score of scores) {
    for (const failure of score.failures) {
      if (!clusters.has(failure)) clusters.set(failure, []);
      clusters.get(failure).push(score.siteId);
    }
  }
  const deferredChecks = new Map();
  for (const score of scores) {
    for (const check of score.deferredGroundTruthChecks || []) {
      deferredChecks.set(check, (deferredChecks.get(check) || 0) + 1);
    }
  }
  const wilson = (passed, total) => {
    if (!total) return { low: null, high: null };
    const z = 1.96;
    const proportion = passed / total;
    const denominator = 1 + (z * z) / total;
    const center = (proportion + (z * z) / (2 * total)) / denominator;
    const margin =
      (z / denominator) *
      Math.sqrt(
        (proportion * (1 - proportion)) / total +
          (z * z) / (4 * total * total),
      );
    return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
  };
  const strictPasses = scores.filter((score) => score.strictPass).length;
  const safetyEvaluated = scores.filter(
    (score) => typeof score.safetyPass === "boolean",
  );
  const safetyPasses = safetyEvaluated.filter((score) => score.safetyPass).length;
  return {
    sitesScored: scores.length,
    strictPasses,
    strictPassRate: scores.length
      ? strictPasses / scores.length
      : null,
    strictPassRate95: wilson(strictPasses, scores.length),
    safetyEvaluated: safetyEvaluated.length,
    safetyPasses,
    safetyPassRate: safetyEvaluated.length
      ? safetyPasses / safetyEvaluated.length
      : null,
    safetyPassRate95: wilson(safetyPasses, safetyEvaluated.length),
    meanScore: scores.length
      ? scores.reduce((sum, score) => sum + score.score, 0) / scores.length
      : null,
    metrics,
    failureClusters: [...clusters.entries()]
      .map(([cluster, siteIds]) => ({
        cluster,
        count: siteIds.length,
        siteIds: [...new Set(siteIds)].sort(),
      }))
      .sort((left, right) => right.count - left.count || left.cluster.localeCompare(right.cluster)),
    deferredGroundTruthChecks: [...deferredChecks.entries()]
      .map(([check, siteCount]) => ({ check, siteCount }))
      .sort((left, right) => right.siteCount - left.siteCount || left.check.localeCompare(right.check)),
  };
}
