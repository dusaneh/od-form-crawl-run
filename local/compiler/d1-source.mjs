import { fileURLToPath, pathToFileURL } from "node:url";

const runtimeUrl = pathToFileURL(
  fileURLToPath(
    new URL("../executor/generated-d1-runtime.mjs", import.meta.url),
  ),
).href;

export const D1_ALLOWED_RUNTIME_SPECIFIER = runtimeUrl;
export const D1_INTERFACE_VERSION = 1;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function encodedDescriptor(descriptor) {
  return Buffer.from(JSON.stringify(canonical(descriptor)), "utf8").toString(
    "base64url",
  );
}

export function renderGeneratedD1Source(descriptor) {
  const encoded = encodedDescriptor(descriptor);
  return [
    `import { createGeneratedD1Runtime } from ${JSON.stringify(runtimeUrl)};`,
    "",
    `export const D1_INTERFACE_VERSION = ${D1_INTERFACE_VERSION};`,
    `export const descriptor = Object.freeze(JSON.parse(Buffer.from(${JSON.stringify(
      encoded,
    )}, "base64url").toString("utf8")));`,
    "",
    "export function createRuntime(options) {",
    "  return createGeneratedD1Runtime(descriptor, options);",
    "}",
    "",
  ].join("\n");
}

export function assertGeneratedD1Source(source, expectedDescriptor) {
  const expected = renderGeneratedD1Source(expectedDescriptor);
  if (source !== expected) {
    throw new TypeError(
      "Generated D1 source does not match the closed compiler template.",
    );
  }
  const imports = [...source.matchAll(/^\s*import\s+[^;]+from\s+["']([^"']+)["'];/gm)]
    .map((match) => match[1]);
  if (imports.length !== 1 || imports[0] !== runtimeUrl) {
    throw new TypeError("Generated D1 source has an import outside the allowlist.");
  }
  if (
    /\b(?:import\s*\(|require\s*\(|eval\s*\(|new\s+Function\b|process\.|globalThis\.)/.test(
      source,
    )
  ) {
    throw new TypeError("Generated D1 source contains a forbidden runtime primitive.");
  }
  return true;
}
