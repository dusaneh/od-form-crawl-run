import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  approvedInputSchemaForPlan,
  loadApprovedFormScript,
} from "./production-generated-traversal.mjs";

function safeFormId(value) {
  if (!/^form_[a-z0-9]+$/i.test(String(value || ""))) {
    throw new Error("Invalid form id.");
  }
  return String(value);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function formDirectory(formsRoot, formId) {
  return path.join(formsRoot, safeFormId(formId));
}

export async function readFormRecord(formsRoot, formId, database = null) {
  let record;
  if (database) {
    record = await database.getForm(safeFormId(formId));
    if (!record) throw new Error("Form not found.");
  } else {
    record = await readJson(
      path.join(formDirectory(formsRoot, formId), "form.json"),
    );
  }
  try {
    const stored = await loadApprovedFormScript(record.script.path);
    return {
      ...record,
      inputSchema: approvedInputSchemaForPlan(stored.plan),
    };
  } catch {
    return record;
  }
}

export async function listFormRecords(formsRoot, database = null) {
  if (database) return database.listForms();
  const entries = await readdir(formsRoot, { withFileTypes: true }).catch(
    () => [],
  );
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^form_/i.test(entry.name))
      .map((entry) =>
        readFormRecord(formsRoot, entry.name).catch(() => null),
      ),
  );
  return records
    .filter(Boolean)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function planDisqualifiers(plan) {
  const issues = [];
  const visit = (state) => {
    if (
      state.crossPageAssessment &&
      state.crossPageAssessment.outcome !== "independent"
    ) {
      issues.push({
        code:
          state.crossPageAssessment.outcome === "cross_page_dependency"
            ? "cross_page_branching"
            : "cross_page_dependency_uncertain",
        detail:
          state.crossPageAssessment.outcome === "cross_page_dependency"
            ? "Cross-page conditional execution is unsupported."
            : "Cross-page independence was not established.",
      });
    }
    for (const field of state.fields || []) {
      if (
        ["captcha_interaction", "credential_interaction", "login_interaction"]
          .includes(field.skipReason)
      ) {
        issues.push({
          code:
            field.skipReason === "captcha_interaction"
              ? "interactive_captcha"
              : "login_required",
          detail: `${field.label} is unsupported for execution.`,
        });
      } else if (field.required && !field.actuate) {
        issues.push({
          code: field.skipReason || "required_field_not_actuated",
          detail: `${field.label} is required but has no accepted executable action.`,
        });
      }
    }
    for (const coverage of state.choiceCoverage || []) {
      if (coverage.variantPlan) visit(coverage.variantPlan);
    }
  };
  for (const state of plan.states || []) visit(state);
  return issues;
}

export async function registerCrawledForms({
  formsRoot,
  run,
  report,
  database = null,
}) {
  if (!database) await mkdir(formsRoot, { recursive: true });
  const definitions = [];
  for (const [pageIndex, page] of report.pages.entries()) {
    const artifact = page.generatedArtifact;
    if (
      !artifact?.path ||
      !artifact?.sourceHash ||
      page.journeyComplete !== true ||
      !["generated_and_published", "retained_replay"].includes(
        artifact.lifecycle,
      )
    ) {
      continue;
    }
    let stored;
    try {
      stored = await loadApprovedFormScript(artifact.path);
    } catch {
      continue;
    }
    const disqualifiers = [
      ...(page.captchaDetected
        ? [
            {
              code: "interactive_captcha",
              detail: "The crawl encountered an interactive CAPTCHA.",
            },
          ]
        : []),
      ...(page.unresolvedGate && /login|credential/i.test(page.unresolvedGate)
        ? [
            {
              code: "login_required",
              detail: "The crawl encountered a required login.",
            },
          ]
        : []),
      ...planDisqualifiers(stored.plan),
    ];
    const uniqueDisqualifiers = [
      ...new Map(
        disqualifiers.map((issue) => [
          `${issue.code}:${issue.detail}`,
          issue,
        ]),
      ).values(),
    ];
    const formId = `form_${randomUUID().replaceAll("-", "")}`;
    const createdAt = new Date().toISOString();
    const inputSchema = approvedInputSchemaForPlan(stored.plan);
    const record = {
      schemaVersion: 1,
      formId,
      sourceRunId: run.id,
      sourcePageIndex: pageIndex,
      targetUrl: stored.plan.initialUrl,
      finalUrl: page.finalUrl,
      title: page.title,
      createdAt,
      updatedAt: createdAt,
      status: uniqueDisqualifiers.length ? "disqualified" : "observed",
      eligibility: {
        status: uniqueDisqualifiers.length ? "disqualified" : "eligible",
        reasons: uniqueDisqualifiers,
      },
      script: {
        artifactId: artifact.artifactId,
        scriptVersion: artifact.scriptVersion,
        sourceHash: artifact.sourceHash,
        path: artifact.path,
      },
      inputSchema,
      approval: null,
      traversalSettings: report.traversalSettings,
    };
    if (database) {
      await database.putForm(record);
    } else {
      const directory = formDirectory(formsRoot, formId);
      await mkdir(directory, { recursive: false });
      await writeJson(path.join(directory, "form.json"), record);
    }
    page.crawlFormId = formId;
    const definition = {
      formId,
      sourceRunId: run.id,
      targetUrl: record.targetUrl,
      title: record.title,
      status: record.status,
      eligibility: record.eligibility,
      script: record.script,
      inputSchema,
      approvalEndpoint: `/api/forms/${formId}/approval`,
      runEndpoint: `/api/forms/${formId}/runs`,
    };
    definitions.push(definition);
  }
  report.formDefinitions = definitions;
  return definitions;
}

export async function decideFormApproval({
  formsRoot,
  formId,
  decision,
  actor,
  notes = "",
  database = null,
}) {
  const directory = formDirectory(formsRoot, formId);
  const record = await readFormRecord(formsRoot, formId, database);
  if (!["approved", "rejected"].includes(decision)) {
    throw Object.assign(
      new Error("decision must be approved or rejected."),
      { statusCode: 400 },
    );
  }
  if (decision === "approved" && record.eligibility.status !== "eligible") {
    throw Object.assign(
      new Error(
        `Disqualified form cannot be approved: ${record.eligibility.reasons
          .map((reason) => reason.code)
          .join(", ")}.`,
      ),
      { statusCode: 409 },
    );
  }
  const now = new Date().toISOString();
  const approval = {
    approvalId: `approval_${randomUUID().replaceAll("-", "")}`,
    decision,
    actor: String(actor || "").trim() || "local-operator",
    notes: String(notes || "").slice(0, 4_000),
    decidedAt: now,
    pinnedScript: {
      artifactId: record.script.artifactId,
      scriptVersion: record.script.scriptVersion,
      sourceHash: record.script.sourceHash,
    },
  };
  const updated = {
    ...record,
    status: decision,
    updatedAt: now,
    approval,
  };
  if (database) {
    await database.putForm(updated);
  } else {
    await writeJson(path.join(directory, "form.json"), updated);
    await writeFile(
      path.join(directory, `${approval.approvalId}.json`),
      `${JSON.stringify(approval, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }
  return updated;
}
