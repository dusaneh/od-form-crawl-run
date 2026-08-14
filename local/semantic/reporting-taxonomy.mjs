export const REPORTING_TAXONOMY_VERSION = "1.1.0";

const STABLE_DESCRIPTIVE_SENSITIVITY = new Map([
  ["current_address", false],
  ["annual_income", true],
  ["city", false],
  ["date_of_birth", true],
  ["email", false],
  ["first_name", false],
  ["full_name", false],
  ["household_size", false],
  ["housing_status", false],
  ["has_children", false],
  ["last_name", false],
  ["middle_name", false],
  ["monthly_income", true],
  ["num_children", false],
  ["phone", false],
  ["zip_code", false],
  ["primary_language", false],
  ["referral_source", false],
  ["services_requested", false],
  ["state", false],
  ["veteran_status", false],
]);

export function canonicalDescriptiveSensitivity(canonicalKey) {
  if (!STABLE_DESCRIPTIVE_SENSITIVITY.has(canonicalKey)) return null;
  return {
    sensitive: STABLE_DESCRIPTIVE_SENSITIVITY.get(canonicalKey),
    taxonomyVersion: REPORTING_TAXONOMY_VERSION,
  };
}

export function normalizeReportedControlType(control) {
  return String(control || "text").toLowerCase() === "search"
    ? "text"
    : control;
}

export function normalizeReportedField(field = {}) {
  const canonicalProfileKey = reconcileCanonicalProfileKey(field);
  const canonicalDecision = canonicalDescriptiveSensitivity(
    canonicalProfileKey,
  );
  const control = normalizeReportedControlType(
    field.control || field.controlType,
  );
  const contactControl = ["email", "tel"].includes(
    String(control || "").toLowerCase(),
  );
  const descriptiveSensitivityDecision = canonicalDecision
    ? {
        sensitive: canonicalDecision.sensitive,
        code: canonicalDecision.sensitive
          ? `descriptive_sensitive_${canonicalProfileKey}`
          : `descriptive_non_sensitive_${canonicalProfileKey}`,
        source: "shared_reporting_policy",
        taxonomyVersion: canonicalDecision.taxonomyVersion,
        rationale:
          "The canonical field identity has a stable descriptive sensitivity classification.",
      }
    : contactControl
      ? {
          sensitive: false,
          code: "descriptive_non_sensitive_contact_control",
          source: "shared_reporting_policy",
          taxonomyVersion: REPORTING_TAXONOMY_VERSION,
          rationale:
            "Ordinary email and telephone controls are contact coordinates, not protected content in the reporting taxonomy.",
        }
      : field.descriptiveSensitivityDecision || null;
  return {
    ...field,
    control,
    canonicalProfileKey,
    sensitive:
      descriptiveSensitivityDecision?.sensitive ?? field.sensitive ?? false,
    ...(descriptiveSensitivityDecision
      ? { descriptiveSensitivityDecision }
      : {}),
  };
}
import { reconcileCanonicalProfileKey } from "./canonical-profile.mjs";
