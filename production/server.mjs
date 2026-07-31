import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../local/env.mjs";
import { createFormWeaveDatabase } from "../local/postgres/database.mjs";
import { AuthStore } from "./auth-store.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
loadEnvFile(path.join(projectRoot, ".env"));

const publicPort = integer(process.env.PORT, 8080);
const publicHost = process.env.FORMWEAVE_PUBLIC_HOST || "0.0.0.0";
const apiPort = integer(process.env.FORMWEAVE_INTERNAL_API_PORT, 18_787);
const uiPort = integer(process.env.FORMWEAVE_INTERNAL_UI_PORT, 13_000);
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URI;
const clientBuildRoot = path.join(projectRoot, "dist", "client");
if (!connectionString) {
  throw new Error(
    "The production server requires DATABASE_URL or POSTGRES_URI.",
  );
}
if (new Set([publicPort, apiPort, uiPort]).size !== 3) {
  throw new Error("Public, API, and UI ports must be different.");
}

const database = await createFormWeaveDatabase(connectionString);
const authStore = new AuthStore(database);
const children = [];
let gateway;
let stopping = false;

const apiChild = launch(
  "Crawler API",
  process.execPath,
  ["local/server.mjs"],
  {
    ...process.env,
    POSTGRES_URI: connectionString,
    FORMWEAVE_STORAGE: "postgres",
    FORMWEAVE_HOSTED: "1",
    FORMWEAVE_API_HOST: "127.0.0.1",
    FORMWEAVE_API_PORT: String(apiPort),
    FORMWEAVE_ALLOW_LOCAL_TARGETS: "0",
    PLAYWRIGHT_BROWSERS_PATH:
      process.env.PLAYWRIGHT_BROWSERS_PATH || "0",
    FORMWEAVE_CACHE_DIR:
      process.env.FORMWEAVE_CACHE_DIR || "/tmp/formweave-cache",
  },
);

const vinextCli = path.join(
  projectRoot,
  "node_modules",
  "vinext",
  "dist",
  "cli.js",
);
const uiChild = launch(
  "Vinext UI",
  process.execPath,
  [
    vinextCli,
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(uiPort),
  ],
  process.env,
);

try {
  await Promise.all([
    waitUntilReady(`http://127.0.0.1:${apiPort}/api/health`, "Crawler API"),
    waitUntilReady(`http://127.0.0.1:${uiPort}/`, "Vinext UI"),
  ]);
} catch (error) {
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  await database.close().catch(() => {});
  throw error;
}

