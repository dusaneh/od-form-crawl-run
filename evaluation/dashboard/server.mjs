import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboardData } from "./data.mjs";

const dashboardRoot = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(dashboardRoot, "public");
const projectRoot = path.resolve(dashboardRoot, "..", "..");
const host = process.env.FORMWEAVE_DASHBOARD_HOST || "127.0.0.1";
const port = Number(process.env.FORMWEAVE_DASHBOARD_PORT || process.argv[2] || 8790);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (url.pathname === "/api/dashboard-data") {
    try {
      sendJson(response, 200, await buildDashboardData(projectRoot));
    } catch (error) {
      sendJson(response, 500, { error: String(error?.message || error) });
    }
    return;
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const absolute = path.resolve(publicRoot, requested);
  if (!absolute.startsWith(`${path.resolve(publicRoot)}${path.sep}`)) {
    sendJson(response, 403, { error: "forbidden" });
    return;
  }
  const metadata = await stat(absolute).catch(() => null);
  if (!metadata?.isFile()) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  response.writeHead(200, {
    "content-type": contentTypes[path.extname(absolute)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(absolute).pipe(response);
});

server.listen(port, host, () => {
  console.log(`FormWeave evaluation dashboard: http://${host}:${port}`);
  console.log("Development framework only; no application routes or imports are used.");
});
