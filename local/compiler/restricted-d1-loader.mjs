import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadGeneratedScriptVersion } from "../contracts/artifact-store.mjs";
import { assertGeneratedD1Source } from "./d1-source.mjs";

export async function loadRestrictedD1({
  dataRoot,
  artifactId,
  artifactVersion,
  scriptVersion,
}) {
  const loaded = await loadGeneratedScriptVersion({
    dataRoot,
    artifactId,
    artifactVersion,
    scriptVersion,
  });
  const descriptor = loaded.generationInput?.descriptor ||
    loaded.generationInput?.compiledDescriptor;
  const expectedDescriptor =
    descriptor ||
    (() => {
      throw new TypeError(
        "Generated D1 generation input is missing its compiled descriptor.",
      );
    })();
  assertGeneratedD1Source(loaded.source, expectedDescriptor);
  const moduleUrl = pathToFileURL(path.join(loaded.root, "generated.mjs"));
  moduleUrl.searchParams.set("sha256", loaded.manifest.sourceHash);
  const generated = await import(moduleUrl.href);
  const exports = Object.keys(generated).sort();
  if (
    JSON.stringify(exports) !==
    JSON.stringify(["D1_INTERFACE_VERSION", "createRuntime", "descriptor"])
  ) {
    throw new TypeError("Generated D1 module exports are outside the interface.");
  }
  if (
    generated.descriptor.artifactId !== loaded.manifest.artifactId ||
    generated.descriptor.contractVersion !==
      loaded.manifest.versions.contract ||
    generated.descriptor.scriptVersion !== loaded.manifest.versions.script
  ) {
    throw new TypeError("Generated D1 descriptor does not match its manifest.");
  }
  return {
    manifest: loaded.manifest,
    contract: loaded.contract,
    descriptor: generated.descriptor,
    createRuntime: generated.createRuntime,
    root: loaded.root,
  };
}
