import path from "node:path";

import { rebuildRegistry } from "./registry.mjs";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const historyRoot = path.resolve(
  argument(
    "--history-root",
    path.join(projectRoot, "data", "evaluation-experiments", "registry"),
  ),
);
const result = await rebuildRegistry(historyRoot);
console.log(
  JSON.stringify(
    {
      historyRoot,
      events: result.events,
      runs: result.runs.length,
      convergenceSeries: result.convergence.series.length,
    },
    null,
    2,
  ),
);
