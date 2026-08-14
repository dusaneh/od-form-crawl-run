const CANONICAL_KEYS = new Set([
  "current_address",
  "annual_income",
  "city",
  "date_of_birth",
  "disability_status",
  "email",
  "first_name",
  "full_name",
  "household_size",
  "housing_status",
  "has_children",
  "immigration_status",
  "last_name",
  "middle_name",
  "monthly_income",
  "num_children",
  "phone",
  "zip_code",
  "primary_language",
  "referral_source",
  "services_requested",
  "ssn_last4",
  "state",
  "veteran_status",
]);

const EXACT_ALIASES = new Map([
  ["address_1", "current_address"],
  ["address", "current_address"],
  ["address_line_1", "current_address"],
  ["birth_date", "date_of_birth"],
  ["dateofbirth", "date_of_birth"],
  ["disability_rating", "disability_status"],
  ["dob", "date_of_birth"],
  ["email_address", "email"],
  ["current_housing", "housing_status"],
  ["current_address", "current_address"],
  ["children_count", "num_children"],
  ["housing_situation", "housing_status"],
  ["phone_number", "phone"],
  ["referred_by", "referral_source"],
  ["referral", "referral_source"],
  ["preferred_language", "primary_language"],
  ["telephone", "phone"],
  ["postal_code", "zip_code"],
  ["zipcode", "zip_code"],
]);

function identity(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function reconcileCanonicalProfileKey(field = {}) {
  const retainedIdentity = identity(field.canonicalProfileKey);
  const retained = EXACT_ALIASES.get(retainedIdentity) || retainedIdentity;
  if (CANONICAL_KEYS.has(retained)) return retained;

  const identities = [
    field.key,
    field.name,
    field.id,
    field.questionRef,
    field.rawIdentity?.name,
    field.rawIdentity?.id,
  ]
    .map(identity)
    .filter(Boolean);
  for (const candidate of identities) {
    const canonical = EXACT_ALIASES.get(candidate) || candidate;
    if (CANONICAL_KEYS.has(canonical)) return canonical;
  }
  const optionRows = Array.isArray(field.options)
    ? field.options
    : Array.isArray(field.observedOptions)
      ? field.observedOptions
      : [];
  const semanticContext = [
    field.label,
    field.rawLabel,
    ...optionRows.flatMap((option) => [
      option?.label,
      option?.value,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    identities.includes("current_situation") &&
    /\b(?:housing|housed|unhoused|homeless|shelter|rent)\b/.test(
      semanticContext,
    )
  ) {
    return "housing_status";
  }
  if (
    identities.some((candidate) =>
      ["aid_type", "help_needed", "type_of_help"].includes(candidate),
    ) &&
    /\b(?:rent|utilit|food|housing|service|assistance)\b/.test(
      semanticContext,
    )
  ) {
    return "services_requested";
  }
  return "unmappable";
}

export function canonicalProfileKeys() {
  return new Set(CANONICAL_KEYS);
}
