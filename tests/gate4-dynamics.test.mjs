import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { chromium } from "playwright";

import { aggregateChangeMap } from "../local/dynamics/change-map.mjs";
import { buildRepairQueue } from "../local/dynamics/repair-queue.mjs";
import { createD3Executor } from "../local/executor/executor.mjs";

async function fixture() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <label for="status">Discharge status</label>
      <select id="status" name="discharge_status">
        <option value="honorable">Honorable</option>
        <option value="other">Other</option>
      </select>
      <div id="branch" style="display:none">
        <label for="rating">Disability rating</label>
        <input id="rating" name="disability_rating" type="number">
      </div>
      <button id="submit" type="submit">Submit</button>
      <script>
        const statusControl = document.getElementById("status");
        const branchControl = document.getElementById("branch");
        statusControl.addEventListener("change", () => {
          branchControl.style.display =
            statusControl.value === "other" ? "block" : "none";
        });
      </script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("Gate 4 emits D6 facts for a visibility-only branch and prioritizes repair", async () => {
  const site = await fixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(site.url);
    const contract = {
      schemaVersion: 1,
      artifactId: "gate4-fixture",
      artifactVersion: 1,
      contractVersion: 1,
      normalizedUrl: site.url,
      locale: "en-US",
      entryStateKey: "terminal",
      fields: [
        {
          key: "discharge_status",
          rawLabel: "Discharge status",
          controlType: "select",
          required: { kind: "never" },
          options: [
            { value: "honorable", label: "Honorable" },
            { value: "other", label: "Other" },
          ],
          sectionKey: null,
          guidanceRefs: [],
          testValue: "honorable",
          sensitive: false,
          administrative: false,
        },
      ],
      sections: [],
      guidance: [],
      states: [
        {
          key: "terminal",
          kind: "terminal",
          order: 0,
          fieldKeys: ["discharge_status"],
          sectionKeys: [],
          expectedIdentity: {
            normalizedRoute: "/",
            visibleControlKeys: ["discharge_status"],
            progression: { key: "submit", kind: "terminal_submit" },
          },
          progression: { key: "submit", kind: "terminal_submit" },
        },
      ],
      transitions: [],
    };
    const mechanics = {
      interfaceVersion: 1,
      artifactId: "gate4-fixture",
      contractVersion: 1,
      scriptVersion: 1,
      fields: {
        discharge_status: { selectors: ["#status"] },
      },
      states: {
        terminal: {
          progression: {
            key: "submit",
            kind: "terminal_submit",
            selectors: ["#submit"],
          },
        },
      },
      allowedSyntheticFieldKeys: ["discharge_status"],
      protectedFieldKeys: [],
    };
    const executor = createD3Executor({ page, contract, mechanics });
    const observation = await executor.probeChoice({
      stateKey: "terminal",
      fieldKey: "discharge_status",
      value: "other",
    });
    const added = observation.delta.addedFactIds.map((factId) =>
      observation.after.controls.find((fact) => fact.factId === factId),
    );
    assert.ok(
      added.some(
        (fact) => fact.name === "disability_rating" && fact.visible === true,
      ),
    );
    const changeMap = aggregateChangeMap([observation]);
    const queue = buildRepairQueue({
      proposal: {
        fields: [
          {
            key: "legal_issue",
            rawLabel: "Type of legal issue",
            required: true,
          },
        ],
        rationale: [
          {
            subjectKey: "legal_issue",
            confidence: "high",
          },
        ],
        proposedActions: [],
      },
      safety: { rejections: [] },
      changeMap,
    });
    assert.ok(
      queue.items.some(
        (item) =>
          item.subjectKey === "disability_rating" &&
          item.reason === "branch_added_control",
      ),
    );
    assert.ok(
      queue.items.some(
        (item) =>
          item.subjectKey === "legal_issue" &&
          item.reason === "noncanonical_binding" &&
          item.confidence === "high",
      ),
    );
  } finally {
    await browser.close();
    await site.close();
  }
});
