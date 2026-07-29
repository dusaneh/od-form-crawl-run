import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crawlTargetsWithPlaywright } from "../local/playwright-crawler.mjs";

const targets = {
  united_way:
    "https://www.yourlocalunitedway.org/our-work/healthy-community/housing-navigation/",
  pge: "https://energyinsight.pge.com/carefera",
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserMode =
  process.argv.includes("--headed") || process.argv.includes("--headful")
    ? "headful"
    : "headless";
const requestedTarget = process.argv
  .find((argument) => argument.startsWith("--target="))
  ?.split("=")[1];
const selectedTargets =
  requestedTarget && targets[requestedTarget]
    ? [[requestedTarget, targets[requestedTarget]]]
    : Object.entries(targets);
const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const outputRoot = path.join(projectRoot, "data", "live-harness", stamp);

await mkdir(outputRoot, { recursive: true });

let failed = false;
for (const [targetName, targetUrl] of selectedTargets) {
  const runId = `run_live_${targetName}_${Date.now().toString(36)}`;
  const targetRoot = path.join(outputRoot, targetName);
  const evidenceRoot = path.join(targetRoot, "evidence");
  const pagesRoot = path.join(targetRoot, "pages");
  await Promise.all([
    mkdir(evidenceRoot, { recursive: true }),
    mkdir(pagesRoot, { recursive: true }),
  ]);
  const events = [];
  const output = await crawlTargetsWithPlaywright([targetUrl], runId, {
    browserMode,
    executionMode: "probe",
    discoverLinks: false,
    traversalSettings: {
      stableWindowMs: 900,
      maxStateWaitMs: 15_000,
      maxFormStates: 24,
      maxBranchOptionsPerControl: 2,
      exerciseBranches: true,
      enterTestValues: true,
      advanceFormSteps: true,
    },
    onBrowserEvent: (kind, message, metadata = {}) => {
      const event = {
        timestamp: new Date().toISOString(),
        runId,
        kind,
        message,
        metadata,
      };
      events.push(event);
      process.stdout.write(`[${targetName}] ${kind}: ${message}\n`);
    },
  });

  const serializablePages = [];
  for (const [pageIndex, page] of output.pages.entries()) {
    const pageNumber = String(pageIndex + 1).padStart(2, "0");
    const htmlArtifact = page.html
      ? path.join(pagesRoot, `page_${pageNumber}.html`)
      : "";
    const screenshotArtifact = page.screenshot
      ? path.join(evidenceRoot, `page_${pageNumber}.png`)
      : "";
    if (htmlArtifact) await writeFile(htmlArtifact, page.html, "utf8");
    if (screenshotArtifact) await writeFile(screenshotArtifact, page.screenshot);
    const stateEvidence = [];
    for (const state of page.stateEvidence || []) {
      const stateArtifact = state.screenshot
        ? path.join(
            evidenceRoot,
            `page_${pageNumber}_${state.id}.png`
          )
        : "";
      if (stateArtifact) await writeFile(stateArtifact, state.screenshot);
      const {
        screenshot,
        sensingScreenshots,
        ...serializableState
      } = state;
      void screenshot;
      void sensingScreenshots;
      stateEvidence.push({
        ...serializableState,
        screenshotArtifact: stateArtifact,
      });
    }
    const {
      html,
      screenshot,
      sensingScreenshots,
      stateEvidence: rawStateEvidence,
      ...serializablePage
    } = page;
    void html;
    void screenshot;
    void sensingScreenshots;
    void rawStateEvidence;
    serializablePages.push({
      ...serializablePage,
      htmlArtifact,
      screenshotArtifact,
      stateEvidence,
    });
  }

  const report = {
    id: runId,
    generatedAt: new Date().toISOString(),
    targetName,
    targets: [targetUrl],
    browserMode,
    executionMode: "probe",
    pages: serializablePages,
    nodes: output.nodes,
    edges: output.edges,
    contract: output.contract,
    findings: output.findings,
  };
  await Promise.all([
    writeFile(
      path.join(targetRoot, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    ),
    writeFile(
      path.join(targetRoot, "events.jsonl"),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8"
    ),
  ]);

  const submissionsAttempted = output.pages.reduce(
    (sum, page) => sum + (page.submissionsAttempted || 0),
    0
  );
  const submissionsSucceeded = output.pages.reduce(
    (sum, page) => sum + (page.submissionsSucceeded || 0),
    0
  );
  const scriptMissing = output.pages.some(
    (page) => page.certificationStatus === "script_missing"
  );
  const terminalBlocked = output.pages.some(
    (page) => page.finalSubmission === "blocked"
  );
  const targetFailed =
    output.pages.some((page) => page.error) ||
    scriptMissing ||
    submissionsAttempted !== 0 ||
    submissionsSucceeded !== 0 ||
    !output.contract.some((field) => !field.hidden);
  failed ||= targetFailed;

  process.stdout.write(
    [
      "",
      `${targetName} result`,
      `  Script: ${output.pages[0]?.reconScriptId || "missing"}@${output.pages[0]?.reconScriptVersion || 0}`,
      `  Visible fields: ${output.contract.filter((field) => !field.hidden).length}`,
      `  States: ${output.pages.reduce((sum, page) => sum + (page.stateEvidence?.length || 0), 0)}`,
      `  Terminal boundary observed: ${terminalBlocked ? "yes" : "not reached"}`,
      `  Terminal submissions attempted: ${submissionsAttempted}`,
      `  Report: ${path.join(targetRoot, "report.json")}`,
      "",
    ].join("\n")
  );
}

if (failed) process.exitCode = 1;

