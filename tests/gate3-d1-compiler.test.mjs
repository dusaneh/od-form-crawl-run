import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import { compileAndStoreD1 } from "../local/compiler/d1-compiler.mjs";
import { loadRestrictedD1 } from "../local/compiler/restricted-d1-loader.mjs";

function observation(origin) {
  return {
    schemaVersion: 1,
    observedAt: "2026-07-24T20:00:00.000Z",
    url: `${origin}intake`,
    normalizedRoute: "/intake",
    locale: "en-US",
    title: "Fixture intake",
    heading: "Fixture intake",
    controls: [
      {
        factId: "field_0",
        tag: "input",
        rawType: "text",
        name: "first_name",
        id: "first_name",
        rawLabel: "First name",
        groupLegend: "",
        description: "",
        placeholder: null,
        autocomplete: null,
        required: true,
        visible: true,
        disabled: false,
        options: [],
        sectionText: "",
        selectorCandidates: [
          "#first_name",
          'input[name="first_name"]',
          'input[name="first_name"][type="text"]',
        ],
      },
      {
        factId: "field_1",
        tag: "input",
        rawType: "checkbox",
        name: "terms",
        id: "terms",
        rawLabel: "I agree to the legal terms",
        groupLegend: "",
        description: "",
        placeholder: null,
        autocomplete: null,
        required: true,
        visible: true,
        disabled: false,
        options: [{ value: "yes", label: "I agree to the legal terms" }],
        sectionText: "",
        selectorCandidates: [
          "#terms",
          'input[name="terms"]',
          'input[name="terms"][type="checkbox"]',
          'input[name="terms"][type="checkbox"][value="yes"]',
        ],
      },
    ],
    actions: [
      {
        factId: "action_0",
        tag: "button",
        rawType: "submit",
        rawText: "Submit application",
        visible: true,
        disabled: true,
        href: null,
        selectorCandidates: ['button[type="submit"]'],
        formMethod: "POST",
        formAction: `${origin}submitted`,
      },
    ],
    sections: [],
    guidance: [],
    challengeSignals: [],
    accessibilitySnapshot: "textbox First name; checkbox terms; button submit",
    screenshot: {
      sha256: "a".repeat(64),
      byteLength: 1,
      mediaType: "image/png",
    },
    priorStates: [],
    existingContract: null,
  };
}

function proposal() {
  return {
    schemaVersion: 1,
    proposalId: "proposal_gate3_fixture",
    state: {
      key: "intake_terminal",
      description: "Single-page intake at its terminal boundary.",
      kind: "terminal",
      normalizedRoute: "/intake",
      visibleControlKeys: ["first_name", "terms"],
      sectionKeys: [],
      progression: {
        key: "submit_application",
        kind: "terminal_submit",
        rationale: "Observed submit-typed terminal action.",
      },
    },
    fields: [
      {
        key: "first_name",
        rawLabel: "First name",
        controlType: "text",
        required: true,
        options: [],
        sectionKey: null,
        guidanceRefs: [],
        testValue: "FORMWEAVE TEST PERSON",
        sensitive: false,
        administrative: false,
        resolutionHints: ["first_name"],
        sourceFactIds: ["field_0"],
      },
      {
        key: "terms",
        rawLabel: "I agree to the legal terms",
        controlType: "checkbox",
        required: true,
        options: [{ value: "yes", label: "I agree to the legal terms" }],
        sectionKey: null,
        guidanceRefs: [],
        testValue: "yes",
        sensitive: false,
        administrative: false,
        resolutionHints: ["terms"],
        sourceFactIds: ["field_1"],
      },
    ],
    sections: [],
    guidance: [],
    mechanics: {
      fieldTargets: [
        { fieldKey: "first_name", selectors: ["#first_name"] },
        { fieldKey: "terms", selectors: ["#terms"] },
      ],
      progressionTarget: {
        key: "submit_application",
        kind: "terminal_submit",
        sourceFactId: "action_0",
        selectors: ['button[type="submit"]'],
      },
    },
    proposedActions: [
      {
        proposalId: "act_first_name",
        kind: "field_actuation",
        targetKey: "first_name",
        value: "FORMWEAVE TEST PERSON",
        rationale: "Exercise required text field.",
      },
      {
        proposalId: "act_terms",
        kind: "field_actuation",
        targetKey: "terms",
        value: "yes",
        rationale: "Model proposed a legal acceptance that safety must reject.",
      },
      {
        proposalId: "act_submit",
        kind: "terminal_submit",
        targetKey: "submit_application",
        value: null,
        rationale: "Identify terminal action without actuating it.",
      },
    ],
    rationale: [
      {
        subjectKey: "intake_terminal",
        evidence: "Observed controls and terminal action.",
        confidence: "high",
      },
    ],
  };
}

