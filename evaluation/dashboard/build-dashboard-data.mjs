import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDashboardData } from "./data.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const argument = process.argv.indexOf("--output");
const output = argument >= 0 ? process.argv[argument + 1] : null;
const data = await buildDashboardData(projectRoot);

if (output) {
  const absolute = path.resolve(projectRoot, output);
  await writeFile(absolute, `${JSON.stringify(data, null, 2)}\n`);
  console.log(absolute);
} else {
  console.log(JSON.stringify(data.summary, null, 2));
}
