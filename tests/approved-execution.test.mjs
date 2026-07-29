import assert from "node:assert/strict";
import test from "node:test";

import {
  approvedInputSchemaForPlan,
  redactApprovedObservationText,
  validateApprovedInput,
} from "../local/production-generated-traversal.mjs";

function field(key, label, controlType, overrides = {}) {
  return {
    key,
    label,
    controlType,
    required: false,
    sensitive: false,
    options: [],
    validation: {
      pattern: "",
      min: "",
      max: "",
      minLength: "",
      maxLength: "",
    },
    upload: {},
    ...overrides,
  };
}

const plan = {
  states: [
    {
      fields: [
        field("name", "Full name", "text", { required: true }),
        field("housing", "Housing", "radio", {
          required: true,
          options: [
            { value: "rent", label: "Rent" },
            { value: "own", label: "Own" },
          ],
        }),
        field("consent", "Consent", "checkbox", {
          required: true,
          legalAcceptanceType: "consent",
        }),
        field("document", "Document", "file", {
          upload: { accept: ".pdf" },
        }),
      ],
      choiceCoverage: [
        {
          fieldKey: "housing",
          value: "rent",
          classification: "same_page_branch",
          variantPlan: {
            fields: [
              field("landlord", "Landlord", "text", { required: true }),
            ],
            choiceCoverage: [],
          },
        },
      ],
    },
  ],
};

test("approved input schema exposes legal, upload, and conditional branch contracts", () => {
  const schema = approvedInputSchemaForPlan(plan);
  assert.deepEqual(schema.required, ["consent", "housing", "name"]);
  assert.equal(
    schema.properties.consent["x-formweave-legal-acceptance-type"],
    "consent",
  );
  assert.equal(
    schema.properties.document["x-formweave-upload-constraints"].accept,
    ".pdf",
  );
  assert.deepEqual(schema.properties.landlord["x-formweave-branch"], {
    fieldKey: "housing",
    value: "rent",
    classification: "same_page_branch",
  });
  assert.deepEqual(schema.allOf[0].then.required, ["landlord"]);
});

test("approved input validation fails closed outside the crawled branch and file contract", () => {
  const missingBranch = validateApprovedInput(plan, {
    name: "Ada Example",
    housing: "rent",
    consent: true,
  });
  assert.equal(missingBranch.ok, false);
  assert.equal(missingBranch.issues[0].fieldKey, "landlord");

  const inactiveBranch = validateApprovedInput(plan, {
    name: "Ada Example",
    housing: "own",
    landlord: "Not active",
    consent: true,
  });
  assert.equal(inactiveBranch.ok, false);
  assert.equal(inactiveBranch.issues[0].code, "outside_certified_branch");

  const wrongFile = validateApprovedInput(plan, {
    name: "Ada Example",
    housing: "rent",
    landlord: "Test Landlord",
    consent: true,
    document: {
      filename: "test.exe",
      contentType: "application/octet-stream",
      contentBase64: Buffer.from("test").toString("base64"),
    },
  });
  assert.equal(wrongFile.ok, false);
  assert.equal(wrongFile.issues[0].fieldKey, "document");

  const accepted = validateApprovedInput(plan, {
    name: "Ada Example",
    housing: "rent",
    landlord: "Test Landlord",
    consent: true,
    document: {
      filename: "test.pdf",
      contentType: "application/pdf",
      contentBase64: Buffer.from("%PDF test").toString("base64"),
    },
  });
  assert.deepEqual(accepted, { ok: true, issues: [] });
});

test("approved result context redacts raw and URL-encoded client values", () => {
  const input = "Ada Example";
  const observed =
    "https://example.test/success?name=Ada+Example&raw=Ada%20Example Ada Example";
  const redacted = redactApprovedObservationText(observed, [input]);
  assert.equal(redacted.includes(input), false);
  assert.equal(redacted.includes("Ada+Example"), false);
  assert.equal(redacted.includes("Ada%20Example"), false);
  assert.match(redacted, /\[REDACTED\]/);
});
