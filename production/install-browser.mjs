import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cli = path.join(
  projectRoot,
  "node_modules",
  "playwright",
  "cli.js",
);
const child = spawn(process.execPath, [cli, "install", "chromium"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: "0",
  },
  stdio: "inherit",
  shell: false,
});
child.on("exit", (code) => process.exit(code || 0));
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
