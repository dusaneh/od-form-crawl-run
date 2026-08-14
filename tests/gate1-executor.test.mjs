import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import {
  D3_EXECUTION_MODES,
  createD3Executor,
} from "../local/executor/executor.mjs";
import {
  PhysicsToolbox,
  generatedUploadPayload,
} from "../local/executor/physics-toolbox.mjs";
import {
  alphanumericGist,
  scalarReadbackEquivalent,
} from "../local/executor/value-equivalence.mjs";
import { preparePageOnset } from "../local/executor/interaction-priming.mjs";
import {
  matchDeclaredState,
  observedIdentityKey,
} from "../local/executor/state-identity.mjs";
import { captureNovelStateInput } from "../local/semantic/novel-state-input.mjs";

const fixturePath = "C:\\pp2\\FCR_B\\server\\test\\fixtures\\form.html";

function required(kind = "never") {
  return { kind };
}

test("scalar readback compares the generic alphanumeric gist", () => {
  assert.equal(alphanumericGist(" AB-123 45 "), "ab12345");
  assert.equal(scalarReadbackEquivalent("AB12345", "AB-123 45"), true);
  assert.equal(scalarReadbackEquivalent("Test.User", "test user"), true);
  assert.equal(scalarReadbackEquivalent("AB12345", "AB-123 46"), false);
  assert.equal(scalarReadbackEquivalent("---", "..."), false);
  assert.equal(scalarReadbackEquivalent(true, "on"), true);
  assert.equal(scalarReadbackEquivalent(true, "checked"), true);
  assert.equal(scalarReadbackEquivalent(false, "off"), true);
  assert.equal(scalarReadbackEquivalent(false, "on"), false);
  assert.equal(scalarReadbackEquivalent(1, "on"), false);
  assert.equal(
    scalarReadbackEquivalent(["housing", "food"], ["food", "housing"]),
    true,
  );
  assert.equal(
    scalarReadbackEquivalent(
      "housing",
      { value: "housing", label: "Housing assistance" },
    ),
    true,
  );
});

test("writeControl accepts site-formatted scalar readback", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <label for="account">Account identifier</label>
      <input id="account" />
      <script>
        document.querySelector("#account").addEventListener("input", (event) => {
          const gist = event.target.value.replace(/[^a-z0-9]/gi, "");
          event.target.value = gist.length > 2
            ? gist.slice(0, 2) + "-" + gist.slice(2, 5) + " " + gist.slice(5)
            : gist;
        });
      </script>
    `);
    const toolbox = new PhysicsToolbox(page);
    const result = await toolbox.writeControl(
      { selectors: ["#account"] },
      "text",
      [],
      "AB12345",
    );
    assert.equal(await page.locator("#account").inputValue(), "AB-123 45");
    assert.equal(result.verified, true);
  } finally {
    await page.close();
    await browser.close();
  }
});

test("novel-state capture inventories an input-less rating widget in DOM order", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <label for="name">Name</label>
      <input id="name" name="name" />
      <h3>How satisfied are you?</h3>
      <div id="satisfaction" aria-label="Satisfaction rating">
        <span data-v="1">★</span>
        <span data-v="2">★</span>
        <span data-v="3">★</span>
        <span data-v="4">★</span>
        <span data-v="5">★</span>
      </div>
      <label for="notes">Notes</label>
      <textarea id="notes" name="notes"></textarea>
    `);
    const toolbox = new PhysicsToolbox(page);
    const captured = await captureNovelStateInput({ page, toolbox });
    const controls = captured.observation.controls;
    const rating = controls.find((item) => item.id === "satisfaction");
    assert.ok(rating);
    assert.equal(rating.virtual, true);
    assert.equal(rating.actuationEligible, false);
    assert.equal(rating.rawType, "custom");
    assert.equal(rating.rawLabel, "How satisfied are you?");
    assert.deepEqual(
      rating.options.map((item) => item.label),
      ["1 star", "2 stars", "3 stars", "4 stars", "5 stars"],
    );
    assert.ok(
      controls.findIndex((item) => item.id === "name") <
        controls.findIndex((item) => item.id === "satisfaction"),
    );
    assert.ok(
      controls.findIndex((item) => item.id === "satisfaction") <
        controls.findIndex((item) => item.id === "notes"),
    );
  } finally {
    await page.close();
    await browser.close();
  }
});

