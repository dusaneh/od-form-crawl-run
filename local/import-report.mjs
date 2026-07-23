import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCrawlOutput } from "../worker/crawler.ts";

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("Usage: node local/import-report.mjs <report.json>");
  process.exit(1);
}

const projectRoot = path.resolve(import.meta.dirname, "..");
const report = JSON.parse(await readFile(path.resolve(sourcePath), "utf8"));
if (!/^run_[a-z0-9]+$/i.test(report.id) || !Array.isArray(report.pages)) {
  throw new Error("The file is not a FormWeave crawl report.");
}

const directory = path.join(projectRoot, "data", "runs", report.id);
const output = buildCrawlOutput(report.pages, report.id);
const now = report.generatedAt || new Date().toISOString();
const artifacts = {
  runDirectory: directory,
  report: path.join(directory, "report.json"),
  events: path.join(directory, "events.jsonl"),
  pagesDirectory: path.join(directory, "pages"),
  evidenceDirectory: path.join(directory, "evidence"),
};
const findings = [
  ...(report.findings || output.findings),
  {
    id: `${report.id}_imported`,
    tone: "info",
    code: "report_imported",
    title: "Hosted report imported locally",
    detail:
      "The JSON findings are available locally. Screenshot binaries were not included in the downloaded report and cannot be reconstructed.",
    time: "now",
  },
];
const run = {
  id: report.id,
  name: `${new URL(report.targets[0]).hostname.replace(/^www\./, "")} imported crawl`,
  targetUrl: report.targets[0],
  urls: report.targets,
  status: "completed",
  stage: "Imported report",
  progress: 100,
  mode: "crawl",
  nodes: output.nodes.map((node) => ({
    ...node,
    evidence: "",
    evidenceAvailable: false,
  })),
  edges: output.edges,
  findings,
  contract: report.contract || output.contract,
  stats: report.stats,
  reportAvailable: true,
  analysisStatus: report.analysis?.status || "skipped",
  artifacts,
  synthetic: false,
  liveApproved: false,
  createdAt: report.stats?.startedAt || now,
  updatedAt: now,
};
const importedReport = {
  ...report,
  findings,
  artifacts,
  analysis: report.analysis || {
    status: "skipped",
    model: "",
    summary: "",
    pagePurpose: "",
    visibleForms: [],
    inferredFields: [],
    keyFindings: [],
    limitations: [
      "This was imported from a hosted JSON report; rerun it locally to add AI analysis and locally stored screenshot evidence.",
    ],
  },
};
const event = {
  timestamp: new Date().toISOString(),
  runId: report.id,
  kind: "report_imported",
  message: `Imported ${report.stats?.pagesFetched || report.pages.length} pages and ${report.stats?.fieldsFound || report.contract?.length || 0} visible fields from a downloaded report.`,
  metadata: { source: path.resolve(sourcePath) },
};

await Promise.all([
  mkdir(path.join(directory, "pages"), { recursive: true }),
  mkdir(path.join(directory, "evidence"), { recursive: true }),
]);
await Promise.all([
  writeFile(path.join(directory, "run.json"), `${JSON.stringify(run, null, 2)}\n`),
  writeFile(
    path.join(directory, "report.json"),
    `${JSON.stringify(importedReport, null, 2)}\n`
  ),
  writeFile(path.join(directory, "events.jsonl"), `${JSON.stringify(event)}\n`),
]);
console.log(
  JSON.stringify({
    imported: report.id,
    pages: report.stats?.pagesFetched || report.pages.length,
    visibleFields: report.stats?.fieldsFound || 0,
    directory,
  })
);
