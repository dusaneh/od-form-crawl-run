import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { stableJson } from "../contracts/artifact-store.mjs";

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
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
        setTimeout(resolve, Math.min(1_000, 50 * 2 ** attempt)),
      );
    }
  }
}

function segment(value, name) {
  if (typeof value !== "string" || !SAFE.test(value)) {
    throw new TypeError(`${name} must be a safe path segment.`);
  }
  return value;
}

export async function writeSemanticGenerationRecord({
  dataRoot,
  runId,
  observation,
  screenshot,
  proposal,
  provenance,
  safety,
  events = [],
}) {
  const root = path.join(
    path.resolve(dataRoot),
    "semantic-generation",
    segment(runId, "runId"),
  );
  const parent = path.dirname(root);
  const stage = path.join(parent, `.pending-${path.basename(root)}-${randomUUID()}`);
  await mkdir(stage, { recursive: true });
  try {
    await Promise.all([
      writeFile(
        path.join(stage, "generation-input.json"),
        stableJson(observation),
        { encoding: "utf8", flag: "wx" },
      ),
      writeFile(path.join(stage, "sensing.png"), screenshot, { flag: "wx" }),
      writeFile(path.join(stage, "proposal.json"), stableJson(proposal), {
        encoding: "utf8",
        flag: "wx",
      }),
      writeFile(path.join(stage, "provenance.json"), stableJson(provenance), {
        encoding: "utf8",
        flag: "wx",
      }),
      writeFile(path.join(stage, "safety.json"), stableJson(safety), {
        encoding: "utf8",
        flag: "wx",
      }),
      writeFile(
        path.join(stage, "events.jsonl"),
        events.map((event) => JSON.stringify(event)).join("\n") +
          (events.length ? "\n" : ""),
        { encoding: "utf8", flag: "wx" },
      ),
    ]);
    await mkdir(parent, { recursive: true });
    await renameWithWindowsRetry(stage, root);
    return root;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    if (["EEXIST", "ENOTEMPTY"].includes(error?.code)) {
      throw new Error(`Semantic generation record is immutable: ${root}`);
    }
    throw error;
  }
}
