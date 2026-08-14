const CANONICAL_KEYS = new Set([
  "first_name",
  "middle_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "date_of_birth",
  "current_address",
  "city",
  "state",
  "zip_code",
  "household_size",
  "has_children",
  "num_children",
  "monthly_income",
  "annual_income",
  "housing_status",
  "services_requested",
  "disability_status",
  "veteran_status",
  "immigration_status",
  "primary_language",
  "referral_source",
  "ssn_last4",
]);

export function buildRepairQueue({ proposal, safety, changeMap }) {
  const confidence = new Map(
    proposal.rationale.map((item) => [item.subjectKey, item.confidence]),
  );
  const items = [];
  for (const field of proposal.fields) {
    const level = confidence.get(field.key) || "unreported";
    if (["low", "unreported"].includes(level)) {
      items.push({
        subjectKey: field.key,
        reason: "low_or_missing_confidence",
        severity: "review",
        confidence: level,
      });
    }
    if (!CANONICAL_KEYS.has(field.key)) {
      items.push({
        subjectKey: field.key,
        reason: "noncanonical_binding",
        severity: field.required ? "high" : "review",
        confidence: level,
      });
    }
    const label = field.rawLabel.toLowerCase();
    if (
      (label.includes("annual") && field.key === "monthly_income") ||
      (label.includes("monthly") && field.key === "annual_income")
    ) {
      items.push({
        subjectKey: field.key,
        reason: "income_period_contradiction",
        severity: "critical",
        confidence: level,
      });
    }
  }
  for (const rejection of safety.rejections) {
    if (rejection.code === "unsafe_value") {
      const action = proposal.proposedActions.find(
        (item) => item.proposalId === rejection.proposalId,
      );
      items.push({
        subjectKey: action?.targetKey || rejection.proposalId,
        reason: "unsafe_synthetic_value",
        severity: "high",
        confidence: confidence.get(action?.targetKey) || "unreported",
      });
    }
  }
  for (const probe of changeMap.probes) {
    for (const fact of probe.added.filter((item) => item.visible)) {
      items.push({
        subjectKey: fact.name || fact.id || fact.factId,
        reason: "branch_added_control",
        severity: fact.required ? "critical" : "high",
        confidence: "unreported",
        trigger: {
          stateKey: probe.stateKey,
          fieldKey: probe.fieldKey,
          value: probe.value,
        },
        rawFact: fact,
      });
    }
  }
  return {
    schemaVersion: 1,
    kind: "gate4_repair_queue",
    items: items.sort(
      (left, right) =>
        ["critical", "high", "review"].indexOf(left.severity) -
          ["critical", "high", "review"].indexOf(right.severity) ||
        left.subjectKey.localeCompare(right.subjectKey),
    ),
  };
}
