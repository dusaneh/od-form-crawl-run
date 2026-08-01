import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("hosted crawl and form-run targets enforce designated-user access", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "formweave-access-"));
  const dataRoot = path.join(tempRoot, "data");
  const formId = "form_externalaccesstest";
  const formRoot = path.join(dataRoot, "forms", formId);
  await mkdir(formRoot, { recursive: true });
  await writeFile(
    path.join(formRoot, "form.json"),
    `${JSON.stringify({
      formId,
      targetUrl: "https://example.org/application",
      status: "observed",
      approval: null,
    })}\n`,
    "utf8",
  );

  const port = await freePort();
  const output = [];
  const child = spawn(process.execPath, ["local/server.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: "",
      POSTGRES_URI: "",
      FORMWEAVE_API_HOST: "127.0.0.1",
      FORMWEAVE_API_PORT: String(port),
      FORMWEAVE_DATA_DIR: dataRoot,
      FORMWEAVE_STORAGE: "filesystem",
      FORMWEAVE_HOSTED: "1",
      FORMWEAVE_DISABLE_OPENAI: "1",
      OPENAI_KEY: "",
      OPENAI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  const operatorHeaders = {
    "content-type": "application/json",
    "x-formweave-auth-mechanism": "session",
    "x-formweave-auth-principal": "operator@example.test",
    "x-formweave-auth-role": "operator",
    "x-formweave-auth-scopes": "ui,api",
  };
  const adminHeaders = {
    "content-type": "application/json",
    "x-formweave-auth-mechanism": "session",
    "x-formweave-auth-principal": "dbosmail@gmail.com",
    "x-formweave-auth-role": "admin",
    "x-formweave-auth-scopes":
      "ui,api,admin,control-plane,external-targets",
  };

  try {
    await waitForServer(`${baseUrl}/api/health`, child, output);

    const operatorExternal = await postJson(
      `${baseUrl}/api/runs`,
      operatorHeaders,
      {
        urls: ["https://example.org/application"],
        browserMode: "headless",
      },
    );
    assert.equal(operatorExternal.status, 403);
    assert.equal(
      operatorExternal.body.code,
      "external_target_access_required",
    );

    const operatorTestTarget = await postJson(
      `${baseUrl}/api/runs`,
      operatorHeaders,
      {
        urls: ["https://testforms.dbolab.io/site_a_simple/intake"],
        browserMode: "headful",
      },
    );
    assert.equal(operatorTestTarget.status, 400);
    assert.equal(operatorTestTarget.body.code, "hosted_headful_unsupported");

    const adminExternal = await postJson(
      `${baseUrl}/api/runs`,
      adminHeaders,
      {
        urls: ["https://example.org/application"],
        browserMode: "headful",
      },
    );
    assert.equal(adminExternal.status, 400);
    assert.equal(adminExternal.body.code, "hosted_headful_unsupported");

    const operatorFormRun = await postJson(
      `${baseUrl}/api/forms/${formId}/runs`,
      operatorHeaders,
      { data: {}, submit: false },
    );
    assert.equal(operatorFormRun.status, 403);
    assert.equal(
      operatorFormRun.body.code,
      "external_target_access_required",
    );

    const adminFormRun = await postJson(
      `${baseUrl}/api/forms/${formId}/runs`,
      adminHeaders,
      { data: {}, submit: false },
    );
    assert.equal(adminFormRun.status, 409);
    assert.equal(adminFormRun.body.code, "form_not_approved");
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(url, child, output) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Hosted API exited early:\n${output.join("")}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for hosted API:\n${output.join("")}`);
}

async function postJson(url, headers, body) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