function field({
  key,
  rawLabel,
  controlType,
  options = [],
  isRequired = false,
  testValue,
}) {
  return {
    key,
    rawLabel,
    controlType,
    required: required(isRequired ? "always" : "never"),
    options,
    sectionKey: null,
    guidanceRefs: [],
    testValue,
    sensitive: false,
    administrative: false,
  };
}

function identity(visibleControlKeys, key, kind = "advance") {
  return {
    normalizedRoute: "/",
    visibleControlKeys: [...visibleControlKeys].sort(),
    progression: { key, kind },
  };
}

function fcrBContract(origin) {
  return {
    schemaVersion: 1,
    artifactId: "gate1-fcrb",
    artifactVersion: 1,
    contractVersion: 1,
    normalizedUrl: origin,
    locale: "en-US",
    entryStateKey: "page1_base",
    fields: [
      field({
        key: "first_name",
        rawLabel: "First name",
        controlType: "text",
        isRequired: true,
        testValue: "FORMWEAVE TEST",
      }),
      field({
        key: "housing_type",
        rawLabel: "Housing type",
        controlType: "radio",
        options: [
          { value: "apartment", label: "Apartment" },
          { value: "shelter", label: "Emergency shelter" },
        ],
        testValue: "shelter",
      }),
      field({
        key: "income",
        rawLabel: "Monthly income",
        controlType: "number",
        isRequired: true,
        testValue: "1200",
      }),
      field({
        key: "shelter_name",
        rawLabel: "Shelter name",
        controlType: "text",
        testValue: "FORMWEAVE TEST SHELTER",
      }),
    ],
    sections: [],
    guidance: [],
    states: [
      {
        key: "page1_base",
        kind: "form",
        order: 0,
        fieldKeys: ["first_name", "housing_type"],
        sectionKeys: [],
        expectedIdentity: identity(
          ["first_name", "housing_type"],
          "continue_base",
        ),
        progression: { key: "continue_base", kind: "advance" },
      },
      {
        key: "page1_shelter",
        kind: "form",
        order: 1,
        fieldKeys: ["first_name", "housing_type", "shelter_name"],
        sectionKeys: [],
        expectedIdentity: identity(
          ["first_name", "housing_type", "shelter_name"],
          "continue_shelter",
        ),
        progression: { key: "continue_shelter", kind: "advance" },
      },
      {
        key: "page2_terminal",
        kind: "terminal",
        order: 2,
        fieldKeys: ["income"],
        sectionKeys: [],
        expectedIdentity: identity(
          ["income"],
          "submit_application",
          "terminal_submit",
        ),
        progression: {
          key: "submit_application",
          kind: "terminal_submit",
        },
      },
    ],
    transitions: [
      {
        key: "base_to_shelter",
        fromStateKey: "page1_base",
        toStateKey: "page1_shelter",
        trigger: {
          kind: "choice",
          fieldKey: "housing_type",
          value: "shelter",
        },
      },
      {
        key: "base_to_page2",
        fromStateKey: "page1_base",
        toStateKey: "page2_terminal",
        trigger: { kind: "advance", fieldKey: null, value: null },
      },
      {
        key: "shelter_to_page2",
        fromStateKey: "page1_shelter",
        toStateKey: "page2_terminal",
        trigger: { kind: "advance", fieldKey: null, value: null },
      },
    ],
  };
}

function fcrBMechanics() {
  return {
    interfaceVersion: 1,
    artifactId: "gate1-fcrb",
    contractVersion: 1,
    scriptVersion: 1,
    fingerprintAlgorithmVersion: "recon-only",
    allowedSyntheticFieldKeys: [
      "first_name",
      "housing_type",
      "shelter_name",
      "income",
    ],
    protectedFieldKeys: [],
    fields: {
      first_name: { selectors: ['input[name="first_name"]'] },
      housing_type: { selectors: ['input[name="housing_type"]'] },
      shelter_name: { selectors: ['input[name="shelter_name"]'] },
      income: { selectors: ['input[name="income"]'] },
    },
    states: {
      page1_base: {
        progression: {
          key: "continue_base",
          kind: "advance",
          selectors: ["#continue"],
        },
      },
      page1_shelter: {
        progression: {
          key: "continue_shelter",
          kind: "advance",
          selectors: ["#continue"],
        },
      },
      page2_terminal: {
        progression: {
          key: "submit_application",
          kind: "terminal_submit",
          selectors: ["#submitBtn"],
        },
      },
    },
  };
}

