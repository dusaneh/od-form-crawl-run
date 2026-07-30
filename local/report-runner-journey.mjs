const PREPARATION_CATEGORIES = new Set([
  "cookie_consent",
  "welcome_banner",
  "optional_offer",
  "optional_auth",
  "safe_disclosure",
  "intro_advance",
]);

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function quoted(value) {
  return `“${text(value)}”`;
}

export function humanizeActionKey(value) {
  const raw = text(value);
  if (!raw) return "the indicated control";
  const words = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s._:/-]+/)
    .filter(Boolean);
  const actionWords = new Set([
    "accept",
    "agree",
    "apply",
    "begin",
    "confirm",
    "continue",
    "finish",
    "next",
    "open",
    "proceed",
    "review",
    "save",
    "send",
    "start",
    "submit",
  ]);
  const actionIndex = words.findIndex((word) =>
    actionWords.has(word.toLowerCase()),
  );
  const useful = actionIndex >= 0 ? words.slice(actionIndex) : words;
  const label = useful.join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function progressionLabel(progression, exchange) {
  return text(
    exchange?.script?.progression?.label ||
      progression?.label ||
      humanizeActionKey(progression?.key),
  );
}

function fieldAuthority(field) {
  const disposition = text(field.safetyAuthority || field.safetyDisposition);
  for (const kind of [
    "review_confirmation",
    "acknowledgement",
    "signature",
    "consent",
    "upload",
  ]) {
    if (disposition.includes(kind)) return kind;
  }
  if (field.controlType === "file" || field.control === "file") return "upload";
  return "";
}

function fieldInstruction(field) {
  const label = text(field.label || field.key || "this field");
  const control = text(field.controlType || field.control || "text");
  const authority = fieldAuthority(field);
  let instruction;
  if (authority === "upload") {
    instruction = `Upload the requested file for ${quoted(label)}`;
  } else if (authority === "signature") {
    instruction = `Provide the requested signature in ${quoted(label)}`;
  } else if (authority === "consent") {
    instruction = `Give the requested consent for ${quoted(label)}`;
  } else if (authority === "acknowledgement") {
    instruction = `Acknowledge ${quoted(label)}`;
  } else if (authority === "review_confirmation") {
    instruction = `Confirm ${quoted(label)}`;
  } else if (["checkbox", "switch"].includes(control)) {
    instruction = `Set ${quoted(label)} as instructed by the submitted data`;
  } else if (["radio", "select"].includes(control)) {
    instruction = `Choose the submitted option for ${quoted(label)}`;
  } else if (control === "date") {
    instruction = `Enter the submitted date for ${quoted(label)}`;
  } else if (control === "textarea") {
    instruction = `Enter the submitted response for ${quoted(label)}`;
  } else {
    instruction = `Enter the submitted value for ${quoted(label)}`;
  }
  return `${instruction}${field.required ? " (required)" : " (optional)"}.`;
}

function fieldRow(field, sectionLabel = "") {
  return {
    key: text(field.key),
    label: text(field.label || field.key),
    control: text(field.controlType || field.control || "text"),
    required: field.required === true,
    section: text(sectionLabel),
    action: fieldAuthority(field) || "complete_field",
    instruction: fieldInstruction(field),
  };
}

function conditionFor(coverage, fields) {
  const parent = fields.find((field) => field.key === coverage.fieldKey);
  const label = text(parent?.label || humanizeActionKey(coverage.fieldKey));
  return {
    fieldKey: text(coverage.fieldKey),
    fieldLabel: label,
    value: coverage.value,
    instruction: `Complete these fields only when ${quoted(label)} is ${quoted(
      coverage.value,
    )}.`,
  };
}

function progressionInstruction(progression, label, fieldCount) {
  const prefix =
    fieldCount > 0 ? "After completing the fields above, " : "";
  if (progression?.kind === "terminal_submit") {
    return `${prefix}select ${quoted(label)} to submit the completed form.`;
  }
  if (/cookie/i.test(`${label} ${progression?.rationale || ""}`)) {
    return `${prefix}select ${quoted(label)} to clear the cookie notice and continue.`;
  }
  return `${prefix}select ${quoted(label)} to continue to the next state.`;
}