async function fixtureServer() {
  let submitted = 0;
  const server = createServer((request, response) => {
    if (request.url === "/submitted") submitted += 1;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <form method="post" action="/submitted">
        <label for="first_name">First name</label>
        <input id="first_name" name="first_name" type="text" required>
        <label for="terms">I agree to the legal terms</label>
        <input id="terms" name="terms" type="checkbox" value="yes" required>
        <button type="submit" disabled>Submit application</button>
      </form>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}/`,
    submissions: () => submitted,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test(
  "Gate 3 compiles, stores, loads, and executes one restricted generated D1",
  { timeout: 60_000 },
  async () => {
    const fixture = await fixtureServer();
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "formweave-gate3-"));
    const browser = await chromium.launch({ headless: true });
    try {
      const compiled = await compileAndStoreD1({
        dataRoot,
        proposal: proposal(),
        observation: observation(fixture.origin),
        provenance: {
          model: "gate3-test-model",
          promptVersion: "gate2-semantic-state-v1",
        },
      });
      assert.equal(compiled.safety.protectedFields[0].fieldKey, "terms");
      assert.deepEqual(compiled.descriptor.allowedSyntheticFieldKeys, [
        "first_name",
      ]);
      assert.deepEqual(compiled.descriptor.protectedFieldKeys, ["terms"]);
      assert.equal(compiled.fingerprint.digest.length, 16);

      const loaded = await loadRestrictedD1({
        dataRoot,
        artifactId: compiled.artifactId,
        artifactVersion: 1,
        scriptVersion: 1,
      });
      const source = await readFile(
        path.join(loaded.root, "generated.mjs"),
        "utf8",
      );
      assert.match(source, /createGeneratedD1Runtime/);
      assert.doesNotMatch(
        source,
        /ground[_-]?truth|answer[_-]?key|semantic-generator|playwright/i,
      );

      const page = await browser.newPage();
      await page.goto(`${fixture.origin}intake`);
      const runtime = loaded.createRuntime({
        page,
        contract: loaded.contract,
      });
      assert.deepEqual(runtime.defaultInputs("intake_terminal"), {
        first_name: "FORMWEAVE TEST PERSON",
      });
      const result = await runtime.execute({
        scriptVersion: 1,
        contractVersion: 1,
        stateKey: "intake_terminal",
        inputs: runtime.defaultInputs("intake_terminal"),
        directive: { progressionPermission: "allowed" },
        mode: "validation_replay",
      });
      assert.equal(
        result.fieldResults.find((item) => item.key === "first_name").status,
        "verified",
      );
      assert.equal(
        result.fieldResults.find((item) => item.key === "terms").status,
        "unattempted",
      );
      assert.equal(result.progression.failureCode, "terminal_submission_blocked");
      assert.equal(fixture.submissions(), 0);

      const protectedAttempt = await runtime.execute({
        scriptVersion: 1,
        contractVersion: 1,
        stateKey: "intake_terminal",
        inputs: { terms: "yes" },
        directive: { progressionPermission: "forbidden" },
        mode: "validation_replay",
      });
      assert.equal(
        protectedAttempt.fieldResults.find((item) => item.key === "terms")
          .failureCode,
        "could_not_test",
      );
      assert.equal(fixture.submissions(), 0);
    } finally {
      await browser.close();
      await fixture.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  },
);

test("Gate 3 refuses mechanics that are not tied to the field's raw facts", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "formweave-gate3-bad-"));
  const value = proposal();
  value.mechanics.fieldTargets[0].selectors = ["#terms"];
  try {
    await assert.rejects(
      () =>
        compileAndStoreD1({
          dataRoot,
          proposal: value,
          observation: observation("http://127.0.0.1:9999/"),
          provenance: {
            model: "gate3-test-model",
            promptVersion: "gate2-semantic-state-v1",
          },
        }),
      /not tied to that field's observed DOM facts/,
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
