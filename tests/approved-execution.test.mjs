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
      step: "",
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
        field("birth_date", "Birth date", "date", {
          rawIdentity: { name: "dob" },
          browserConstraints: {
            rawType: "date",
            placeholder: "mm/dd/yyyy",
            autocomplete: "bday",
            inputMode: "",
            multiple: false,
          },
          validation: {
            pattern: "",
            min: "1900-01-01",
            max: "2099-12-31",
            step: "",
            minLength: "",
            maxLength: "",
          },
        }),
        field("appointment", "Appointment", "datetime-local"),
        field("email", "Email", "email"),
        field("website", "Website", "url"),
        field("month", "Month", "month"),
        field("week", "Week", "week"),
        field("time", "Time", "time"),
        field("amount", "Amount", "number", {
          validation: {
            pattern: "",
            min: "0",
            max: "100",
            step: "0.25",
            minLength: "",
            maxLength: "",
          },
        }),
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
  assert.equal(schema.properties.birth_date.format, "date");
  assert.equal(
    schema.properties.birth_date["x-formweave-input-format"],
    "YYYY-MM-DD",
  );
  assert.equal(
    schema.properties.birth_date["x-formweave-native-name"],
    "dob",
  );
  assert.equal(
    schema.properties.birth_date["x-formweave-browser-constraints"].max,
    "2099-12-31",
  );
  assert.equal(schema.properties.appointment.pattern.startsWith("^"), true);
  assert.equal(schema.properties.email.format, "email");
  assert.equal(schema.properties.website.format, "uri");
  assert.equal(schema.properties.month["x-formweave-input-format"], "YYYY-MM");
  assert.equal(schema.properties.week["x-formweave-input-format"], "YYYY-Www");
  assert.equal(schema.properties.time["x-formweave-input-format"], "HH:mm");
  assert.equal(schema.properties.amount.multipleOf, 0.25);
  assert.deepEqual(schema.properties.housing["x-formweave-options"], [
    { value: "rent", label: "Rent" },
    { value: "own", label: "Own" },
  ]);
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

test("approved input validation rejects browser-native format and step mismatches before actuation", () => {
  const malformedDate = validateApprovedInput(plan, {
    name: "Ada Example",
    birth_date: "12/14/1980",
    housing: "own",
    consent: true,
  });
  assert.equal(malformedDate.ok, false);
  assert.equal(malformedDate.issues[0].fieldKey, "birth_date");
  assert.match(malformedDate.issues[0].detail, /YYYY-MM-DD/);

  const malformedLocalDateTime = validateApprovedInput(plan, {
    name: "Ada Example",
    appointment: "2026-07-30 14:20",
    housing: "own",
    consent: true,
  });
  assert.equal(malformedLocalDateTime.ok, false);
  assert.equal(malformedLocalDateTime.issues[0].fieldKey, "appointment");

  const wrongStep = validateApprovedInput(plan, {
    name: "Ada Example",
    amount: 1.1,
    housing: "own",
    consent: true,
  });
  assert.equal(wrongStep.ok, false);
  assert.equal(wrongStep.issues[0].fieldKey, "amount");

  const browserCompatible = validateApprovedInput(plan, {
    name: "Ada Example",
    birth_date: "1980-12-14",
    appointment: "2026-07-30T14:20",
    email: "ada@example.org",
    website: "https://example.org/",
    month: "2026-07",
    week: "2026-W31",
    time: "14:20",
    amount: 1.25,
    housing: "own",
    consent: true,
  });
  assert.deepEqual(browserCompatible, { ok: true, issues: [] });
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
