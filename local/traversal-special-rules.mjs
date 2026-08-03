const PLACEHOLDER_OPTION_LABEL =
  /^(?:choose|select|please choose|please select)(?:\s+(?:one|an option))?$/i;

const NUMERIC_OPTION = /^[+-]?(?:\d+(?:[.,]\d+)?|\.\d+)$/;

const MONTH_NAMES = new Set([
  "jan",
  "january",
  "feb",
  "february",
  "mar",
  "march",
  "apr",
  "april",
  "may",
  "jun",
  "june",
  "jul",
  "july",
  "aug",
  "august",
  "sep",
  "sept",
  "september",
  "oct",
  "october",
  "nov",
  "november",
  "dec",
  "december",
]);

function normalizedOptionText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

export function meaningfulChoiceOptions(field) {
  const options =
    Array.isArray(field?.observedOptions) && field.observedOptions.length > 0
      ? field.observedOptions
      : field?.options || [];
  return options.filter((option) => {
    const value = String(option?.value ?? "").trim();
    const label = String(option?.label ?? "").trim();
    return value !== "" && !PLACEHOLDER_OPTION_LABEL.test(label);
  });
}

function allOptionsAreNumeric(field) {
  const options = meaningfulChoiceOptions(field);
  if (options.length === 0) return false;
  return (
    options.every((option) => NUMERIC_OPTION.test(String(option.value).trim())) ||
    options.every((option) => NUMERIC_OPTION.test(String(option.label).trim()))
  );
}

function looksLikeCalendarMonthSelect(field) {
  const identity = [
    field?.key,
    field?.label,
    field?.rawLabel,
    field?.rawIdentity?.id,
    field?.rawIdentity?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
  const identitySaysMonth =
    /\bmonth\b/.test(identity) ||
    /\b(?:dob|birth|expiry|expiration)[\s_-]*(?:mo|mm)\b/.test(identity) ||
    /\b(?:mo|mm)[\s_-]*(?:dob|birth|expiry|expiration)\b/.test(identity);

  const options = meaningfulChoiceOptions(field);
  const monthLikeCount = options.filter((option) =>
    MONTH_NAMES.has(normalizedOptionText(option.label || option.value)),
  ).length;
  const optionsAreMostlyMonthNames =
    options.length >= 6 && monthLikeCount / options.length >= 0.75;
  return identitySaysMonth || optionsAreMostlyMonthNames;
}

// Keep dependency-probe exceptions together: these rules deliberately trade
// exhaustive branching for predictable traversal cost on calendar-like selects.
export const DEPENDENCY_PROBE_EXEMPTION_RULES = Object.freeze([
  Object.freeze({
    code: "numeric_select_options",
    description:
      "Select options are numeric, so they are treated as bounded scalar input rather than dependency branches.",
    matches: allOptionsAreNumeric,
  }),
  Object.freeze({
    code: "calendar_month_select",
    description:
      "The select is identified as a calendar month by its identity or a mostly month-name option set.",
    matches: looksLikeCalendarMonthSelect,
  }),
]);

export function dependencyProbeExemption(field) {
  if (field?.controlType !== "select") return null;
  return (
    DEPENDENCY_PROBE_EXEMPTION_RULES.find((rule) => rule.matches(field)) || null
  );
}

export function expectedDependencyProbeValues(field) {
  if (!field?.actuate || field.legalAcceptanceType) return [];
  if (["checkbox", "switch"].includes(field.controlType)) {
    return [false, true];
  }
  if (!["select", "radio"].includes(field.controlType)) return [];
  if (dependencyProbeExemption(field)) return [];
  return meaningfulChoiceOptions(field).map((option) => option.value);
}
