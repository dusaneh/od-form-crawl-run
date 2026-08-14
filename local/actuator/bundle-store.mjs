import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { stableJson } from "../contracts/artifact-store.mjs";
import {
  validateActuatorRepairDocument,
} from "../contracts/semantic-actuator-schemas.mjs";
import { assertActuatorBundle } from "./actuator-source.mjs";

function safeRoot(root) {
  if (!root) throw new TypeError("Actuator bundle store requires a root directory.");
  return path.resolve(root);
}

function destinationFor(root, bundle) {
  return path.join(
    safeRoot(root),
    "actuator-bundles",
    bundle.artifactId,
    `v${bundle.bundleVersion}`,
  );
}

function resolvedModulePath(bundleRoot, modulePath) {
  const resolved = path.resolve(bundleRoot, ...modulePath.split("/"));
  if (!resolved.startsWith(`${path.resolve(bundleRoot)}${path.sep}`)) {
    throw new TypeError(`Unsafe actuator module path: ${modulePath}.`);
  }
  return resolved;
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function publishStagedDirectory(stage, destination) {
  const retryableCodes = new Set(["EACCES", "EBUSY", "EPERM"]);
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      await rename(stage, destination);
      return;
    } catch (error) {
      // On Windows, rename can report EPERM for both a real immutable-version
      // collision and a transient scanner/watcher handle. Distinguish the two
      // before retrying so publication stays fail-closed and immutable.
      if (await pathExists(destination)) {
        const collision = new Error(
          `Actuator bundle version already exists: ${destination}.`,
        );
        collision.code = "IMMUTABLE_ACTUATOR_BUNDLE";
        throw collision;
      }
      if (!retryableCodes.has(error?.code) || attempt === 6) throw error;
      await delay(25 * 2 ** attempt);
    }
  }
}

