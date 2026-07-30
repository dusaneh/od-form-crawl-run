import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRunnerJourney,
  humanizeActionKey,
} from "../local/report-runner-journey.mjs";

test("runner journey renders ordered LLM-authored states, fields, branches, and submit", () => {
  const plan = {
    artifactId: "form_fixture",
    scriptVersion: 4,
    states: [
      {
        state: {
          key: "cookie_gate",
          description: "Cookie notice",
          route: "/apply",
        },
        fields: [],
        sections: [],
        progression: {
          key: "site_fixture_accept_cookies",
          kind: "advance",
          rationale: "The cookie notice blocks the application.",
        },
      },
      {
        state: {
          key: "application",
          description: "Applicant information",
          route: "/apply",
        },
        sections: [{ key: "applicant", label: "Applicant details" }],
        fields: [
          {
            key: "full_name",
            label: "Full name",
            controlType: "text",
            required: true,
            sectionKey: "applicant",
            actuate: true,
            safetyAuthority: "accepted_model_action",
          },
          {
            key: "housing_type",
            label: "Housing type",
            controlType: "select",
            required: true,
            sectionKey: "applicant",
            actuate: true,
            safetyAuthority: "accepted_model_action",
          },
          {
            key: "consent",
            label: "I consent",
            controlType: "checkbox",
            required: true,
            sectionKey: "applicant",
            actuate: true,
            safetyAuthority: "accepted_model_action:fixture_consent",
          },
        ],
        choiceCoverage: [
          {
            fieldKey: "housing_type",
            value: "rent",
            variantPlan: {
              sections: [{ key: "housing", label: "Rental details" }],
              fields: [
                {
                  key: "monthly_rent",
                  label: "Monthly rent",
                  controlType: "number",
                  required: true,
                  sectionKey: "housing",
                  actuate: true,
                  safetyAuthority: "accepted_model_action",
                },
              ],
            },
          },
        ],
        progression: {
          key: "site_fixture_submit_application",
          kind: "terminal_submit",
          rationale: "This is the declared terminal submission control.",
        },
      },
    ],
  };
  const exchanges = [
    {
      stateKey: "cookie_gate",
      script: { progression: { label: "Accept necessary cookies" } },
      execution: { progressionOutcome: "state_transition_verified" },
    },
    {
      stateKey: "application",
      script: { progression: { label: "Submit application" } },
      execution: { progressionOutcome: "terminal_boundary_reached" },
    },
  ];

  const journey = buildRunnerJourney(
    { pages: [], executionMode: "probe" },
    exchanges,
    plan,
  );

  assert.equal(journey.available, true);
  assert.equal(journey.source, "llm_authored_script");
  assert.equal(journey.stateCount, 2);
  assert.equal(journey.fieldCount, 4);
  assert.equal(journey.terminalActionCount, 1);
  assert.match(journey.summary, /follow 2 ordered states/i);
  assert.match(
    journey.steps[0].progression.instruction,
    /clear the cookie notice/i,
  );
  assert.match(
    journey.steps[1].fields[0].instruction,
    /Enter the submitted value.*Full name.*required/i,
  );
  assert.match(
    journey.steps[1].fields[2].instruction,
    /requested consent/i,
  );
  assert.match(
    journey.steps[1].conditionalGroups[0].condition.instruction,
    /Housing type.*rent/i,
  );
  assert.match(
    journey.steps[1].progression.instruction,
    /Submit application.*submit the completed form/i,
  );
});

test("runner journey fails plainly when no generated script is available", () => {
  const journey = buildRunnerJourney({ pages: [] }, [], null);
  assert.equal(journey.available, false);
  assert.deepEqual(journey.steps, []);
  assert.match(journey.summary, /No executable LLM-authored script/i);
});

test("semantic action keys become concise human labels", () => {
  assert.equal(
    humanizeActionKey("site_b_legalaid_home_open_intake"),
    "Open intake",
  );
  assert.equal(
    humanizeActionKey("site_a_shelter_step_2_submit_application"),
    "Submit application",
  );
});