async function serveFcrBFixture() {
  const html = await readFile(fixturePath, "utf8");
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test(
  "one D3 execute() path verifies FCR_B visibility transitions and blocks terminal submission",
  { timeout: 60_000 },
  async () => {
    const fixture = await serveFcrBFixture();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const evidence = [];
    try {
      await page.goto(fixture.origin);
      const contract = fcrBContract(fixture.origin);
      const executor = createD3Executor({
        page,
        contract,
        mechanics: fcrBMechanics(),
        evidenceSink: async ({ kind, metadata }) => {
          const ref = `test:evidence/${evidence.length + 1}/${kind}`;
          evidence.push({ ref, kind, metadata });
          return ref;
        },
      });

      assert.deepEqual(D3_EXECUTION_MODES, [
        "probe",
        "validation_replay",
        "fixture",
        "real_data",
      ]);

      const fixtureShape = await executor.execute({
        scriptVersion: 1,
        contractVersion: 1,
        stateKey: "page1_base",
        inputs: {},
        directive: { progressionPermission: "forbidden" },
        mode: "fixture",
      });
      assert.ok(
        fixtureShape.fieldResults.every(
          (result) => result.status === "unattempted",
        ),
      );

      const branch = await executor.execute({
        scriptVersion: 1,
        contractVersion: 1,
        stateKey: "page1_base",
        inputs: { housing_type: "shelter" },
        directive: {
          schemaVersion: 1,
          stateKey: "page1_base",
          fieldKey: "housing_type",
          value: "shelter",
          progressionPermission: "forbidden",
        },
        mode: "probe",
      });
      assert.equal(
        branch.fieldResults.find((result) => result.key === "housing_type")
          .status,
        "verified",
      );
      assert.equal(
        branch.fieldResults.find((result) => result.key === "first_name")
          .status,
        "unattempted",
      );
      assert.deepEqual(branch.observedStateIdentity.visibleControlKeys, [
        "first_name",
        "housing_type",
        "shelter_name",
      ]);
      assert.equal(
        matchDeclaredState(contract, branch.observedStateIdentity)?.key,
        "page1_shelter",
      );

      const advanced = await executor.execute({
        scriptVersion: 1,
        contractVersion: 1,
        stateKey: "page1_shelter",
        inputs: {
          first_name: "FORMWEAVE TEST",
          shelter_name: "FORMWEAVE TEST SHELTER",
        },
        directive: { progressionPermission: "allowed" },
        mode: "validation_replay",
      });
      assert.equal(advanced.progression.outcome, "confirmed");
      assert.equal(advanced.progression.confirmed, true);
      assert.equal(
        advanced.progression.matchedSuccessorStateKey,
        "page2_terminal",
      );
      assert.notEqual(
        observedIdentityKey(advanced.progression.beforeIdentity),
        observedIdentityKey(advanced.progression.afterIdentity),
      );
      assert.deepEqual(advanced.observedStateIdentity.visibleControlKeys, [
        "income",
      ]);

      const terminal = await executor.execute({
        scriptVersion: 1,
        contractVersion: 1,
        stateKey: "page2_terminal",
        inputs: { income: "1200" },
        directive: { progressionPermission: "allowed" },
        mode: "real_data",
      });
      assert.equal(terminal.fieldResults[0].status, "verified");
      assert.equal(terminal.stateOutcome, "blocked");
      assert.equal(terminal.progression.outcome, "blocked");
      assert.equal(
        terminal.progression.failureCode,
        "terminal_submission_blocked",
      );
      assert.equal(
        await page.locator('input[name="income"]').inputValue(),
        "1200",
      );
      await page.locator("#submitBtn").evaluate((element) => element.click());
      assert.equal(await page.getByText(/application was received/i).count(), 0);
      assert.ok(
        terminal.evidenceRefs.some((ref) => ref.includes("terminal_blocked")),
      );
      assert.ok(evidence.some((item) => item.kind === "before_advance"));
      assert.ok(evidence.some((item) => item.kind === "after_advance"));
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

test(
  "radio replay retargets a generated option-specific selector to the requested contract value",
  { timeout: 30_000 },
  async () => {
    const fixture = await serveFcrBFixture();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(fixture.origin);
      const toolbox = new PhysicsToolbox(page);
      const result = await toolbox.writeControl(
        {
          selectors: [
            'input[name="housing_type"][type="radio"][value="apartment"]',
          ],
        },
        "radio",
        ["apartment", "shelter"],
        "shelter",
      );
      assert.equal(result.verified, true);
      assert.equal(
        await page
          .locator('input[name="housing_type"][value="shelter"]')
          .isChecked(),
        true,
      );
      assert.equal(
        await page
          .locator('input[name="housing_type"][value="apartment"]')
          .isChecked(),
        false,
      );
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

test(
  "radio replay retargets an id-specific selector within the authored radio group",
  { timeout: 30_000 },
  async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(`<!doctype html>
        <input id="helper-yes" name="helper_group" type="radio" value="YES">
        <label for="helper-yes">YES</label>
        <input id="helper-no" name="helper_group" type="radio" value="NO">
        <label for="helper-no">NO</label>
      `);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const toolbox = new PhysicsToolbox(page);
      const result = await toolbox.writeControl(
        { selectors: ["#helper-yes"] },
        "radio",
        ["YES", "NO"],
        "NO",
      );
      assert.equal(result.verified, true);
      assert.equal(await page.locator("#helper-no").isChecked(), true);
      assert.equal(await page.locator("#helper-yes").isChecked(), false);
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test(
  "semantic sensing preserves collapsed disclosures until a declared action opens them",
  { timeout: 30_000 },
  async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(`<!doctype html>
        <style>
          .choice input { position: absolute; opacity: 0; width: 1px; height: 1px; }
          #program-fields { display: none; }
        </style>
        <div class="choice">
          <input id="qual-income" name="qual" type="radio" value="Income">
          <label for="qual-income">Income</label>
          <input id="qual-program" name="qual" type="radio" value="Program"
            onchange="document.querySelector('#program-fields').style.display = 'block'">
          <label for="qual-program">Program</label>
        </div>
        <div id="program-fields" class="choice">
          <input id="prog-snap" name="prog_snap" type="checkbox" value="yes">
          <label for="prog-snap">SNAP</label>
        </div>
        <details>
          <summary>Eligibility questions</summary>
          <input id="closed-detail-field" name="closed_detail_field" type="text">
        </details>
        <div id="custom-accordion" aria-expanded="false"
          onclick="this.setAttribute('aria-expanded', 'true'); this.nextElementSibling.style.display = 'block'">
          Optional schedule
        </div>
        <div style="display:none">
          <select id="custom-hidden-field" name="custom_hidden_field"><option>Morning</option></select>
        </div>
        <input id="semantic-submit" type="submit" value="Send application">
      `);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const toolbox = new PhysicsToolbox(page);
      const before = await captureNovelStateInput({ page, toolbox });
      assert.equal(
        before.observation.controls.find((field) => field.id === "qual-program")
          ?.visible,
        true,
      );
      assert.equal(
        before.observation.controls.find((field) => field.id === "prog-snap")
          ?.visible,
        false,
      );
      assert.equal(
        before.observation.controls.find(
          (field) => field.id === "closed-detail-field",
        )?.visible,
        false,
      );
      assert.equal(
        before.observation.actions.find(
          (action) =>
            action.tag === "summary" &&
            action.rawText === "Eligibility questions" &&
            action.visible,
        )?.disclosureExpanded,
        false,
      );
      const customField = before.observation.controls.find(
        (field) => field.id === "custom-hidden-field",
      );
      const customDisclosure = before.observation.actions.find(
        (action) => action.rawText === "Optional schedule",
      );
      assert.equal(customField?.visible, false);
      assert.equal(customDisclosure?.disclosureExpanded, false);
      assert.deepEqual(customDisclosure?.blockedControlFactIds, [
        customField.factId,
      ]);
      assert.equal(
        before.observation.controls.some(
          (field) => field.id === "semantic-submit",
        ),
        false,
      );
      assert.equal(
        before.observation.actions.find(
          (action) => action.rawText === "Send application",
        )?.rawType,
        "submit",
      );
      const result = await toolbox.writeControl(
        { selectors: ["#qual-income"] },
        "radio",
        ["Income", "Program"],
        "Program",
      );
      assert.equal(result.verified, true);
      const after = await captureNovelStateInput({ page, toolbox });
      assert.equal(
        after.observation.controls.find((field) => field.id === "prog-snap")
          ?.visible,
        true,
      );
      const disclosureAction = await toolbox.clickAction({
        selectors: ["details > summary"],
      });
      assert.equal(disclosureAction.clicked, true);
      const expanded = await captureNovelStateInput({ page, toolbox });
      assert.equal(
        expanded.observation.actions.find(
          (action) => action.tag === "summary",
        )?.disclosureExpanded,
        true,
      );
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test(
  "choice actuation crosses a styled-label overlay but refuses a hidden control",
  { timeout: 30_000 },
  async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(`<!doctype html>
        <style>
          .choice { position: relative; display: block; width: 220px; height: 40px; }
          .choice input { position: absolute; inset: 8px auto auto 8px; }
          .choice label { position: absolute; inset: 0; z-index: 2; }
        </style>
        <div class="choice">
          <input id="visible-choice" name="choice" type="radio" value="visible">
          <label for="visible-choice">Visible choice</label>
        </div>
        <input id="hidden-choice" name="hidden_choice" type="checkbox" hidden>
      `);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const toolbox = new PhysicsToolbox(page);
      const visible = await toolbox.writeControl(
        { selectors: ['input[name="choice"]'] },
        "radio",
        ["visible"],
        "visible",
      );
      assert.equal(visible.verified, true);
      assert.equal(await page.locator("#visible-choice").isChecked(), true);

      const hidden = await toolbox.writeControl(
        { selectors: ["#hidden-choice"] },
        "checkbox",
        ["false", "true"],
        true,
      );
      assert.equal(hidden.verified, false);
      assert.equal(hidden.failureCode, "actuation_unverified");
      assert.match(hidden.detail, /not currently visible/i);
      assert.equal(await page.locator("#hidden-choice").isChecked(), false);
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test("generated upload payloads obey observed type and size constraints", () => {
  const pdf = generatedUploadPayload({
    accept: "application/pdf,.pdf",
    maxFiles: 1,
    maxSize: "2 MB",
  });
  assert.equal(pdf.ok, true);
  assert.equal(pdf.mimeType, "application/pdf");
  assert.match(pdf.name, /^formweave-test-upload\.pdf$/);
  assert.ok(pdf.byteLength > 0);

  const unsupported = generatedUploadPayload({ accept: ".exe" });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.failureCode, "type_mismatch");

  const tooSmall = generatedUploadPayload({
    accept: "application/pdf",
    maxSize: "1 byte",
  });
  assert.equal(tooSmall.ok, false);
  assert.equal(tooSmall.failureCode, "type_mismatch");
});

test(
  "upload replay creates a harmless in-memory file and verifies browser metadata",
  { timeout: 30_000 },
  async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(`<!doctype html>
        <label for="document">Supporting document</label>
        <input id="document" name="document" type="file"
          accept="application/pdf" hidden>
      `);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const toolbox = new PhysicsToolbox(page);
      const result = await toolbox.uploadGeneratedFile(
        { selectors: ["#document"] },
        {
          accept: "application/pdf",
          maxFiles: 1,
          maxSize: "2 MB",
        },
      );
      assert.equal(result.verified, true);
      assert.deepEqual(result.readback, {
        marker: "[generated harmless upload]",
        name: "formweave-test-upload.pdf",
        fileCount: 1,
        mimeType: "application/pdf",
        byteLength: result.readback.byteLength,
        synthetic: true,
      });
      assert.ok(result.readback.byteLength > 0);
      assert.equal(result.readback.name, "formweave-test-upload.pdf");
      assert.equal("path" in result.readback, false);
      assert.deepEqual(
        await page.locator("#document").evaluate((element) =>
          [...element.files].map((file) => ({
            name: file.name,
            type: file.type,
            size: file.size,
          })),
        ),
        [
          {
            name: "formweave-test-upload.pdf",
            type: "application/pdf",
            size: result.readback.byteLength,
          },
        ],
      );
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test("script-declared inactive branch cleanup clears hidden native controls", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <form>
        <input id="inactive_text" name="inactive_text" value="old branch value" hidden>
        <input id="inactive_check" name="inactive_check" type="checkbox" checked hidden>
      </form>
    `);
    const toolbox = new PhysicsToolbox(page);
    assert.equal(
      (
        await toolbox.clearControl(
          { selectors: ["#inactive_text"] },
          "text",
        )
      ).verified,
      true,
    );
    assert.equal(
      (
        await toolbox.clearControl(
          { selectors: ["#inactive_check"] },
          "checkbox",
        )
      ).verified,
      true,
    );
    assert.equal(await page.locator("#inactive_text").inputValue(), "");
    assert.equal(await page.locator("#inactive_check").isChecked(), false);
  } finally {
    await browser.close();
  }
});

test("page onset moves and document-scrolls without actuating disclosures or nested application regions", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  try {
    await page.setContent(`<!doctype html>
      <style>
        body { margin: 0; }
        .tall { height: 1800px; }
        #scrollbox { height: 100px; overflow-y: auto; }
        #scrollbox > div { height: 600px; }
      </style>
      <script>
        window.pointerMoves = 0;
        window.documentScrolls = 0;
        addEventListener("mousemove", () => window.pointerMoves += 1);
        addEventListener("scroll", () => window.documentScrolls += 1);
      </script>
      <div class="tall">
        <details id="main-details" ontoggle="window.mainDetailToggles = (window.mainDetailToggles || 0) + 1">
          <summary>Main disclosure</summary>
          <p>Revealed details</p>
        </details>
        <button id="aria-disclosure" aria-expanded="false" aria-controls="aria-panel"
          onclick="this.setAttribute('aria-expanded', 'true'); document.querySelector('#aria-panel').hidden = false; window.ariaClicks = (window.ariaClicks || 0) + 1">
          More information
        </button>
        <div id="aria-panel" hidden>Revealed information</div>
        <a id="fragment-disclosure" href="#fragment-panel" aria-expanded="false" aria-controls="fragment-panel"
          onclick="event.preventDefault(); this.setAttribute('aria-expanded', 'true'); document.querySelector('#fragment-panel').hidden = false; window.fragmentClicks = (window.fragmentClicks || 0) + 1">
          Eligibility details
        </a>
        <div id="fragment-panel" hidden>More eligibility information</div>
        <a id="navigational-anchor" href="/about/our-story/" aria-expanded="false"
          onclick="event.preventDefault(); window.navigationalClicks = (window.navigationalClicks || 0) + 1">
          About Us
        </a>
        <nav>
          <a id="navigation-menu" href="#" aria-expanded="false"
            onclick="event.preventDefault(); this.setAttribute('aria-expanded', 'true'); window.navigationMenuClicks = (window.navigationMenuClicks || 0) + 1">
            Services
          </a>
        </nav>
        <div id="scrollbox" onscroll="window.containerScrolls = (window.containerScrolls || 0) + 1">
          <div>nested</div>
        </div>
      </div>
      <iframe srcdoc="<style>body{height:1400px}</style><script>window.frameScrolls=0;window.frameDetailToggles=0;addEventListener('scroll',()=>window.frameScrolls+=1)<\/script><details ontoggle='window.frameDetailToggles += 1'><summary>Frame disclosure</summary>frame details</details>"></iframe>
    `);
    await page.waitForTimeout(50);
    const result = await preparePageOnset(page);
    assert.equal(result.pageOnsetPerformed, true);
    assert.equal(result.pointerMoves, 5);
    assert.ok(result.pointerSamples >= 50);
    assert.ok(result.pointerDurationMs >= 1_000);
    assert.equal(result.pointerMotionProfile, "deterministic_varied_easing");
    assert.ok(result.framesPrimed >= 2);
    assert.ok(result.documentScrollSteps > 0);
    assert.equal(result.scrollSurfacesPrimed, 0);
    assert.ok(result.scrollSurfacesDeferred > 0);
    assert.equal(result.detailsOpened, 0);
    assert.equal(result.disclosureButtonsOpened, 0);
    assert.equal(await page.locator("#main-details").getAttribute("open"), null);
    assert.equal(
      await page.locator("#aria-disclosure").getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      await page.locator("#fragment-disclosure").getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(await page.evaluate(() => window.fragmentClicks || 0), 0);
    assert.equal(
      await page.evaluate(() => window.navigationalClicks || 0),
      0,
    );
    assert.equal(
      await page.evaluate(() => window.navigationMenuClicks || 0),
      0,
    );
    const toolbox = new PhysicsToolbox(page);
    const captured = await captureNovelStateInput({ page, toolbox });
    assert.equal(
      captured.observation.actions.find(
        (action) => action.rawText === "Eligibility details",
      )?.disclosureControl,
      true,
    );
    assert.equal(
      captured.observation.actions.find(
        (action) => action.rawText === "About Us",
      )?.disclosureControl,
      false,
    );
    assert.equal(
      captured.observation.actions.find(
        (action) => action.rawText === "Services",
      )?.disclosureControl,
      false,
    );
    const deferredScrollRegion = captured.observation.scrollRegions.find(
      (region) => region.selectorCandidates.includes("#scrollbox"),
    );
    assert.equal(deferredScrollRegion?.atEnd, false);
    assert.equal(deferredScrollRegion?.scrollTop, 0);
    assert.equal(deferredScrollRegion?.textExcerpt, "nested");
    assert.ok((await page.evaluate(() => window.pointerMoves)) >= 5);
    assert.ok((await page.evaluate(() => window.documentScrolls)) > 0);
    assert.equal(await page.evaluate(() => window.containerScrolls || 0), 0);
    const childFrame = page.frames().find((frame) => frame !== page.mainFrame());
    assert.ok(await childFrame.evaluate(() => window.frameScrolls > 0));
    assert.equal(await childFrame.locator("details").getAttribute("open"), null);

    const second = await preparePageOnset(page);
    assert.equal(second.pageOnsetPerformed, false);
    assert.equal(second.pointerMoves, 0);
    assert.equal(await page.evaluate(() => window.ariaClicks || 0), 0);
    assert.equal(await page.evaluate(() => window.mainDetailToggles || 0), 0);
    assert.equal(await childFrame.evaluate(() => window.frameDetailToggles), 0);

    await page.goto(
      "data:text/html,<title>Second document</title><details><summary>Next disclosure</summary>next</details>",
    );
    const nextDocument = await preparePageOnset(page);
    assert.equal(nextDocument.pageOnsetPerformed, true);
    assert.equal(nextDocument.detailsOpened, 0);
    assert.equal(await page.locator("details").getAttribute("open"), null);
  } finally {
    await browser.close();
  }
});

test("page-onset priming reports a verified interaction-gate reveal", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>#application { display: none; }</style>
      <script>
        addEventListener("mousemove", () => {
          document.querySelector("#application").style.display = "block";
        }, { once: true });
      </script>
      <form id="application">
        <label for="full-name">Full name</label>
        <input id="full-name" name="full_name">
      </form>
    `);
    const result = await preparePageOnset(page);
    assert.equal(result.interactionGatePrepared, true);
    assert.equal(result.revealedForms, 1);
    assert.equal(result.revealedApplicantControls, 1);
    assert.equal(await page.locator("#application").isVisible(), true);
  } finally {
    await browser.close();
  }
});

test("Gate 1 executor boundary contains no site-specific or semantic-label API", async () => {
  const files = [
    "local/executor/executor.mjs",
    "local/executor/physics-toolbox.mjs",
    "local/executor/interaction-priming.mjs",
    "local/executor/state-identity.mjs",
  ];
  const source = (
    await Promise.all(
      files.map((file) => readFile(path.resolve(file), "utf8")),
    )
  ).join("\n");
  assert.doesNotMatch(
    source,
    /stayhoused|united\s*way|pge|energyinsight|housing_type|shelter_name/i,
  );
  assert.doesNotMatch(source, /getByLabel|findByLabel|resolveByLabel/);
  assert.doesNotMatch(source, /if\s*\([^)]*hostname/i);
  assert.doesNotMatch(source, /\bfingerprint\s*\(/i);
  assert.doesNotMatch(
    source,
    /(?:async\s+)?(?:resolveUnique|writeControl|clearControl|clickAction|isVisible)\s*\([^)]*\blabel\b/i,
  );

  const physicsSource = await readFile(
    path.resolve("local/executor/physics-toolbox.mjs"),
    "utf8",
  );
  const prepareBody = physicsSource.slice(
    physicsSource.indexOf("async prepare()"),
    physicsSource.indexOf("async installRequestGuard()"),
  );
  assert.doesNotMatch(
    prepareBody,
    /\.click\s*\(|\.check\s*\(|\.uncheck\s*\(|selectOption\s*\(|details\.open|dispatchEvent\s*\(\s*new Event\s*\(\s*["']toggle/i,
    "Physics preparation may sense and scroll, but must not decide or actuate controls.",
  );
});
