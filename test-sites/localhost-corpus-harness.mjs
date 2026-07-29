import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { crawlTargetsWithPlaywright } from "../local/playwright-crawler.mjs";
import {
  createCorpusReconScript,
  discoverCorpusOrigin,
  loadGroundTruthCorpus,
  scoreCorpusRun,
} from "./localhost-corpus.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedSites = new Set(
  process.argv
    .filter((argument) => argument.startsWith("--site="))
    .flatMap((argument) => argument.slice("--site=".length).split(","))
    .filter(Boolean)
);
const browserMode =
  process.argv.includes("--headed") || process.argv.includes("--headful")
    ? "headful"
    : "headless";
const origin =
  process.env.LOCALHOST_TEST_SITES_URL || (await discoverCorpusOrigin());
const allGroundTruth = await loadGroundTruthCorpus(undefined, origin);
const corpus = allGroundTruth.filter(
  (groundTruth) =>
    requestedSites.size === 0 || requestedSites.has(groundTruth.site_id)
);
const cases = corpus.map((groundTruth) => ({
  ...groundTruth,
  caseId: groundTruth.site_id,
}));
if (process.argv.includes("--extended")) {
  const challenge = allGroundTruth.find(
    (groundTruth) => groundTruth.site_id === "site_t_challenges"
  );
  const crossPage = allGroundTruth.find(
    (groundTruth) => groundTruth.site_id === "site_p_crosspage_echo"
  );
  if (challenge) {
    cases.push({
      ...challenge,
      caseId: "site_t_challenges_image",
      targetUrl: new URL("/site_t_challenges/intake_image", origin).toString(),
    });
  }
  if (crossPage) {
    cases.push({
      ...crossPage,
      caseId: "site_p_crosspage_echo_safe",
      targetUrl: new URL("/site_p_crosspage_echo/intake_safe", origin).toString(),
      expected_abort: null,
      expected_red_flag_codes: [],
    });
  }
}
const stamp = new Date()
  .toISOString()
  .replaceAll(":", "-")
  .replace(/\.\d{3}Z$/, "Z");
const outputRoot = path.join(projectRoot, "data", "localhost-corpus", stamp);
await mkdir(outputRoot, { recursive: true });

const summary = {
  generatedAt: new Date().toISOString(),
  origin,
  browserMode,
  executionMode: "fixture_submit",
  sites: [],
};

for (const groundTruth of cases) {
  const siteRoot = path.join(outputRoot, groundTruth.caseId);
  const pagesRoot = path.join(siteRoot, "pages");
  const evidenceRoot = path.join(siteRoot, "evidence");
  await Promise.all([
    mkdir(pagesRoot, { recursive: true }),
    mkdir(evidenceRoot, { recursive: true }),
  ]);
  const events = [];
  const runId = `run_corpus_${groundTruth.caseId}_${Date.now().toString(36)}`;
  const script = createCorpusReconScript(groundTruth);
  process.stdout.write(`\n[${groundTruth.caseId}] ${groundTruth.targetUrl}\n`);
  const output = await crawlTargetsWithPlaywright(
    [groundTruth.targetUrl],
    runId,
    {
      browserMode,
      executionMode: "fixture_submit",
      allowLoopback: true,
      discoverLinks: false,
      reconScriptResolver: (url, options) =>
        script.matches(url, options) ? script : null,
      traversalSettings: {
        stableWindowMs: 200,
        maxStateWaitMs: 2_500,
        maxFormStates: 18,
        maxBranchOptionsPerControl: 3,
        exerciseBranches: true,
        enterTestValues: true,
        advanceFormSteps: true,
      },
      onBrowserEvent: (kind, message, metadata = {}) => {
        events.push({
          timestamp: new Date().toISOString(),
          runId,
          kind,
          message,
          metadata,
        });
      },
    }
  );

  const reportPages = [];
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
      const artifact = state.screenshot
        ? path.join(
            evidenceRoot,
            `page_${pageNumber}_state_${String(state.sequence).padStart(2, "0")}.png`
          )
        : "";
      if (artifact) await writeFile(artifact, state.screenshot);
      const { screenshot, sensingScreenshots, ...serializableState } = state;
      void screenshot;
      void sensingScreenshots;
      stateEvidence.push({
        ...serializableState,
        screenshotArtifact: artifact,
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
    reportPages.push({
      ...serializablePage,
      htmlArtifact,
      screenshotArtifact,
      stateEvidence,
    });
  }

  const score = scoreCorpusRun(groundTruth, output);
  const report = {
    id: runId,
    generatedAt: new Date().toISOString(),
    targetName: groundTruth.caseId,
    targets: [groundTruth.targetUrl],
    browserMode,
    executionMode: "fixture_submit",
    groundTruthPath: groundTruth.sourcePath,
    score,
    pages: reportPages,
    nodes: output.nodes,
    edges: output.edges,
    contract: output.contract,
    findings: output.findings,
  };
  await Promise.all([
    writeFile(
      path.join(siteRoot, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    ),
    writeFile(
      path.join(siteRoot, "events.jsonl"),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8"
    ),
  ]);
  summary.sites.push({
    ...score,
    report: path.join(siteRoot, "report.json"),
  });
  process.stdout.write(
    `  ${score.passed ? "PASS" : "FAIL"} · fields ${score.observedFields}/${score.expectedFields} · branches ${score.branchStates} · submits ${score.submissionsSucceeded}/${score.submissionsAttempted}\n`
  );
}

summary.total = summary.sites.length;
summary.passed = summary.sites.filter((site) => site.passed).length;
summary.failed = summary.total - summary.passed;
await writeFile(
  path.join(outputRoot, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8"
);
process.stdout.write(
  `\nCorpus result: ${summary.passed}/${summary.total} passed\nSummary: ${path.join(outputRoot, "summary.json")}\n`
);
if (summary.failed) process.exitCode = 1;
