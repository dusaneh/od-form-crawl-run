import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCrawlOutput,
  fingerprintPage,
  parsePageHtml,
  validateTargetUrl,
} from "../worker/crawler.ts";

const fixture = `
<!doctype html>
<html>
  <head><title>Housing application</title></head>
  <body>
    <h1>Apply for housing support</h1>
    <form action="/apply/step-two" method="post">
      <label for="full-name">Full name</label>
      <input id="full-name" name="applicant_name" autocomplete="name" required>
      <label for="email">Email address</label>
      <input id="email" name="email" type="email">
      <label for="county">County</label>
      <select id="county" name="county" required>
        <option>North</option>
        <option>South</option>
      </select>
      <input type="hidden" name="csrf" value="token">
      <button type="submit">Continue</button>
    </form>
    <a href="/apply/help">Application help</a>
    <script src="/app.js"></script>
  </body>
</html>`;

test("extracts real form controls, actions, and links from HTML", () => {
  const page = parsePageHtml(fixture, "https://services.example.gov/apply");

  assert.equal(page.title, "Housing application");
  assert.equal(page.heading, "Apply for housing support");
  assert.equal(page.forms, 1);
  assert.equal(page.fields.length, 4);
  assert.deepEqual(
    page.fields.map((field) => field.key),
    ["applicant_name", "email", "county", "csrf"]
  );
  assert.equal(page.fields[0].label, "Full name");
  assert.equal(page.fields[0].required, true);
  assert.equal(page.fields[0].sensitive, true);
  assert.equal(page.fields[2].options, 2);
  assert.equal(page.fields[3].hidden, true);
  assert.deepEqual(page.formActions, [
    "https://services.example.gov/apply/step-two",
  ]);
  assert.equal(page.links[0].url, "https://services.example.gov/apply/help");
  assert.equal(page.hasScripts, true);
});

test("fingerprints observed form facts deterministically", () => {
  const page = parsePageHtml(fixture, "https://services.example.gov/apply");
  const first = fingerprintPage(page);
  const second = fingerprintPage(page);
  const changed = fingerprintPage({
    ...page,
    fields: page.fields.slice(0, 2),
  });

  assert.match(first, /^[0-9a-f]{4}·[0-9a-f]{4}$/);
  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test("blocks private-network and credential-bearing crawl targets", () => {
  assert.throws(() => validateTargetUrl("http://127.0.0.1/admin"), /Private-network/);
  assert.throws(() => validateTargetUrl("http://192.168.1.4/form"), /Private-network/);
  assert.throws(
    () => validateTargetUrl("https://user:secret@example.com/form"),
    /embedded credentials/
  );
  assert.throws(
    () => validateTargetUrl("https://example.com/form?access_token=secret"),
    /credential-like query/
  );
  assert.equal(
    validateTargetUrl("https://example.gov/form#step"),
    "https://example.gov/form"
  );
});

test("builds run nodes and contracts from crawl results without demo data", () => {
  const parsed = parsePageHtml(fixture, "https://services.example.gov/apply");
  const output = buildCrawlOutput(
    [
      {
        ...parsed,
        requestedUrl: "https://services.example.gov/apply",
        finalUrl: "https://services.example.gov/apply",
        httpStatus: 200,
        contentType: "text/html",
        durationMs: 120,
        bytesFetched: 2048,
        fingerprint: fingerprintPage(parsed),
        screenshot: new Uint8Array([1, 2, 3]),
        screenshotContentType: "image/png",
        screenshotProvider: "test",
      },
    ],
    "run_test"
  );

  assert.equal(output.nodes.length, 1);
  assert.equal(output.nodes[0].title, "Apply for housing support");
  assert.equal(output.nodes[0].evidenceAvailable, true);
  assert.equal(output.nodes[0].fields, 3);
  assert.equal(output.contract.length, 4);
  assert.equal(output.findings[0].code, "crawl_finished");
  assert.equal(output.findings.some((finding) => finding.code === "dynamic_review_required"), true);
});
