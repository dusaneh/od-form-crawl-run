# FormWeave API quick start

This guide covers the common end-to-end workflow:

1. crawl a form;
2. poll the crawl;
3. inspect its report and screenshot evidence;
4. retrieve the client input schema;
5. approve the exact crawled form;
6. populate it without submission, or explicitly submit it;
7. poll the execution result.

The examples use PowerShell and the local API at `http://127.0.0.1:8787`.
They intentionally show the shortest useful path. See the linked OpenAPI
contracts for every field and error.

## Before you start

Start FormWeave from the repository root:

```powershell
.\restart-formweave.bat
```

Then confirm the API is online:

```powershell
$base = "http://127.0.0.1:8787"
Invoke-RestMethod "$base/api/health"
```

The current service is local and does not implement API authentication. Treat
it as a development service: do not expose port `8787` to an untrusted network.

## 1. Start a crawl

This public-form example traverses toward the terminal boundary but does not
submit:

```powershell
$crawlRequest = @{
  urls = @("https://example.org/application")
  name = "Example application"
  mode = "probe"
  browserMode = "headless"
  discoverRelatedPages = $false
} | ConvertTo-Json

$createdCrawl = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/api/runs" `
  -ContentType "application/json" `
  -Body $crawlRequest

$crawlId = $createdCrawl.run.id
$crawlId
```

`201 Created` means the crawl was queued; it does not mean it succeeded. Each
crawl gets a unique `run_...` ID. Every successfully registered form in a
recrawl also gets a new crawl-scoped `form_...` ID.

For every start-crawl option, see
[Start Crawl OpenAPI](./openapi-crawl-start.json).

## 2. Poll crawl status

Poll the exact crawl ID returned by the kickoff call:

```powershell
do {
  Start-Sleep -Seconds 2
  $crawl = (Invoke-RestMethod "$base/api/runs/$crawlId").run
  $crawl | Select-Object id, status, progress, failureCode, detail
} while ($crawl.status -notin @(
  "completed",
  "awaiting_review",
  "disqualified",
  "certified",
  "failed"
))
```

The status summary is intentionally compact. It does **not** return the complete
field contract or all evidence metadata. Fetch the report after completion.

See [Check Crawl OpenAPI](./openapi-crawl-status.json) for the status response.

## 3. Get the report and evidence

```powershell
$report = Invoke-RestMethod "$base/api/runs/$crawlId/report"
```

Review at least:

- `contract` and page field metadata;
- `formDefinitions`;
- flow/state information and findings;
- eligibility or disqualification reasons;
- generated-script identity and version;
- state-transition evidence.

Each available page or state screenshot contains an `evidence` URL. For
example, list the state screenshots:

```powershell
$evidence = $report.pages |
  ForEach-Object { $_.stateEvidence } |
  Where-Object { $_.evidenceAvailable }

$evidence | Select-Object id, kind, evidence
```

Download one by following the exact URL returned by the report:

```powershell
$evidencePath = $evidence[0].evidence
$evidenceUri = if ($evidencePath -match "^https?://") {
  $evidencePath
} else {
  "$base$evidencePath"
}

Invoke-WebRequest $evidenceUri -OutFile ".\crawl-evidence.png"
```

Evidence should be reviewed as proof of entered values and successful state
transitions, not merely as page snapshots. The local UI at
`http://127.0.0.1:3000` provides a more convenient report viewer.

## 4. Select a form and get its input schema

A completed crawl may identify more than one form. Select the intended
definition rather than assuming the first one:

```powershell
$report.formDefinitions |
  Select-Object formId, title, targetUrl, status, eligibility
```

For a single-form crawl:

```powershell
$formId = $report.formDefinitions[0].formId
$formResponse = Invoke-RestMethod "$base/api/forms/$formId"
$form = $formResponse.form
$schema = $form.inputSchema

$schema.properties | ConvertTo-Json -Depth 20
$schema.required
```

Build your client form and execution payload from this exact `inputSchema`:

- use the exact property keys;
- honor property types and enums;
- honor the base `required` list;
- evaluate `allOf` conditional requirements for supported same-page branches;
- use FormWeave annotations such as `x-formweave-label`,
  `x-formweave-control`, `x-formweave-sensitive`, and legal-acceptance or
  branch metadata;
- represent file values with `filename`, `contentType`, and `contentBase64`.

Do not reuse a schema from an older crawl with a newly generated `formId`.

See
[Report, Schema, and Screenshots OpenAPI](./openapi-crawl-artifacts.json).

