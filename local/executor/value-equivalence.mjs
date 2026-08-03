export function alphanumericGist(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function scalarReadbackEquivalent(requested, landed) {
  if (Object.is(requested, landed)) return true;
  if (requested === null || requested === undefined) return false;
  if (landed === null || landed === undefined) return false;
  const requestedGist = alphanumericGist(requested);
  const landedGist = alphanumericGist(landed);
  return (
    requestedGist.length > 0 &&
    landedGist.length > 0 &&
    requestedGist === landedGist
  );
}
