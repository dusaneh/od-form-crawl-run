export function alphanumericGist(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function booleanReadback(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (["true", "on", "checked", "yes"].includes(normalized)) return true;
  if (["false", "off", "unchecked", "no"].includes(normalized)) return false;
  return null;
}

export function scalarReadbackEquivalent(requested, landed) {
  if (Object.is(requested, landed)) return true;
  if (requested === null || requested === undefined) return false;
  if (landed === null || landed === undefined) return false;
  if (Array.isArray(requested) || Array.isArray(landed)) {
    if (!Array.isArray(requested) || !Array.isArray(landed)) return false;
    if (requested.length !== landed.length) return false;
    const unmatched = [...landed];
    for (const expected of requested) {
      const index = unmatched.findIndex((actual) =>
        scalarReadbackEquivalent(expected, actual),
      );
      if (index < 0) return false;
      unmatched.splice(index, 1);
    }
    return unmatched.length === 0;
  }
  const requestedSelected =
    typeof requested === "object" && Object.hasOwn(requested, "value")
      ? requested.value
      : requested;
  const landedSelected =
    typeof landed === "object" && Object.hasOwn(landed, "value")
      ? landed.value
      : landed;
  if (requestedSelected !== requested || landedSelected !== landed) {
    return scalarReadbackEquivalent(requestedSelected, landedSelected);
  }
  if (typeof requested === "object" || typeof landed === "object") {
    return false;
  }
  if (typeof requested === "boolean" || typeof landed === "boolean") {
    const requestedBoolean = booleanReadback(requested);
    const landedBoolean = booleanReadback(landed);
    if (requestedBoolean !== null && landedBoolean !== null) {
      return requestedBoolean === landedBoolean;
    }
  }
  const requestedGist = alphanumericGist(requested);
  const landedGist = alphanumericGist(landed);
  return (
    requestedGist.length > 0 &&
    landedGist.length > 0 &&
    requestedGist === landedGist
  );
}
