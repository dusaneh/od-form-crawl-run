import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crawlTargetsWithPlaywright } from "../local/playwright-crawler.mjs";
import { startFixtureServer } from "./server.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserMode =
  process.argv.includes("--headed") || process.argv.includes("--headful")
    ? "headful"
    : "headless";
const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const outputRoot = path.join(projectRoot, "data", "harness", stamp);
const runId = `run_harness_${Date.now().toString(36)}`;
const fixture = await startFixtureServer();

try {
  console.log(`Fixture site: ${fixture.origin}/fixtures/start`);
  console.log(`Browser mode: ${browserMode}`);
  console.log(`Harness output: ${outputRoot}`);
  const events = [];
  const output = await crawlTargetsWithPlaywright(
    [`${fixture.origin}/fixtures/start`],
    runId,
    {
      browserMode,
      allowLoopback: true,
      onProgress: ({ pages, queued }) =>
        console.log(`Rendered ${pages} page${pages === 1 ? "" : "s"}; ${queued} queued.`),
      onBrowserEvent: (kind, message, metadata = {}) => {
        const event = {
          timestamp: new Date().toISOString(),
          runId,
          kind,
          message,
          metadata,
        };
        events.push(event);
        console.log(`${kind}: ${message}`);
      },
    }
  );

  await Promise.all([
    mkdir(path.join(outputRoot, "pages"), { recursive: true }),
    mkdir(path.join(outputRoot, "evidence"), { recursive: true }),
  ]);

  const reportPages = [];
  for (let index = 0; index < output.pages.length; index += 1) {
    const page = output.pages[index];
    const number = String(index + 1).padStart(2, "0");
    const htmlArtifact = page.html
      ? path.join(outputRoot, "pages", `page_${number}.html`)
      : undefined;
    const screenshotArtifact = page.screenshot
      ? path.join(outputRoot, "evidence", `page_${number}.png`)
      : undefined;
    if (htmlArtifact) await writeFile(htmlArtifact, page.html, "utf8");
    if (screenshotArtifact) await writeFile(screenshotArtifact, page.screenshot);
    const { html, screenshot, ...serializablePage } = page;
    void html;
    void screenshot;
    reportPages.push({ ...serializablePage, htmlArtifact, screenshotArtifact });
  }

  const report = {
    id: runId,
    generatedAt: new Date().toISOString(),
    targets: [`${fixture.origin}/fixtures/start`],
    browserMode,
    renderEngine: "playwright-chromium",
    pages: reportPages,
    nodes: output.nodes,
    edges: output.edges,
    contract: output.contract,
    findings: output.findings,
    fixtureRequests: fixture.requests,
  };
  await Promise.all([
    writeFile(
      path.join(outputRoot, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    ),
    writeFile(
      path.join(outputRoot, "events.jsonl"),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8"
    ),
  ]);

  const visibleFields = output.contract.filter((field) => !field.hidden);
  const blockedWrites = output.pages.reduce(
    (sum, page) => sum + (page.blockedWriteRequests || 0),
    0
  );
  const nonReadRequests = fixture.requests.filter(
    (request) => !["GET", "HEAD", "OPTIONS"].includes(request.method)
  );
  const unexpectedWrites = nonReadRequests.filter(
    (request) => !(request.method === "POST" && request.path === "/fixtures/aura")
  );
  console.log("");
  console.log("Harness result");
  console.log(`  Pages rendered: ${output.pages.filter((page) => !page.error).length}/${output.pages.length}`);
  console.log(`  Visible fields: ${visibleFields.length}`);
  console.log(`  Screenshots: ${output.pages.filter((page) => page.screenshot).length}`);
  console.log(`  Browser write requests blocked: ${blockedWrites}`);
  console.log(`  Read-like initialization requests allowed: ${nonReadRequests.length - unexpectedWrites.length}`);
  console.log(`  Unexpected write requests reaching fixture server: ${unexpectedWrites.length}`);
  console.log(`  Report: ${path.join(outputRoot, "report.json")}`);

  if (
    output.pages.some((page) => page.error) ||
    !visibleFields.length ||
    output.pages.some((page) => !page.screenshot) ||
    unexpectedWrites.length
  ) {
    process.exitCode = 1;
  }
} finally {
  await fixture.close();
}
