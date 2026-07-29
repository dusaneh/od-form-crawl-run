import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  validateGeneratedScriptManifest,
  validateSemanticContract,
} from "./runtime-schemas.mjs";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

async function renameWithWindowsRetry(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (TRANSIENT_RENAME_CODES.has(error?.code)) {
        try {
          await stat(destination);
          const exists = new Error(`Destination already exists: ${destination}`);
          exists.code = "EEXIST";
          throw exists;
        } catch (destinationError) {
          if (destinationError?.code !== "ENOENT") {
            throw destinationError;
          }
        }
      }
      if (!TRANSIENT_RENAME_CODES.has(error?.code) || attempt >= 7) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1_000, 50 * 2 ** attempt))
      );
    }
  }
}

export class ImmutableArtifactError extends Error {
  constructor(message, code = "IMMUTABLE_ARTIFACT_ERROR") {
    super(message);
    this.name = "ImmutableArtifactError";
    this.code = code;
  }
}

function safeSegment(value, label) {
  if (typeof value !== "string" || !SAFE_SEGMENT.test(value)) {
    throw new ImmutableArtifactError(
      `${label} must be a safe filesystem segment.`,
      "INVALID_ARTIFACT_ID"
    );
  }
  return value;
}

function positiveVersion(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new ImmutableArtifactError(
      `${label} must be a positive integer.`,
      "INVALID_VERSION"
    );
  }
  return String(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashJson(value) {
  return sha256(stableJson(value));
}

function artifactVersionRoot(dataRoot, artifactId, artifactVersion) {
  return path.join(
    path.resolve(dataRoot),
    "artifacts",
    safeSegment(artifactId, "artifactId"),
    "versions",
    positiveVersion(artifactVersion, "artifactVersion")
  );
}

function scriptVersionRoot(
  dataRoot,
  artifactId,
  artifactVersion,
  scriptVersion
) {
  return path.join(
    artifactVersionRoot(dataRoot, artifactId, artifactVersion),
    "scripts",
    positiveVersion(scriptVersion, "scriptVersion")
  );
}

async function writeExclusive(filePath, contents) {
  await writeFile(filePath, contents, { encoding: "utf8", flag: "wx" });
}

async function createStagedDirectory(parent, finalName, write) {
  await mkdir(parent, { recursive: true });
  const finalPath = path.join(parent, finalName);
  const stagePath = path.join(
    parent,
    `.pending-${finalName}-${randomUUID()}`
  );
  await mkdir(stagePath, { recursive: false });
  try {
    await write(stagePath);
    try {
      await renameWithWindowsRetry(stagePath, finalPath);
    } catch (error) {
      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
        throw new ImmutableArtifactError(
          `Immutable path already exists: ${finalPath}`,
          "IMMUTABLE_PATH_EXISTS"
        );
      }
      throw error;
    }
  } catch (error) {
    await rm(stagePath, { recursive: true, force: true });
    throw error;
  }
  return finalPath;
}

function validateFingerprintRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ImmutableArtifactError(
      "fingerprint must be an object.",
      "INVALID_FINGERPRINT_RECORD"
    );
  }
  if (
    typeof value.algorithmVersion !== "string" ||
    value.algorithmVersion.trim() === ""
  ) {
    throw new ImmutableArtifactError(
      "fingerprint.algorithmVersion is required.",
      "INVALID_FINGERPRINT_RECORD"
    );
  }
  if (
    typeof value.digest !== "string" ||
    !/^[a-f0-9]{16,128}$/i.test(value.digest)
  ) {
    throw new ImmutableArtifactError(
      "fingerprint.digest must be the versioned fingerprint module's hexadecimal digest.",
      "INVALID_FINGERPRINT_RECORD"
    );
  }
}

export async function createArtifactVersion({
  dataRoot,
  artifactId,
  artifactVersion,
  contract,
  fingerprint,
}) {
  validateSemanticContract(contract);
  validateFingerprintRecord(fingerprint);
  safeSegment(artifactId, "artifactId");
  positiveVersion(artifactVersion, "artifactVersion");
  if (
    contract.artifactId !== artifactId ||
    contract.artifactVersion !== artifactVersion
  ) {
    throw new ImmutableArtifactError(
      "Contract identity does not match the requested artifact path.",
      "ARTIFACT_IDENTITY_MISMATCH"
    );
  }

  const finalPath = artifactVersionRoot(
    dataRoot,
    artifactId,
    artifactVersion
  );
  const parent = path.dirname(finalPath);
  const versionName = path.basename(finalPath);
  const createdPath = await createStagedDirectory(
    parent,
    versionName,
    async (stagePath) => {
      await writeExclusive(
        path.join(stagePath, "contract.json"),
        stableJson(contract)
      );
      await writeExclusive(
        path.join(stagePath, "fingerprint.json"),
        stableJson(fingerprint)
      );
      await mkdir(path.join(stagePath, "scripts"), { recursive: false });
    }
  );
  return {
    artifactId,
    artifactVersion,
    contractHash: hashJson(contract),
    path: createdPath,
  };
}