gateway = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(
      incoming.url || "/",
      `http://${incoming.headers.host || `localhost:${publicPort}`}`,
    );

    if (url.pathname === "/healthz") {
      return sendJson(outgoing, 200, {
        status: "online",
        service: "formweave",
        authentication: "enabled",
      });
    }
    if (url.pathname === "/login") {
      if (incoming.method === "GET") {
        const existingIdentity = await authenticateRequest(incoming, {
          allowBearer: false,
          issueSession: false,
        });
        return sendLoginPage(outgoing, {
          returnTo: safeReturnTo(url.searchParams.get("return_to")),
          identity: existingIdentity.ok ? existingIdentity : null,
        });
      }
      if (incoming.method === "POST") {
        return handleLogin(incoming, outgoing, url);
      }
      return sendJson(outgoing, 405, {
        error: "Method not allowed.",
        code: "method_not_allowed",
      });
    }
    if (
      url.pathname.startsWith("/assets/") &&
      (await serveBuiltAsset(url.pathname, outgoing))
    ) {
      return;
    }

    const uiProtected =
      url.pathname === "/control-plane" ||
      url.pathname.startsWith("/control-plane/") ||
      url.pathname === "/api-console" ||
      url.pathname.startsWith("/api-console/") ||
      url.pathname === "/ops/audit-log" ||
      url.pathname.startsWith("/ops/audit-log/");
    const apiProtected = url.pathname.startsWith("/api/");
    const dashboardApi =
      url.pathname === "/api/ops/audit" ||
      url.pathname.startsWith("/api/ops/audit/");
    const adminProtected = dashboardApi ||
      url.pathname === "/ops/audit-log" ||
      url.pathname.startsWith("/ops/audit-log/");
    const optionalIdentity = url.pathname === "/";
    let identity = null;

    if (
      incoming.method !== "OPTIONS" &&
      (uiProtected || apiProtected || optionalIdentity)
    ) {
      identity = await authenticateRequest(incoming, {
        allowBearer: apiProtected && !dashboardApi,
        issueSession: uiProtected,
      });
      if (!identity.ok && (uiProtected || apiProtected)) {
        if (uiProtected && !identity.lockedUntil) {
          outgoing.writeHead(302, {
            location: `/login?return_to=${encodeURIComponent(
              `${url.pathname}${url.search}`,
            )}`,
            "cache-control": "no-store",
          });
          outgoing.end();
          return;
        }
        return unauthorized(outgoing, {
          api: apiProtected,
          lockedUntil: identity.lockedUntil,
        });
      }
      if (!identity.ok) identity = null;
    }

    if (adminProtected && identity?.role !== "admin") {
      return forbidden(outgoing, { api: dashboardApi });
    }

    const targetPort = apiProtected ? apiPort : uiPort;
    proxyRequest(incoming, outgoing, targetPort, identity?.ok ? identity : null);
  } catch (error) {
    sendJson(outgoing, 500, {
      error: "Production gateway error.",
      code: "gateway_error",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

gateway.listen(publicPort, publicHost, () => {
  console.log(`FormWeave production gateway: http://${publicHost}:${publicPort}`);
  console.log(`Protected UI: /control-plane and /api-console`);
  console.log(`Protected API: /api/*`);
});

async function authenticateRequest(incoming, { allowBearer, issueSession }) {
  const authorization = String(incoming.headers.authorization || "");
  const clientAddress =
    String(incoming.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() ||
    incoming.socket.remoteAddress ||
    "";
  if (authorization.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString(
        "utf8",
      );
      const separator = decoded.indexOf(":");
      if (separator < 1) return { ok: false };
      const identity = await authStore.authenticateBasic(
        decoded.slice(0, separator),
        decoded.slice(separator + 1),
        clientAddress,
      );
      if (identity.ok && issueSession) {
        identity.session = await authStore.createSession(identity);
      }
      return identity;
    } catch {
      return { ok: false };
    }
  }
  if (allowBearer && authorization.startsWith("Bearer ")) {
    return authStore.authenticateBearer(
      authorization.slice(7).trim(),
      clientAddress,
    );
  }
  const sessionToken = cookieValue(
    String(incoming.headers.cookie || ""),
    "formweave_session",
  );
  if (sessionToken) {
    return authStore.authenticateSession(sessionToken);
  }
  return { ok: false };
}

async function handleLogin(incoming, outgoing, url) {
  const returnTo = safeReturnTo(url.searchParams.get("return_to"));
  let form;
  try {
    const body = await readBody(incoming, 8_000);
    form = new URLSearchParams(body);
  } catch {
    return sendLoginPage(outgoing, {
      returnTo,
      status: 400,
      error: "The sign-in request was invalid.",
    });
  }
  const clientAddress =
    String(incoming.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() ||
    incoming.socket.remoteAddress ||
    "";
  const identity = await authStore.authenticateBasic(
    form.get("email"),
    form.get("password"),
    clientAddress,
  );
  if (!identity.ok) {
    return sendLoginPage(outgoing, {
      returnTo,
      status: identity.lockedUntil ? 429 : 401,
      error: identity.lockedUntil
        ? `Too many failed attempts. Try again after ${new Date(
            identity.lockedUntil,
          ).toLocaleTimeString()}.`
        : "The email address or password was not accepted.",
    });
  }
  const session = await authStore.createSession(identity);
  const secure =
    String(incoming.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim() === "https";
  outgoing.writeHead(303, {
    location: returnTo,
    "set-cookie": sessionCookie(session, secure),
    "cache-control": "no-store",
  });
  outgoing.end();
}

function proxyRequest(incoming, outgoing, targetPort, identity) {
  const startedAt = Date.now();
  const headers = { ...incoming.headers };
  delete headers.authorization;
  delete headers["x-formweave-auth-mechanism"];
  delete headers["x-formweave-auth-principal"];
  delete headers["x-formweave-auth-scopes"];
  delete headers["x-formweave-auth-role"];
  headers.host = `127.0.0.1:${targetPort}`;
  headers["x-forwarded-host"] =
    incoming.headers["x-forwarded-host"] || incoming.headers.host || "";
  headers["x-forwarded-proto"] =
    incoming.headers["x-forwarded-proto"] || "http";
  if (identity) {
    headers["x-formweave-auth-mechanism"] = identity.mechanism;
    headers["x-formweave-auth-principal"] = identity.principal;
    headers["x-formweave-auth-scopes"] = identity.scopes.join(",");
    headers["x-formweave-auth-role"] = identity.role || "operator";
  }

  const proxied = httpRequest(
    {
      hostname: "127.0.0.1",
      port: targetPort,
      method: incoming.method,
      path: incoming.url,
      headers,
    },
    (response) => {
      const responseHeaders = { ...response.headers };
      if (identity?.session) {
        const secure =
          String(incoming.headers["x-forwarded-proto"] || "")
            .split(",")[0]
            .trim() === "https";
        responseHeaders["set-cookie"] = sessionCookie(
          identity.session,
          secure,
        );
      }
      outgoing.writeHead(response.statusCode || 502, responseHeaders);
      response.pipe(outgoing);
      void auditGatewayRequest({
        incoming,
        identity,
        status: response.statusCode || 502,
        durationMs: Date.now() - startedAt,
      }).catch((error) =>
        console.error("Could not persist gateway audit event:", error),
      );
    },
  );
  proxied.on("error", (error) => {
    if (outgoing.headersSent) {
      outgoing.destroy(error);
      return;
    }
    sendJson(outgoing, 502, {
      error: "An internal FormWeave service is unavailable.",
      code: "upstream_unavailable",
    });
  });
  incoming.pipe(proxied);
}

async function auditGatewayRequest({
  incoming,
  identity,
  status,
  durationMs,
}) {
  const url = new URL(
    incoming.url || "/",
    `http://${incoming.headers.host || `localhost:${publicPort}`}`,
  );
  if (
    !url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/api/ops/audit")
  ) {
    return;
  }
  const method = String(incoming.method || "GET").toUpperCase();
  const crawlStart = method === "POST" && url.pathname === "/api/runs";
  const approval = method === "POST" &&
    /^\/api\/forms\/[^/]+\/approval$/.test(url.pathname);
  const execution = method === "POST" &&
    /^\/api\/forms\/[^/]+\/runs$/.test(url.pathname);
  if (status < 400 && !crawlStart && !approval && !execution) return;

  const formMatch = url.pathname.match(/^\/api\/forms\/([^/]+)/);
  const actorType =
    identity?.mechanism === "bearer"
      ? "api_token"
      : identity?.ok
        ? "user"
        : "unknown";
  const eventType =
    status >= 400
      ? "api.request_failed"
      : crawlStart
        ? "api.crawl_start_accepted"
        : approval
          ? "api.approval_accepted"
          : "api.execution_start_accepted";
  await database.appendAuditEvent(
    {
      category: "api",
      severity: status >= 500 ? "error" : status >= 400 ? "warning" : "success",
      eventType,
      outcome: status >= 400 ? "failed" : "accepted",
      actorType,
      actorId: identity?.principal || null,
      scopeType: formMatch ? "form" : crawlStart ? "crawl_request" : "api",
      scopeId: formMatch
        ? decodeURIComponent(formMatch[1])
        : crawlStart
          ? "pending"
          : url.pathname,
      message:
        status >= 400
          ? `${method} ${url.pathname} returned HTTP ${status}.`
          : crawlStart
            ? "Crawl request accepted by the API."
            : approval
              ? "Form approval request accepted by the API."
              : "Form execution request accepted by the API.",
      metadata: {
        method,
        path: url.pathname,
        status,
        durationMs,
        mechanism: identity?.mechanism || "none",
      },
    },
    `gateway:${randomUUID()}`,
  );
}

async function serveBuiltAsset(pathname, outgoing) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const filePath = path.resolve(clientBuildRoot, `.${decoded}`);
  if (!filePath.startsWith(`${path.resolve(clientBuildRoot)}${path.sep}`)) {
    return false;
  }
  let facts;
  try {
    facts = await stat(filePath);
  } catch {
    return false;
  }
  if (!facts.isFile()) return false;
  outgoing.writeHead(200, {
    "content-type": contentType(filePath),
    "content-length": String(facts.size),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  createReadStream(filePath).pipe(outgoing);
  return true;
}

function unauthorized(outgoing, { api, lockedUntil }) {
  if (lockedUntil) {
    const retryAfter = Math.max(
      1,
      Math.ceil((Date.parse(lockedUntil) - Date.now()) / 1000),
    );
    outgoing.setHeader("retry-after", String(retryAfter));
    return sendJson(outgoing, 429, {
      error: "Too many failed authentication attempts.",
      code: "authentication_locked",
      lockedUntil,
    });
  }
  outgoing.setHeader(
    "www-authenticate",
    api
      ? 'Basic realm="FormWeave", charset="UTF-8", Bearer realm="FormWeave API"'
      : 'Basic realm="FormWeave", charset="UTF-8"',
  );
  return sendJson(outgoing, 401, {
    error: "Authentication is required.",
    code: "authentication_required",
  });
}

function forbidden(outgoing, { api }) {
  if (api) {
    return sendJson(outgoing, 403, {
      error: "Administrator access is required.",
      code: "admin_required",
    });
  }
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Access denied · FormWeave</title></head><body style="font-family:system-ui,sans-serif;padding:3rem;color:#153d32"><main><h1>Administrator access required</h1><p>This dashboard is available only to the FormWeave administrator.</p><a href="/">Return home</a></main></body></html>`;
  outgoing.writeHead(403, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  outgoing.end(body);
}

function sendJson(outgoing, status, value) {
  if (outgoing.writableEnded) return;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  outgoing.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  outgoing.end(body);
}

function sendLoginPage(
  outgoing,
  { returnTo = "/control-plane", status = 200, error = "", identity = null } = {},
) {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in · FormWeave</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
        background: radial-gradient(circle at top right, #dff7ed, #f7faf7 48%, #e9f1ec); color: #153d32; }
      main { width: min(100%, 430px); padding: 34px; border: 1px solid #c8d9d1; border-radius: 20px;
        background: rgba(255,255,255,.92); box-shadow: 0 24px 70px rgba(20,61,50,.13); }
      .eyebrow { margin: 0 0 10px; font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
      h1 { margin: 0 0 8px; font-size: 34px; letter-spacing: -.045em; }
      .intro { margin: 0 0 24px; color: #60766e; line-height: 1.55; }
      label { display: grid; gap: 7px; margin: 0 0 16px; font-size: 14px; font-weight: 750; }
      input { width: 100%; border: 1px solid #b8ccc3; border-radius: 10px; padding: 12px 13px;
        font: inherit; color: #153d32; background: white; }
      input:focus { outline: 3px solid #aee8d1; border-color: #188c64; }
      button { width: 100%; border: 0; border-radius: 11px; padding: 13px 15px; font: inherit;
        font-weight: 800; color: white; background: #124737; cursor: pointer; }
      .error { margin: 0 0 18px; padding: 11px 12px; border: 1px solid #efaaa1; border-radius: 10px;
        color: #8d3025; background: #fff1ef; font-size: 14px; line-height: 1.45; }
      .note { margin: 18px 0 0; color: #71857d; font-size: 12px; line-height: 1.5; }
      .admin-link { display: block; margin: 0 0 18px; padding: 12px 14px; border-radius: 10px;
        color: white; background: #124737; font-weight: 800; text-align: center; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">FormWeave protected access</p>
      <h1>Sign in</h1>
      <p class="intro">Use the individual staging credentials assigned to you.</p>
      ${identity?.role === "admin" ? '<a class="admin-link" href="/ops/audit-log">Open audit dashboard</a>' : ""}
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/login?return_to=${encodeURIComponent(returnTo)}">
        <label>Email
          <input name="email" type="email" autocomplete="username" required autofocus>
        </label>
        <label>Password
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <button type="submit">Continue to FormWeave</button>
      </form>
      <p class="note">Five failed attempts lock an account for 15 minutes. Sessions expire after eight hours.</p>
    </main>
  </body>
</html>`;
  outgoing.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  outgoing.end(body);
}

function launch(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    shell: false,
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(
      `${label} stopped unexpectedly (${signal || `exit ${code ?? "unknown"}`}).`,
    );
    stop(code || 1);
  });
  return child;
}

async function waitUntilReady(url, label) {
  const deadline = Date.now() + 45_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastError = new Error(`${label} returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${label} did not become ready: ${
      lastError instanceof Error ? lastError.message : "unknown error"
    }`,
  );
}

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (gateway) {
    await new Promise((resolve) => gateway.close(resolve)).catch(() => {});
  }
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  await database.close().catch(() => {});
  setTimeout(() => process.exit(exitCode), 250).unref();
}

function integer(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cookieValue(source, name) {
  for (const part of source.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function sessionCookie(session, secure) {
  return [
    `formweave_session=${encodeURIComponent(session.token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${session.maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function safeReturnTo(value) {
  const candidate = String(value || "/control-plane");
  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/control-plane";
  }
  try {
    const parsed = new URL(candidate, "https://formweave.invalid");
    if (parsed.origin !== "https://formweave.invalid") return "/control-plane";
    if (parsed.pathname === "/login") return "/control-plane";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/control-plane";
  }
}

async function readBody(incoming, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of incoming) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".woff2":
      return "font/woff2";
    case ".woff":
      return "font/woff";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("uncaughtException", (error) => {
  console.error(error);
  stop(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  stop(1);
});

void apiChild;
void uiChild;
