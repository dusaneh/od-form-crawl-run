import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256, stableJson, writeJson } from "./core.mjs";

async function events(historyRoot) {
  const filePath = path.join(historyRoot, "events.jsonl");
  const text = await readFile(filePath, "utf8").catch(() => "");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid registry event at line ${index + 1}: ${error.message}`);
      }
    });
}
export async function appendRegistryEvent(historyRoot, event) {
  await mkdir(historyRoot, { recursive: true });
  const complete = {
    schemaVersion: 1,
    eventId: `evt_${sha256(stableJson({ ...event, recordedAt: new Date().toISOString() })).slice(0, 20)}`,
    recordedAt: new Date().toISOString(),
    ...event,
  };
  await appendFile(
    path.join(historyRoot, "events.jsonl"),
    `${JSON.stringify(complete)}\n`,
    "utf8",
  );
  await rebuildRegistry(historyRoot);
  return complete;
}

function reduceRuns(registryEvents) {
  const runs = new Map();
  for (const event of registryEvents) {
    if (!event.experimentId) continue;
    const current = runs.get(event.experimentId) || { experimentId: event.experimentId };
    if (event.type === "experiment_completed") {
      Object.assign(current, {
        completedAt: event.recordedAt,
        candidate: event.candidate,
        configurationId: event.configurationId,
        planId: event.planId,
        catalogRevision: event.catalogRevision,
        sourceFingerprint: event.sourceFingerprint,
        model: event.model,
        outputRoot: event.outputRoot,
        batches: event.batches,
        trials: event.trials,
        overallScore: event.overallScore,
        status: event.status,
        strictPassRate: event.strictPassRate,
        safetyPassRate: event.safetyPassRate,
        invalidTrials: event.invalidTrials,
        categoryScores: event.categoryScores,
        qualitativeStatus: "draft",
      });
    } else if (event.type === "analysis_completed") {
      current.qualitativeStatus = "complete";
      current.analysisPath = event.analysisPath;
      current.analysisSummary = event.summary;
    } else if (event.type === "comparison_recorded") {
      current.comparisons ||= [];
      current.comparisons.push({
        baselineExperimentId: event.baselineExperimentId,
        scoreDelta: event.scoreDelta,
        decision: event.decision,
        comparisonPath: event.comparisonPath,
      });
    }
    runs.set(event.experimentId, current);
  }
  return [...runs.values()]
    .filter((run) => run.completedAt)
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
}

function convergenceSeries(runs) {
  const grouped = new Map();
  for (const run of runs) {
    if (!grouped.has(run.configurationId)) grouped.set(run.configurationId, []);
    grouped.get(run.configurationId).push(run);
  }
  return [...grouped.entries()].map(([configurationId, values]) => ({
    configurationId,
    points: values.map((run, index) => ({
      index: index + 1,
      experimentId: run.experimentId,
      completedAt: run.completedAt,
      candidate: run.candidate,
      sourceFingerprint: run.sourceFingerprint?.sha256 || null,
      overallScore: run.overallScore,
      strictPassRate: run.strictPassRate,
      safetyPassRate: run.safetyPassRate,
      status: run.status,
    })),
  }));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function convergenceSvg(series) {
  const width = 1000;
  const height = 520;
  const margin = { left: 70, right: 30, top: 50, bottom: 90 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const colors = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c"];
  const maxPoints = Math.max(2, ...series.map((item) => item.points.length));
  const x = (index) => margin.left + ((index - 1) / (maxPoints - 1)) * plotWidth;
  const y = (score) => margin.top + (1 - Number(score || 0) / 100) * plotHeight;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="white"/>',
    '<text x="70" y="30" font-family="sans-serif" font-size="20" font-weight="700">FormWeave evaluation convergence</text>',
  ];
  for (let score = 0; score <= 100; score += 20) {
    const py = y(score);
    lines.push(
      `<line x1="${margin.left}" y1="${py}" x2="${width - margin.right}" y2="${py}" stroke="#e5e7eb"/>`,
      `<text x="${margin.left - 12}" y="${py + 4}" text-anchor="end" font-family="sans-serif" font-size="12" fill="#4b5563">${score}</text>`,
    );
  }
  lines.push(
    `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#111827"/>`,
    `<line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#111827"/>`,
  );
  series.forEach((item, seriesIndex) => {
    const color = colors[seriesIndex % colors.length];
    const points = item.points.map((point) => `${x(point.index)},${y(point.overallScore)}`).join(" ");
    if (item.points.length > 1) {
      lines.push(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3"/>`);
    }
    item.points.forEach((point) => {
      lines.push(
        `<circle cx="${x(point.index)}" cy="${y(point.overallScore)}" r="5" fill="${color}"><title>${escapeXml(`${point.candidate}: ${Number(point.overallScore).toFixed(1)}`)}</title></circle>`,
        `<text x="${x(point.index)}" y="${height - margin.bottom + 22}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#374151">${point.index}</text>`,
      );
    });
    lines.push(
      `<rect x="${margin.left + seriesIndex * 260}" y="${height - 38}" width="14" height="4" fill="${color}"/>`,
      `<text x="${margin.left + 20 + seriesIndex * 260}" y="${height - 32}" font-family="sans-serif" font-size="12" fill="#374151">${escapeXml(item.configurationId)}</text>`,
    );
  });
  lines.push(
    `<text x="${width / 2}" y="${height - margin.bottom + 48}" text-anchor="middle" font-family="sans-serif" font-size="12">Comparable experiment sequence</text>`,
    `<text x="18" y="${height / 2}" transform="rotate(-90 18 ${height / 2})" text-anchor="middle" font-family="sans-serif" font-size="12">Overall score (0–100)</text>`,
    "</svg>",
  );
  return `${lines.join("\n")}\n`;
}

export async function rebuildRegistry(historyRoot) {
  await mkdir(historyRoot, { recursive: true });
  const registryEvents = await events(historyRoot);
  const runs = reduceRuns(registryEvents);
  const convergence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    series: convergenceSeries(runs),
  };
  await Promise.all([
    writeJson(path.join(historyRoot, "runs.json"), {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runs,
    }),
    writeJson(path.join(historyRoot, "convergence.json"), convergence),
    writeFile(
      path.join(historyRoot, "convergence.svg"),
      convergenceSvg(convergence.series),
      "utf8",
    ),
  ]);
  return { events: registryEvents.length, runs, convergence };
}