function preparationSteps(report) {
  const steps = [];
  const seen = new Set();
  for (const page of report?.pages || []) {
    for (const action of page.automationActions || []) {
      if (!PREPARATION_CATEGORIES.has(action.category)) continue;
      const key = `${action.category}:${action.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = text(action.label || humanizeActionKey(action.category));
      steps.push({
        type: "preparation",
        title: humanizeActionKey(action.category),
        description: `Select ${quoted(label)} before completing the application.`,
        source: text(action.source || action.strategy),
        observedOutcome: text(action.outcome || "landed"),
      });
    }
  }
  return steps;
}

export function buildRunnerJourney(report, exchanges = [], plan = null) {
  const states = Array.isArray(plan?.states) ? plan.states : [];
  if (states.length === 0) {
    return {
      schemaVersion: 1,
      available: false,
      source: "llm_authored_script",
      summary:
        "No executable LLM-authored script was available, so no runner actions can be approved from this report.",
      steps: [],
      fieldCount: 0,
      stateCount: 0,
      terminalActionCount: 0,
    };
  }

  const exchangeByState = new Map(
    exchanges.map((exchange) => [text(exchange.stateKey), exchange]),
  );
  const steps = preparationSteps(report);
  let fieldCount = 0;
  let terminalActionCount = 0;

  for (const state of states) {
    const exchange = exchangeByState.get(text(state.state?.key));
    const sectionLabels = new Map(
      (state.sections || []).map((section) => [
        section.key,
        section.label || section.key,
      ]),
    );
    const fields = (state.fields || [])
      .filter(
        (field) =>
          field.actuate === true &&
          !/rejected|protected_not_actuated|not_proposed/i.test(
            text(field.safetyAuthority || field.safetyDisposition),
          ),
      )
      .map((field) =>
        fieldRow(field, sectionLabels.get(field.sectionKey) || ""),
      );
    const conditionalGroups = (state.choiceCoverage || [])
      .filter((coverage) => coverage.variantPlan)
      .map((coverage) => {
        const variant = coverage.variantPlan;
        const variantSections = new Map(
          (variant.sections || []).map((section) => [
            section.key,
            section.label || section.key,
          ]),
        );
        const variantFields = (variant.fields || [])
          .filter((field) => field.actuate === true)
          .map((field) =>
            fieldRow(field, variantSections.get(field.sectionKey) || ""),
          );
        fieldCount += variantFields.length;
        return {
          condition: conditionFor(coverage, state.fields || []),
          fields: variantFields,
        };
      })
      .filter((group) => group.fields.length > 0);
    fieldCount += fields.length;

    const label = progressionLabel(state.progression, exchange);
    const terminal = state.progression?.kind === "terminal_submit";
    if (terminal) terminalActionCount += 1;
    const title = text(
      state.state?.description ||
        exchange?.label ||
        `Application state ${steps.length + 1}`,
    );
    steps.push({
      type: "state",
      stateKey: text(state.state?.key),
      title,
      route: text(state.state?.route || exchange?.route),
      description:
        fields.length || conditionalGroups.length
          ? `Complete ${fields.length} always-visible field${
              fields.length === 1 ? "" : "s"
            }${conditionalGroups.length ? " and the applicable conditional fields" : ""}.`
          : "No applicant fields are completed in this state.",
      fields,
      conditionalGroups,
      progression: {
        kind: text(state.progression?.kind),
        label,
        instruction: progressionInstruction(
          state.progression,
          label,
          fields.length +
            conditionalGroups.reduce(
              (sum, group) => sum + group.fields.length,
              0,
            ),
        ),
        rationale: text(
          state.progression?.rationale ||
            exchange?.semantics?.progression?.rationale,
        ),
        observedOutcome: text(exchange?.execution?.progressionOutcome),
      },
    });
  }

  const stateCount = states.length;
  const advanceCount = states.filter(
    (state) => state.progression?.kind === "advance",
  ).length;
  return {
    schemaVersion: 1,
    available: true,
    source: "llm_authored_script",
    artifactId: text(plan.artifactId),
    scriptVersion: Number(plan.scriptVersion || 0),
    summary: `The approved runner will follow ${stateCount} ordered state${
      stateCount === 1 ? "" : "s"
    }, complete ${fieldCount} modeled field${
      fieldCount === 1 ? "" : "s"
    }, advance ${advanceCount} time${
      advanceCount === 1 ? "" : "s"
    }, and reach ${terminalActionCount} terminal submission action${
      terminalActionCount === 1 ? "" : "s"
    }.`,
    approvalNote:
      "This journey is rendered from the retained LLM-authored script. Runtime values come from the client payload; the crawl's synthetic values are only approval and debugging aids.",
    steps: steps.map((step, index) => ({ ...step, sequence: index + 1 })),
    fieldCount,
    stateCount,
    terminalActionCount,
  };
}