## 5. Review and approve the exact form

Before approval, a human or trusted review service should compare the report,
flow, schema, warnings, script identity, and screenshot evidence with the
source form. Then approve or reject this exact `formId`:

```powershell
$approvalRequest = @{
  decision = "approved"
  actor = "operator@example.test"
  notes = "Schema, flow, eligibility, and transition evidence reviewed."
} | ConvertTo-Json

$approval = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/api/forms/$formId/approval" `
  -ContentType "application/json" `
  -Body $approvalRequest
```

Approval pins the exact generated-script artifact, version, and source hash.
Recrawling creates a new `formId` and requires a new decision.

See [Approve or Reject Form OpenAPI](./openapi-form-approval.json).

`PATCH /api/runs/{runId}` with `request_review` is **not** approval. It is a
legacy status marker with no reviewer queue or certification workflow behind
it.

## 6. Run using the returned schema

Construct `data` from the exact schema. The keys below are illustrative; real
keys come from `$schema.properties`.

Start with `submit = $false` to populate and verify without activating the
terminal action:

```powershell
$formData = @{
  first_name = "Alex"
  email = "alex@example.test"
  service_requested = "Housing navigation"
  terms_accepted = $true
}

$runRequest = @{
  data = $formData
  submit = $false
  browserMode = "headless"
} | ConvertTo-Json -Depth 20

$createdExecution = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/api/forms/$formId/runs" `
  -ContentType "application/json" `
  -Body $runRequest

$executionId = $createdExecution.execution.executionId
```

When you intend to submit, send the same shape with `submit = $true`.
Submission authority is explicit and is never inferred:

```powershell
$liveRequest = @{
  data = $formData
  submit = $true
  browserMode = "headless"
} | ConvertTo-Json -Depth 20

$createdExecution = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/api/forms/$formId/runs" `
  -ContentType "application/json" `
  -Body $liveRequest

$executionId = $createdExecution.execution.executionId
```

For a file field declared by the schema:

```powershell
$bytes = [System.IO.File]::ReadAllBytes("C:\path\supporting-document.pdf")
$formData.supporting_document = @{
  filename = "supporting-document.pdf"
  contentType = "application/pdf"
  contentBase64 = [Convert]::ToBase64String($bytes)
}
```

The focused run/insert contract is
[Run Approved Form OpenAPI](./openapi-form-run.json).

## 7. Poll the execution

```powershell
do {
  Start-Sleep -Seconds 2
  $executionResponse = Invoke-RestMethod "$base/api/executions/$executionId"
  $execution = $executionResponse.execution
  $execution |
    Select-Object status, outcome, fieldsAttempted, fieldsVerified,
      fieldsFailed, submitted, failureCode, detail
} while ($execution.status -eq "running")
```

Interpret the terminal result:

| `status` | `outcome` | Meaning |
| --- | --- | --- |
| `completed` | `dry_run_completed` | Fields were populated and verified through the terminal boundary; final submit was not activated. |
| `completed` | `submission_verified` | Final submit ran and the stored success criteria verified success. |
| `failed` | `validation_blocked` | Input did not satisfy the exact contract or active branch; inspect `issues`. |
| `failed` | `actuation_failed` | A scripted field action could not be located or verified; inspect `failureCode` and `issues`. |
| `failed` | `submission_unverified` | Submit may have run, but success could not be verified. Do not assume success or blindly retry. |
| `failed` | `unsupported_cross_page_branch` | The run encountered cross-page branching, which is currently detected but unsupported. |
| `failed` | `disqualified` | A disqualifying condition such as interactive CAPTCHA was encountered. |
| `failed` | `execution_error` | An unexpected browser, script, or local runtime error occurred. |

`submitted = true` only reports that the terminal action was activated. Treat
the submission as successful only when `status = completed`, `outcome =
submission_verified`, and `submissionResult.verified = true`.

The execution response returns field counts, issues, and failure diagnostics,
but not the supplied values. FormWeave persists the supplied field names and
explicitly records `sensitiveInputPersisted = false`.

See [Check Form Run OpenAPI](./openapi-execution-status.json).

## Contract index

- [Kick Off Crawl](./openapi-crawl-start.json)
- [Check Crawl](./openapi-crawl-status.json)
- [Get Report, Schema, and Screenshots](./openapi-crawl-artifacts.json)
- [Approve or Reject Form](./openapi-form-approval.json)
- [Kick Off Form Run](./openapi-form-run.json)
- [Check Form Run](./openapi-execution-status.json)
