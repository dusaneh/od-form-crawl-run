import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCrawlOutput,
  fingerprintPage,
  fingerprintPageInput,
  parsePageHtml,
  validateTargetUrl,
} from "../local/crawl-core.ts";

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

  assert.match(first, /^[0-9a-f]{16}$/);
  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.deepEqual(Object.keys(fingerprintPageInput(page)), [
    "algorithmVersion",
    "normalizedUrl",
    "fields",
    "stateCount",
    "uploadPresence",
  ]);
  assert.ok(
    fingerprintPageInput(page).fields.some(
      (field) => field.nameOrId === "applicant_name"
    )
  );
});

test("fingerprints canonically and normalizes regenerated United Way upload IDs", () => {
  const page = parsePageHtml(fixture, "https://services.example.gov/apply");
  assert.equal(
    fingerprintPage(page),
    fingerprintPage({ ...page, fields: [...page.fields].reverse() })
  );

  const uploadPage = {
    normalizedUrl:
      "https://www.yourlocalunitedway.org/our-work/healthy-community/housing-navigation/",
    title: "Housing navigation",
    heading: "Housing navigation",
    forms: 1,
    fields: [
      {
        id: "html5_1ju8abc",
        key: "html5_1ju8abc",
        label: "Upload supporting documents",
        control: "file",
        required: false,
        sensitive: false,
        hidden: false,
        options: 0,
        selector: "#html5_1ju8abc",
        sectionText: "Documents",
      },
    ],
    formActions: [],
    links: [],
    hasScripts: true,
  };
  const regenerated = {
    ...uploadPage,
    fields: uploadPage.fields.map((field) => ({
      ...field,
      id: "html5_9zx7def",
      key: "html5_9zx7def",
      selector: "#html5_9zx7def",
    })),
  };
  assert.equal(fingerprintPage(uploadPage), fingerprintPage(regenerated));
  assert.equal(
    fingerprintPageInput(uploadPage).fields[0].nameOrId,
    "[generated:gravity-html5-upload]"
  );
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

test("retains rendered evidence when semantic script generation fails", () => {
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
        rendered: true,
        certificationStatus: "could_not_test",
        semanticGenerationError:
          "Semantic proposal validation failed at $.fields[4].rawLabel.",
      },
    ],
    "run_semantic_failure",
  );

  assert.match(output.nodes[0].subtitle, /Script generation failed/i);
  assert.equal(output.nodes[0].evidenceAvailable, true);
  assert.match(output.nodes[0].notes.join(" "), /No form interaction was attempted/i);
  assert.equal(
    output.findings.some(
      (finding) => finding.code === "semantic_script_generation_failed",
    ),
    true,
  );
  assert.equal(
    output.findings.some((finding) => finding.code === "fetch_failed"),
    false,
  );
});

test("reports shadow actuator degradation without hiding compatibility success", () => {
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
        rendered: true,
        certificationStatus: "generated_script_validated",
        fieldsEntered: 3,
        fieldsVerified: 3,
        actuatorWarnings: [
          {
            code: "actuator_generation_failed",
            targetKey: "state_01",
            stage: "actuator_generation_failed",
            detail: "fetch failed",
          },
        ],
      },
    ],
    "run_shadow_warning",
  );

  assert.equal(
    output.findings.some((finding) => finding.code === "actuator_shadow_degraded"),
    true,
  );
  assert.match(output.nodes[0].notes.join(" "), /compatibility traversal remained active/i);
});

test("reports verified interaction preparation and fail-closed choice probes", () => {
  const parsed = parsePageHtml(fixture, "https://services.example.gov/apply");
  const choice = parsed.fields.find((field) => field.control === "select");
  assert.ok(choice);
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
        rendered: true,
        interactionGatePrepared: true,
        certificationStatus: "could_not_test",
        failureStage: "actuator_preflight_failed",
        blockedBeforeActuation: true,
        fieldsPlanned: 3,
        fieldsAttempted: 0,
        fieldsVerified: 0,
        failureIssues: [
          {
            code: "actuation_unverified",
            targetKey: `${choice.key}_generated_option`,
            controlType: "select",
            detail: "The visible choice facade did not retain its state.",
            issueId: "issue_1",
          },
        ],
      },
    ],
    "run_typed_signals",
  );
  assert.equal(
    output.findings.some((finding) => finding.code === "interaction_gated_js"),
    true,
  );
  assert.equal(
    output.findings.some((finding) => finding.code === "probe_actuation_failed"),
    true,
  );
  assert.equal(
    output.findings.some(
      (finding) => finding.code === "terminal_submission_confirmed",
    ),
    false,
  );
});