export async function writeActuatorBundle({ root, bundle, semanticProposal }) {
  const checked = assertActuatorBundle({ bundle, semanticProposal });
  const destination = destinationFor(root, bundle);
  const parent = path.dirname(destination);
  // Directory rename is not reliable on Windows when a scanner briefly opens
  // one of the freshly written module files. Claim the immutable version path
  // with exclusive mkdir there; repository publication still occurs only after
  // every file is written and verified. POSIX keeps atomic staged publication.
  const directPublish = process.platform === "win32";
  const stage = directPublish
    ? destination
    : path.join(parent, `.pending-${path.basename(destination)}-${randomUUID()}`);
  let stageCreated = false;
  await mkdir(parent, { recursive: true });
  try {
    await mkdir(stage, { recursive: false });
    stageCreated = true;
    await writeFile(path.join(stage, "bundle.json"), stableJson(bundle), {
      encoding: "utf8",
      flag: "wx",
    });
    await writeFile(path.join(stage, "bundle.sha256"), `${checked.bundleHash}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await writeFile(
      path.join(stage, "semantic-proposal.json"),
      stableJson(semanticProposal),
      { encoding: "utf8", flag: "wx" },
    );
    for (const actuatorModule of bundle.modules) {
      const modulePath = resolvedModulePath(stage, actuatorModule.modulePath);
      await mkdir(path.dirname(modulePath), { recursive: true });
      await writeFile(modulePath, actuatorModule.source, {
        encoding: "utf8",
        flag: "wx",
      });
    }
    if (!directPublish) await publishStagedDirectory(stage, destination);
  } catch (error) {
    if (stageCreated) await rm(stage, { recursive: true, force: true });
    if (error?.code === "IMMUTABLE_ACTUATOR_BUNDLE") throw error;
    if (["EEXIST", "ENOTEMPTY"].includes(error?.code)) {
      const immutable = new Error(`Actuator bundle version already exists: ${destination}.`);
      immutable.code = "IMMUTABLE_ACTUATOR_BUNDLE";
      throw immutable;
    }
    throw error;
  }
  return {
    bundleId: bundle.bundleId,
    artifactId: bundle.artifactId,
    bundleVersion: bundle.bundleVersion,
    bundleHash: checked.bundleHash,
    path: destination,
  };
}

export async function loadActuatorBundle({
  root,
  artifactId,
  bundleVersion,
}) {
  const bundleRoot = path.join(
    safeRoot(root),
    "actuator-bundles",
    artifactId,
    `v${bundleVersion}`,
  );
  const [bundle, semanticProposal, expectedHash] = await Promise.all([
    readFile(path.join(bundleRoot, "bundle.json"), "utf8").then(JSON.parse),
    readFile(path.join(bundleRoot, "semantic-proposal.json"), "utf8").then(JSON.parse),
    readFile(path.join(bundleRoot, "bundle.sha256"), "utf8").then((value) => value.trim()),
  ]);
  for (const actuatorModule of bundle.modules) {
    actuatorModule.source = await readFile(
      resolvedModulePath(bundleRoot, actuatorModule.modulePath),
      "utf8",
    );
  }
  const checked = assertActuatorBundle({ bundle, semanticProposal });
  if (checked.bundleHash !== expectedHash) {
    throw new Error("Stored actuator bundle failed its aggregate hash check.");
  }

  const loaded = await loadActuatorBundleInMemory({
    bundle,
    semanticProposal,
  });
  return {
    ...loaded,
    path: bundleRoot,
  };
}

export async function loadActuatorBundleInMemory({ bundle, semanticProposal }) {
  const checked = assertActuatorBundle({ bundle, semanticProposal });
  const modules = new Map(
    bundle.modules.map((actuatorModule) => [
      actuatorModule.modulePath,
      actuatorModule,
    ]),
  );
  const urls = new Map();

  const moduleUrl = (modulePath, stack = []) => {
    if (urls.has(modulePath)) return urls.get(modulePath);
    if (stack.includes(modulePath)) {
      throw new TypeError(
        `Actuator bundle contains an import cycle: ${[...stack, modulePath].join(" -> ")}.`,
      );
    }
    const actuatorModule = modules.get(modulePath);
    if (!actuatorModule) throw new TypeError(`Unknown actuator module ${modulePath}.`);
    const inspection = checked.inspections.get(modulePath);
    let source = actuatorModule.source;
    for (const importedPath of inspection.imports) {
      const relative = path.posix.relative(
        path.posix.dirname(modulePath),
        importedPath,
      );
      const specifier = relative.startsWith(".") ? relative : `./${relative}`;
      const importedUrl = moduleUrl(importedPath, [...stack, modulePath]);
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      source = source.replace(
        new RegExp(`(from\\s+["'])${escaped}(["'])`, "g"),
        `$1${importedUrl}$2`,
      );
    }
    const url = `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}#sha256=${actuatorModule.sourceHash}`;
    urls.set(modulePath, url);
    return url;
  };

  const imported = new Map();
  const handlers = new Map();
  for (const descriptor of bundle.handlers) {
    let generated = imported.get(descriptor.modulePath);
    if (!generated) {
      generated = await import(moduleUrl(descriptor.modulePath));
      imported.set(descriptor.modulePath, generated);
    }
    const handler = generated[descriptor.exportName];
    if (typeof handler !== "function") {
      throw new TypeError(
        `In-memory actuator handler ${descriptor.handlerId} export is unavailable.`,
      );
    }
    handlers.set(descriptor.handlerId, handler);
  }
  return {
    bundle,
    semanticProposal,
    bundleHash: checked.bundleHash,
    handlers,
  };
}

export function applyActuatorRepair({
  bundle,
  semanticProposal,
  repair,
  nextBundleId,
  nextBundleVersion = bundle.bundleVersion + 1,
}) {
  validateActuatorRepairDocument(repair);
  const current = assertActuatorBundle({ bundle, semanticProposal });
  if (repair.baseBundleHash !== current.bundleHash) {
    const error = new Error("Actuator repair base hash does not match the supplied bundle.");
    error.code = "ACTUATOR_REPAIR_BASE_MISMATCH";
    throw error;
  }
  const candidate = structuredClone(bundle);
  candidate.bundleId = nextBundleId;
  candidate.bundleVersion = nextBundleVersion;
  const modules = new Map(
    candidate.modules.map((actuatorModule) => [
      actuatorModule.modulePath,
      actuatorModule,
    ]),
  );
  const handlerMap = new Map(candidate.handlers.map((handler) => [handler.handlerId, handler]));
  const replacedHandlers = new Set();

  for (const replacement of repair.replacements) {
    const actuatorModule = modules.get(replacement.modulePath);
    if (!actuatorModule) {
      throw new TypeError(
        `Actuator repair names unknown module ${replacement.modulePath}.`,
      );
    }
    actuatorModule.source = replacement.source;
    actuatorModule.sourceHash = replacement.sourceHash;
    for (const handlerId of replacement.handlerIds) {
      const handler = handlerMap.get(handlerId);
      if (!handler || handler.modulePath !== replacement.modulePath) {
        throw new TypeError(
          `Actuator repair handler ${handlerId} is not owned by ${replacement.modulePath}.`,
        );
      }
      handler.capabilities = [...replacement.capabilities];
      replacedHandlers.add(handlerId);
    }
  }
  const checked = assertActuatorBundle({ bundle: candidate, semanticProposal });
  return {
    bundle: candidate,
    bundleHash: checked.bundleHash,
    parentBundleHash: current.bundleHash,
    replacedHandlerIds: [...replacedHandlers].sort(),
    repairId: repair.repairId,
  };
}
