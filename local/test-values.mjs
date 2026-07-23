const LEGAL_OR_CONSEQUENTIAL =
  /\b(?:agree|agreement|attest|attestation|certif|consent|authorize|authorization|terms|privacy policy|signature|sign here|payment|credit card|debit card|bank account|routing number)\b/i;

const HUMAN_REVIEW =
  /\b(?:captcha|human verification|security challenge|one[- ]time code|verification code|mfa|2fa|upload|attach(?:ment)?|file)\b/i;

function clampText(value, descriptor) {
  const maximum = Number.parseInt(String(descriptor.maxLength || ""), 10);
  const minimum = Number.parseInt(String(descriptor.minLength || ""), 10);
  let result = String(value);
  if (Number.isFinite(maximum) && maximum > 0) result = result.slice(0, maximum);
  if (Number.isFinite(minimum) && minimum > result.length) {
    result = `${result}${"0".repeat(minimum - result.length)}`;
  }
  return result;
}

function firstEnabledOption(descriptor) {
  return (descriptor.options || []).find(
    (option) => !option.disabled && String(option.value || "").trim()
  );
}

export function classifyFieldSafety(descriptor) {
  const text = `${descriptor.label || ""} ${descriptor.name || ""} ${
    descriptor.id || ""
  }`;
  if (
    descriptor.disabled ||
    descriptor.readOnly ||
    descriptor.hidden ||
    descriptor.type === "file" ||
    HUMAN_REVIEW.test(text)
  ) {
    return {
      classification: "human_review",
      reason: "The control requires a person, a file, credentials, or verification.",
    };
  }
  if (
    ["checkbox", "radio", "switch"].includes(descriptor.type) &&
    LEGAL_OR_CONSEQUENTIAL.test(text)
  ) {
    return {
      classification: "human_review",
      reason: "The control appears to accept legal, financial, or consequential terms.",
    };
  }
  return {
    classification: "deterministic",
    reason: "A synthetic value can exercise this control without representing a person.",
  };
}

export function deterministicTestValue(descriptor, sequence = 0) {
  const label = `${descriptor.label || ""} ${descriptor.name || ""} ${
    descriptor.autocomplete || ""
  }`.toLowerCase();
  const type = String(descriptor.type || descriptor.control || "text").toLowerCase();
  const suffix = String(sequence + 1).padStart(2, "0");

  if (["checkbox", "radio", "switch"].includes(type)) return "true";
  if (type === "select" || descriptor.tag === "select") {
    const option = firstEnabledOption(descriptor);
    return option ? String(option.value) : "";
  }
  if (type === "email" || /\bemail\b/.test(label)) {
    return `formweave.test+${suffix}@example.invalid`;
  }
  if (type === "url" || /\bwebsite|url\b/.test(label)) {
    return "https://example.invalid/formweave-test";
  }
  if (type === "tel" || /\bphone|mobile|telephone\b/.test(label)) {
    return "4155550101";
  }
  if (type === "date" || /\bdate of birth|birth date|dob\b/.test(label)) {
    return "1990-01-15";
  }
  if (type === "datetime-local") return "2030-01-15T10:30";
  if (type === "month") return "2030-01";
  if (type === "week") return "2030-W03";
  if (type === "time") return "10:30";
  if (type === "color") return "#2fa876";
  if (type === "range") {
    const minimum = Number(descriptor.min ?? 0);
    const maximum = Number(descriptor.max ?? 100);
    return String(Math.round((minimum + maximum) / 2));
  }
  if (
    type === "number" ||
    /\b(?:count|number of|household size|adults|children|quantity)\b/.test(label)
  ) {
    const minimum = Number(descriptor.min ?? 1);
    const maximum = Number(descriptor.max ?? Math.max(2, minimum));
    return String(Math.max(minimum, Math.min(maximum, 2)));
  }
  if (/\bzip|postal\b/.test(label)) return "94105";
  if (/\baccount number\b/.test(label)) return "1234567890";
  if (/\bssn|social security\b/.test(label)) return "000000000";
  if (/\bfirst name\b/.test(label)) return clampText("FormWeave", descriptor);
  if (/\blast name\b/.test(label)) return clampText("Tester", descriptor);
  if (/\bfull name|customer name|legal name|applicant name|\bname\b/.test(label)) {
    return clampText("FormWeave Tester", descriptor);
  }
  if (/\baddress.*(?:line 1|street)|street address\b/.test(label)) {
    return clampText("123 Test Street", descriptor);
  }
  if (/\baddress.*line 2|apartment|suite\b/.test(label)) {
    return clampText("Suite 42", descriptor);
  }
  if (/\bcity\b/.test(label)) return clampText("Testville", descriptor);
  if (/\bstate\b/.test(label)) return clampText("California", descriptor);
  if (/\bcountry\b/.test(label)) return clampText("United States", descriptor);
  if (/\bincome|salary|amount\b/.test(label)) return "42000";
  if (/\bcode|reference|case id|member number|identifier\b/.test(label)) {
    return clampText(`FWTEST${suffix}42`, descriptor);
  }
  if (type === "password") return clampText("FormWeave-Test-42!", descriptor);
  if (type === "textarea" || descriptor.tag === "textarea") {
    return clampText(
      "Synthetic FormWeave traversal test. No real person or application is represented.",
      descriptor
    );
  }
  return clampText(`FormWeave test ${suffix}`, descriptor);
}

export function branchTestValues(descriptor, maximum = 3) {
  if (descriptor.type === "select" || descriptor.tag === "select") {
    return (descriptor.options || [])
      .filter((option) => !option.disabled && String(option.value || "").trim())
      .slice(0, maximum)
      .map((option) => String(option.value));
  }
  if (descriptor.type === "radio") {
    return (descriptor.groupOptions || [])
      .filter((option) => !option.disabled)
      .slice(0, maximum)
      .map((option) => String(option.value));
  }
  if (["checkbox", "switch"].includes(descriptor.type)) {
    return ["false", "true"].slice(0, maximum);
  }
  return [];
}
