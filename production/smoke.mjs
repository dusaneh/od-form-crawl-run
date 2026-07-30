import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const base = process.env.FORMWEAVE_SMOKE_URL || "http://127.0.0.1:8080";
const source = await readFile(path.join(projectRoot, "access.md"), "utf8");
const seed = JSON.parse(
  source.match(
    /FORMWEAVE_AUTH_SEED_START\s*-->\s*```json\s*([\s\S]*?)```/,
  )?.[1] || "{}",
);
const user = seed.users?.[1];
const token = seed.apiTokens?.[0]?.token;
if (!user || !token) throw new Error("Smoke-test credentials are unavailable.");

const basic = `Basic ${Buffer.from(
  `${user.email}:${user.password}`,
).toString("base64")}`;
const bearer = `Bearer ${token}`;
const checks = [];

await check("public landing", "/", { expected: 200, includes: "API-first" });
await check("public health", "/healthz", { expected: 200, includes: "online" });
await check("anonymous UI redirects", "/control-plane", { expected: 302 });
await check("login page", "/login?return_to=%2Fcontrol-plane", {
  expected: 200,
  includes: "Continue to FormWeave",
});
await check("anonymous API", "/api/health", { expected: 401 });
const basicUi = await check("Basic UI", "/control-plane", {
  expected: 200,
  headers: { authorization: basic },
  includes: "Form intelligence",
});
const sessionCookie = basicUi.response.headers
  .get("set-cookie")
  ?.split(";")[0];
if (!sessionCookie) throw new Error("Basic login did not issue a session cookie.");
await check("session cookie API", "/api/health", {
  expected: 200,
  headers: { cookie: sessionCookie },
  includes: '"hosted":true',
});
await check("Basic API", "/api/health", {
  expected: 200,
  headers: { authorization: basic },
  includes: '"hosted":true',
});
await check("Bearer API", "/api/health", {
  expected: 200,
  headers: { authorization: bearer },
  includes: '"headless"',
});
await check("Bearer rejected for UI", "/control-plane", {
  expected: 302,
  headers: { authorization: bearer },
});
await check("anonymous audit dashboard redirects", "/ops/audit-log", {
  expected: 302,
});
await check("Bearer rejected for audit dashboard", "/ops/audit-log", {
  expected: 302,
  headers: { authorization: bearer },
});
await check("session audit dashboard", "/ops/audit-log", {
  expected: 200,
  headers: { cookie: sessionCookie },
  includes: "Audit and reliability dashboard",
});
await check("Bearer rejected for audit data", "/api/ops/audit", {
  expected: 401,
  headers: { authorization: bearer },
});
await check("session audit data", "/api/ops/audit?hours=24", {
  expected: 200,
  headers: { cookie: sessionCookie },
  includes: '"audit"',
});
await check("hosted headful rejected", "/api/runs", {
  expected: 400,
  method: "POST",
  headers: { authorization: bearer },
  body: {
    urls: ["https://example.com/form"],
    browserMode: "headful",
  },
  includes: "hosted_headful_unsupported",
});
await check("hosted loopback rejected", "/api/runs", {
  expected: 400,
  method: "POST",
  headers: { authorization: bearer },
  body: {
    urls: ["http://localhost:9000/form"],
    allowLocalTargets: true,
    browserMode: "headless",
  },
  includes: "Private-network targets are not allowed",
});

const unknownBasic = `Basic ${Buffer.from(
  `lockout-${Date.now()}@example.invalid:incorrect-password`,
).toString("base64")}`;
for (let attempt = 1; attempt <= 6; attempt += 1) {
  await check(`lockout attempt ${attempt}`, "/api/health", {
    expected: attempt < 5 ? 401 : 429,
    headers: { authorization: unknownBasic },
  });
}

console.log(JSON.stringify({ passed: true, base, checks }, null, 2));

async function check(
  label,
  route,
  { expected, headers = {}, method = "GET", body, includes } = {},
) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  const passed =
    response.status === expected && (!includes || text.includes(includes));
  const result = {
    label,
    status: response.status,
    expected,
    passed,
  };
  checks.push(result);
  if (!passed) {
    throw new Error(
      `${label} failed: expected ${expected}, received ${response.status}; ${text.slice(0, 500)}`,
    );
  }
  return { response, text };
}
