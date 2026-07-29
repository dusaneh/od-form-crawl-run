import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { PhysicsToolbox } from "../executor/physics-toolbox.mjs";
import { captureNovelStateInput } from "./novel-state-input.mjs";
import { generateSemanticProposal } from "./semantic-generator.mjs";
import { validateProposalSafety } from "./proposal-safety.mjs";
import { writeSemanticGenerationRecord } from "./semantic-record-store.mjs";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function safeId(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100);
}

function rank(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function discoverFormBearingPage(page, toolbox, target) {
  const targetUrl = new URL(target);
  const prefix = targetUrl.pathname.endsWith("/")
    ? targetUrl.pathname
    : `${targetUrl.pathname}/`;
  const queue = [targetUrl.toString()];
  const visited = new Set();
  const candidates = [];
  while (queue.length > 0 && visited.size < 8) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    await page.goto(current, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await toolbox.prepare();
    const visibleControls = await page
      .locator(
        'input:visible:not([type="hidden"]):not([type="button"]):not([type="submit"]), select:visible, textarea:visible',
      )
      .count();
    candidates.push({ url: page.url(), visibleControls });
    const links = await page.locator("a[href]").evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.href),
    );
    for (const link of [...new Set(links)].sort((left, right) =>
      rank(left).localeCompare(rank(right)),
    )) {
      const parsed = new URL(link);
      if (
        parsed.origin === targetUrl.origin &&
        parsed.pathname.startsWith(prefix) &&
        !visited.has(parsed.toString())
      ) {
        queue.push(parsed.toString());
      }
    }
  }
  const selected = [...candidates].sort(
    (left, right) =>
      right.visibleControls - left.visibleControls ||
      rank(left.url).localeCompare(rank(right.url)),
  )[0];
  if (!selected || selected.visibleControls === 0) {
    throw new Error("No form-bearing page was found by live read-only discovery.");
  }
  await page.goto(selected.url, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await toolbox.prepare();
  return { selectedUrl: page.url(), candidates };
}

async function assertAnswerKeyUnreadable() {
  const probe = process.env.FORMWEAVE_ANSWER_KEY_PROBE;
  if (!probe) throw new Error("The answer-key isolation probe was not configured.");
  try {
    await readFile(probe, "utf8");
  } catch (error) {
    if (error?.code === "ERR_ACCESS_DENIED") {
      return { passed: true, code: error.code };
    }
    throw new Error(
      `Answer-key probe did not prove permission isolation (${error?.code || "unknown"}).`,
    );
  }
  throw new Error("Answer-key isolation failed: the generation worker read the probe.");
}

const origin = new URL(argument("--origin", "http://127.0.0.1:9001/"));
const count = Math.max(2, Math.min(Number.parseInt(argument("--count", "3"), 10), 5));
const dataRoot = path.resolve(argument("--output"));
const isolation = await assertAnswerKeyUnreadable();
const browser = await chromium.launch({ headless: true });
const indexPage = await browser.newPage();
const results = [];

try {
  await indexPage.goto(origin.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const hrefs = await indexPage
    .locator("a[href]")
    .evaluateAll((anchors, base) =>
      anchors
        .map((anchor) => new URL(anchor.getAttribute("href"), base).toString())
        .filter((url) => new URL(url).origin === new URL(base).origin)
        .filter((url) => !new URL(url).pathname.endsWith("/registry")),
      origin.toString(),
    );
  const targets = [...new Set(hrefs)]
    .sort((left, right) => rank(left).localeCompare(rank(right)))
    .slice(0, count);
  if (targets.length < count) {
    throw new Error(`Only ${targets.length} live localhost targets were discoverable.`);
  }

  for (const [index, target] of targets.entries()) {
    const page = await browser.newPage({
      locale: "en-US",
      viewport: { width: 1440, height: 1100 },
    });
    const events = [];
    const log = async (kind, detail) => {
      events.push({
        at: new Date().toISOString(),
        kind,
        detail,
      });
    };
    try {
      const toolbox = new PhysicsToolbox(page);
      await toolbox.installRequestGuard();
      const discovery = await discoverFormBearingPage(page, toolbox, target);
      await log("live_page_discovery_completed", discovery);
      const captured = await captureNovelStateInput({
        page,
        toolbox,
        existingContract: null,
        priorStates: [],
      });
      const generated = await generateSemanticProposal(captured, { log });
      const safety = validateProposalSafety({
        proposal: generated.proposal,
        observation: captured.observation,
      });
      const runId = `gate2_${String(index + 1).padStart(2, "0")}_${safeId(
        new URL(target).pathname,
      )}`;
      const recordPath = await writeSemanticGenerationRecord({
        dataRoot,
        runId,
        observation: captured.observation,
        screenshot: captured.screenshot,
        proposal: generated.proposal,
        provenance: generated.provenance,
        safety,
        events,
      });
      results.push({
        runId,
        target,
        selectedUrl: discovery.selectedUrl,
        discoveryCandidates: discovery.candidates,
        recordPath,
        proposalId: generated.proposal.proposalId,
        stateKey: generated.proposal.state.key,
        fields: generated.proposal.fields.length,
        sections: generated.proposal.sections.length,
        guidance: generated.proposal.guidance.length,
        actionsProposed: generated.proposal.proposedActions.length,
        actionsAccepted: safety.acceptedActions.length,
        actionsRejected: safety.rejections.length,
        rejectionCodes: [...new Set(safety.rejections.map((item) => item.code))].sort(),
      });
    } catch (error) {
      results.push({
        target,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await page.close();
    }
  }
} finally {
  await indexPage.close();
  await browser.close();
}

const summary = {
  schemaVersion: 1,
  kind: "gate2_localhost_generation_unscored",
  generatedAt: new Date().toISOString(),
  origin: origin.toString(),
  answerKeyIsolation: isolation,
  selectionMethod: "same-origin live index links ranked by SHA-256 URL; no registry or filesystem metadata",
  targetsRequested: count,
  targetsCompleted: results.filter((result) => !result.error).length,
  targetsFailed: results.filter((result) => result.error).length,
  results,
  scored: false,
};
await writeFile(
  path.join(dataRoot, "generation-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(summary));
if (summary.targetsFailed > 0) process.exitCode = 1;
