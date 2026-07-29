import assert from "node:assert/strict";
import test from "node:test";

import { classifyFieldSafety } from "../local/test-values.mjs";

test("credentials and payment controls always require human review", () => {
  const unsafe = [
    {
      type: "password",
      label: "Password",
      name: "password",
      autocomplete: "current-password",
    },
    {
      type: "text",
      label: "Card Number",
      name: "card_number",
      autocomplete: "cc-number",
    },
    {
      type: "text",
      label: "Security Code (CVV)",
      name: "card_cvv",
    },
    {
      type: "text",
      label: "Username or Email",
      name: "username",
    },
    {
      type: "text",
      label: "Applicant Signature",
      name: "signature",
    },
  ];

  for (const descriptor of unsafe) {
    assert.equal(
      classifyFieldSafety(descriptor).classification,
      "human_review",
      `${descriptor.label} must never be automatically populated`
    );
  }
});

test("ordinary synthetic fixture fields remain deterministic", () => {
  assert.equal(
    classifyFieldSafety({
      type: "email",
      label: "Applicant Email",
      name: "email",
    }).classification,
    "deterministic"
  );
});
