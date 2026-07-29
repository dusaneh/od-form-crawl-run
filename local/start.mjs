import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vinextCli = path.join(projectRoot, "node_modules", "vinext", "dist", "cli.js");
const children = [];
let stopping = false;

function launch(label, command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    shell: false,
  });
  children.push(child);
  child.on("exit", (code) => {
    if (stopping) return;
    console.error(`${label} stopped with exit code ${code ?? "unknown"}.`);
    stop(code || 1);
  });
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(exitCode), 250).unref();
}

launch("Local API", process.execPath, ["local/server.mjs"], {
  ...process.env,
  // Forced-fresh generation is an audit-only switch. A normal interactive
  // restart must reuse validated scripts when compatible.
  FORMWEAVE_FORCE_FRESH_GENERATION: "0",
});
launch("Local web app", process.execPath, [
  vinextCli,
  "dev",
  "--hostname",
  "127.0.0.1",
  "--port",
  "3000",
]);

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