export async function writeGeneratedScriptVersion({
  dataRoot,
  artifactId,
  artifactVersion,
  scriptVersion,
  manifest,
  source,
  generationInput,
}) {
  if (typeof source !== "string" || source.trim() === "") {
    throw new ImmutableArtifactError(
      "Generated source must be a non-empty string.",
      "INVALID_GENERATED_SOURCE"
    );
  }
  if (
    !generationInput ||
    typeof generationInput !== "object" ||
    Array.isArray(generationInput)
  ) {
    throw new ImmutableArtifactError(
      "generationInput must be an object.",
      "INVALID_GENERATION_INPUT"
    );
  }
  validateGeneratedScriptManifest(manifest);
  safeSegment(artifactId, "artifactId");
  positiveVersion(artifactVersion, "artifactVersion");
  positiveVersion(scriptVersion, "scriptVersion");
  if (
    manifest.artifactId !== artifactId ||
    manifest.versions.artifact !== artifactVersion ||
    manifest.versions.script !== scriptVersion
  ) {
    throw new ImmutableArtifactError(
      "Manifest identity does not match the requested script path.",
      "SCRIPT_IDENTITY_MISMATCH"
    );
  }
  const computedSourceHash = sha256(source);
  if (manifest.sourceHash !== computedSourceHash) {
    throw new ImmutableArtifactError(
      "Manifest source hash does not match generated source.",
      "SOURCE_HASH_MISMATCH"
    );
  }

  const artifactPath = artifactVersionRoot(
    dataRoot,
    artifactId,
    artifactVersion
  );
  let contract;
  try {
    contract = JSON.parse(
      await readFile(path.join(artifactPath, "contract.json"), "utf8")
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ImmutableArtifactError(
        "Artifact contract does not exist.",
        "ARTIFACT_CONTRACT_MISSING"
      );
    }
    throw error;
  }
  validateSemanticContract(contract);
  if (
    contract.contractVersion !== manifest.versions.contract ||
    hashJson(contract) !== manifest.contractHash
  ) {
    throw new ImmutableArtifactError(
      "Manifest contract linkage does not match stored contract.",
      "CONTRACT_HASH_MISMATCH"
    );
  }

  const finalPath = scriptVersionRoot(
    dataRoot,
    artifactId,
    artifactVersion,
    scriptVersion
  );
  const parent = path.dirname(finalPath);
  const versionName = path.basename(finalPath);
  const createdPath = await createStagedDirectory(
    parent,
    versionName,
    async (stagePath) => {
      await writeExclusive(
        path.join(stagePath, "manifest.json"),
        stableJson(manifest)
      );
      await writeExclusive(path.join(stagePath, "generated.mjs"), source);
      await writeExclusive(
        path.join(stagePath, "source.sha256"),
        `${computedSourceHash}\n`
      );
      await writeExclusive(
        path.join(stagePath, "generation-input.json"),
        stableJson(generationInput)
      );
      const validationPath = path.join(stagePath, "validation");
      await mkdir(validationPath, { recursive: false });
      await mkdir(path.join(validationPath, "evidence"), { recursive: false });
    }
  );
  return {
    artifactId,
    artifactVersion,
    scriptVersion,
    sourceHash: computedSourceHash,
    path: createdPath,
  };
}

export async function loadGeneratedScriptVersion({
  dataRoot,
  artifactId,
  artifactVersion,
  scriptVersion,
}) {
  const root = scriptVersionRoot(
    dataRoot,
    artifactId,
    artifactVersion,
    scriptVersion
  );
  let manifest;
  let source;
  let storedHash;
  let contract;
  let generationInput;
  try {
    [manifest, source, storedHash, contract, generationInput] = await Promise.all([
      readFile(path.join(root, "manifest.json"), "utf8").then(JSON.parse),
      readFile(path.join(root, "generated.mjs"), "utf8"),
      readFile(path.join(root, "source.sha256"), "utf8").then((value) =>
        value.trim()
      ),
      readFile(
        path.join(
          artifactVersionRoot(dataRoot, artifactId, artifactVersion),
          "contract.json"
        ),
        "utf8"
      ).then(JSON.parse),
      readFile(path.join(root, "generation-input.json"), "utf8").then(JSON.parse),
    ]);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ImmutableArtifactError(
        "Generated script version is incomplete or unavailable.",
        "GENERATED_SCRIPT_UNAVAILABLE"
      );
    }
    throw error;
  }

  validateGeneratedScriptManifest(manifest);
  validateSemanticContract(contract);
  const computedSourceHash = sha256(source);
  if (
    storedHash !== computedSourceHash ||
    manifest.sourceHash !== computedSourceHash
  ) {
    throw new ImmutableArtifactError(
      "Generated script source hash mismatch.",
      "SOURCE_HASH_MISMATCH"
    );
  }
  if (
    manifest.artifactId !== artifactId ||
    manifest.versions.artifact !== artifactVersion ||
    manifest.versions.script !== scriptVersion
  ) {
    throw new ImmutableArtifactError(
      "Generated script manifest path mismatch.",
      "SCRIPT_IDENTITY_MISMATCH"
    );
  }
  if (
    manifest.versions.contract !== contract.contractVersion ||
    manifest.contractHash !== hashJson(contract)
  ) {
    throw new ImmutableArtifactError(
      "Generated script contract linkage mismatch.",
      "CONTRACT_HASH_MISMATCH"
    );
  }
  return {
    manifest,
    source,
    contract,
    generationInput,
    root,
  };
}

export function generatedArtifactPaths({
  dataRoot,
  artifactId,
  artifactVersion,
  scriptVersion,
}) {
  const artifactPath = artifactVersionRoot(
    dataRoot,
    artifactId,
    artifactVersion
  );
  return Object.freeze({
    artifactPath,
    contractPath: path.join(artifactPath, "contract.json"),
    fingerprintPath: path.join(artifactPath, "fingerprint.json"),
    scriptPath: scriptVersion
      ? scriptVersionRoot(
          dataRoot,
          artifactId,
          artifactVersion,
          scriptVersion
        )
      : null,
  });
}
