# HAR File Analyzer - One Page Validation, OpenAPI, And Testing Guide

## 1. Purpose Of This Page

This is the single Confluence page to share with cross-functional reviewers, support engineers, developers, and OCI automation reviewers for testing the HAR File Analyzer.

The page explains:

- What the tool provides.
- How to access the deployed VM environment.
- How to validate the browser UI.
- How to validate the REST/OpenAPI API without using the UI.
- What evidence testers should capture.
- What counts as pass, partial pass, or fail.
- Known limitations and operational notes.

All test instructions below use the deployed VM URLs. Testers should not use local development URLs unless they are part of the core development team and intentionally running a local isolated environment.

---

## 2. Executive Summary

The HAR File Analyzer is an internal diagnostic tool that helps support and engineering teams analyze browser HAR files, console logs, failed network requests, session/authentication issues, and performance symptoms without manually reading raw HAR JSON.

The tool now also exposes REST/OpenAPI endpoints so automation flows, including OCI workflows, can upload diagnostic files, poll processing status, retrieve summaries and failed-request evidence, and generate AI-assisted insights programmatically.

| Area | What This Validates |
|---|---|
| Business value | A tester can move from uploaded file to a clear diagnostic explanation faster than manual HAR review |
| Support workflow | 4xx, 5xx, auth/session, stale-session, and performance symptoms can be isolated and explained |
| OpenAPI readiness | API users can discover endpoints, upload files, poll status, and retrieve structured output |
| AI resilience | AI insights work when OCA is available, with deterministic fallback when AI is unavailable |
| Operational readiness | Large-file upload, worker processing, retention, and API behavior are documented and testable |

Recommended result of this testing cycle: confirm that the tool is usable by non-technical reviewers, useful for support engineers, and ready for OCI API evaluation with clear remaining gaps documented.

### Validation Focus

This validation is not only checking whether the UI opens. It is checking whether the tool can become a reliable support diagnostic and automation surface.

The review should focus on three outcomes:

| Question | What To Look For | Where To Validate |
|---|---|---|
| Can a support engineer diagnose faster? | Failed requests, auth/session issues, slow requests, and request sequence are easier to isolate than manual HAR review | Sections 7 and 8 |
| Can OCI or another automation flow call the tool? | OpenAPI contract is reachable, REST upload works, status polling works, and v1 endpoints return structured output | Sections 9 through 14 |
| Is the tool ready for broader internal testing? | Known risks are documented, evidence capture is defined, and failures have clear troubleshooting steps | Sections 18 through 22 |

### Decision This Testing Supports

At the end of testing, reviewers should be able to decide one of the following:

| Decision | Meaning |
|---|---|
| Proceed with broader internal testing | UI and API flows work for approved test files, and defects are manageable |
| Proceed with OCI/API evaluation only | REST/OpenAPI flows are ready for integration review, even if UI feedback remains open |
| Hold for fixes | Core upload, processing, summary, or insight flows fail repeatedly |

### Key Links To Highlight In Confluence

Place these links near the top of the Confluence page so reviewers do not have to search for them:

| Link | Purpose |
|---|---|
| `http://10.65.39.163:3000` | Main tool UI for business validation, support workflows, and general testing |
| `http://10.65.39.163:4000/api-docs` | Human-readable API documentation page for developers and OCI reviewers |
| `http://10.65.39.163:4000/openapi.json` | Machine-readable OpenAPI contract for automation integration |
| `http://10.65.39.163:4000/health` | Quick backend availability check |

For the API review, the most important human-readable page is `http://10.65.39.163:4000/api-docs`. The most important integration artifact for OCI is `http://10.65.39.163:4000/openapi.json`.

---

## 3. Deployed Environment

Use these URLs over VPN.

| Surface | URL | Used By |
|---|---|---|
| Browser UI | `http://10.65.39.163:3000` | Business reviewers, support engineers, general testers |
| Browser UI hostname | `http://celvpvm05798.us.oracle.com:3000` | Same UI through hostname |
| Backend API base URL | `http://10.65.39.163:4000` | API testers, OCI automation reviewers |
| Health check | `http://10.65.39.163:4000/health` | Quick API availability check |
| Human-readable API docs | `http://10.65.39.163:4000/api-docs` | Developers and OCI reviewers |
| OpenAPI contract | `http://10.65.39.163:4000/openapi.json` | Machine-readable integration contract |

Do not paste the full OpenAPI JSON into Confluence. Link to `openapi.json` so automation users always receive the live contract.

Important:

- Use the VM URLs above for shared testing.
- Do not send testers to local development URLs.
- If the UI works but API tests fail, capture the exact API URL, command, and response.
- If API health fails, stop API testing and report the outage before continuing.

---

## 4. System At A Glance

```text
Tester / OCI Flow
      |
      v
Browser UI or REST API
      |
      v
Backend API on VM :4000
      |
      +--> Redis queue and pub/sub
      |
      +--> Worker parses HAR / console logs
      |
      +--> MongoDB stores file metadata and parsed entries
      |
      +--> OCA / AI service generates diagnostic insights when available
```

| Component | Role |
|---|---|
| Frontend UI | Uploads files, shows Analyzer, AI Insights, Request Flow, Console Log Analyzer, Compare, and Sanitizer |
| Backend API | Handles upload, status, OpenAPI, HAR APIs, console log APIs, sanitization, AI insights, and AI chat |
| Worker | Parses uploaded HAR/console log files and stores structured entries |
| MongoDB | Stores file metadata, HAR entries, console log entries, and derived statistics |
| Redis | Queue, upload progress, status tracking, and pub/sub events |
| OCA/AI | Generates AI-assisted diagnostic summaries when token and connectivity are available |

---

## 5. Who Should Test What

| Tester Type | Recommended Sections |
|---|---|
| Business / functional reviewers | Sections 6, 7, 8, 14, 15 |
| Support engineers | Sections 6, 7, 8, 9, 10, 14, 15 |
| Developers | Sections 9 through 18 |
| OCI automation reviewers | Sections 10 through 18 |
| Security/data reviewers | Sections 7, 8, 14, 16, 17 |

For a short functional review, complete the UI checklist and capture screenshots. For an API readiness review, complete the REST/OpenAPI tests.

### Recommended Testing Lanes

| Lane | Time Required | Audience | Goal |
|---|---:|---|---|
| Functional smoke test | 15-20 minutes | Cross-functional reviewers | Confirm the tool is understandable and produces visible diagnostic value |
| Support workflow test | 30-45 minutes | Support engineers | Confirm Analyzer, AI Insights, Request Flow, Console Log, and Compare workflows |
| API/OpenAPI test | 30-60 minutes | Developers / OCI reviewers | Confirm REST upload, polling, summary, errors, context, and insights |
| Stress/large-file test | Planned separately | Technical owners only | Confirm sizing behavior under larger files and high-entry HARs |

Not every reviewer needs to run API commands personally. The API evidence should be captured by a technical tester and should be clear enough for non-API reviewers to understand the outcome.

---

## 6. Recommended Test Files

Use approved non-production diagnostic files.

Recommended files:

- HAR with authentication or session issue.
- HAR with at least one 4xx or 5xx request.
- HAR with performance symptoms, such as slow page load or slow API response.
- Large HAR file, only if the testing owner has approved stress testing.
- Two HAR files from similar flows for Compare testing.
- Browser console log containing ORDS/CORS evidence, for example:

```text
Access-Control-Allow-Origin header is missing from ORDS
preflight request failed
blocked by CORS policy
TypeError: Failed to fetch
```

Do not upload customer-sensitive files unless the testing owner has approved the data handling path.

---

## 7. UI Validation Checklist

Use this for a 15 to 20 minute business/support validation.

For a short walkthrough, this is the minimum recommended validation. The tester should be able to explain what the tool found, which tab showed the evidence, and whether the finding is supported by request details or Request Flow.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Open `http://10.65.39.163:3000` | Upload/home screen loads |
| 2 | Upload a HAR file | Upload progress starts |
| 3 | Review redaction/sanitization step | Sensitive data workflow appears before analysis |
| 4 | Continue to workspace | HAR workspace opens and tab name matches file |
| 5 | Open Analyzer | Request table and filters are visible |
| 6 | Select 4xx or 5xx filter | Failed requests are isolated |
| 7 | Open a failed request | Request details show method, URL, status, timing, and headers/body where available |
| 8 | Open AI Insights | Executive summary and findings are generated |
| 9 | Open Request Flow | Request sequence is visible |
| 10 | Open Scorecard | High-level quality/performance/security signals are visible |
| 11 | Upload console log if available | Console Log Analyzer parses and highlights errors/warnings |
| 12 | Try Compare with two HAR files | Differences in requests, failures, or timings are visible |

Testing passes when the user can move from upload to a clear diagnostic explanation without reading raw HAR JSON.

Walkthrough acceptance criteria:

- The redaction/sanitization step is visible before analysis.
- The Analyzer helps narrow the request set rather than showing only raw volume.
- AI Insights gives a concise explanation, not just a list of URLs.
- Request Flow helps validate sequence-related conclusions.
- The tester can capture screenshots and explain the evidence in plain language.

---

## 8. UI Test Scenarios

### Scenario A - Basic HAR Upload

1. Open the UI.
2. Upload a HAR file.
3. Confirm that redaction/sanitization appears before analysis.
4. Continue to the HAR workspace.
5. Open Analyzer.
6. Confirm that the request table is populated.
7. Apply a status-code filter.
8. Open one request and review details.

Expected result:

- HAR is processed successfully.
- Request details are understandable.
- A non-technical reviewer can explain the high-level issue or confirm that deeper support review is needed.

Evidence to capture:

- Redaction screen screenshot.
- Analyzer screenshot after filter.
- Request details screenshot.

### Scenario B - Authentication Or Session Issue

Use when the customer symptom is sign-in, sign-out, authorization, IDCS, or stale session behavior.

1. Upload the HAR.
2. Open Analyzer.
3. Filter by `4xx`.
4. Look for `401`, `403`, or auth-related `404` requests.
5. Open a representative failed request.
6. Go to AI Insights.
7. Check whether AI identifies auth/session/stale-session/sign-out symptoms.
8. Go to Request Flow and validate the sequence.

Expected result:

- 4xx requests are easy to locate.
- AI Insights does not get distracted by successful 2xx traffic when auth failures exist.
- Request Flow supports or challenges the AI finding.

Evidence to capture:

- Filtered 4xx Analyzer view.
- Failed request details.
- AI Insights finding.
- Request Flow sequence.

### Scenario C - Performance Issue

1. Upload the HAR.
2. Open Analyzer.
3. Sort or filter by timing if available.
4. Open slow requests.
5. Review wait/TTFB and total timing.
6. Open Scorecard.
7. Review Request Flow to check whether the slow request is isolated or part of a chain.

Expected result:

- Slow requests are visible.
- Tool distinguishes failed requests from successful but slow requests.
- Tester can explain whether the issue appears request-specific or sequence-related.

### Scenario D - Console Log Analysis

1. Open Console Log Analyzer.
2. Upload a browser console log.
3. Filter by error or warning.
4. Look for CORS/ORDS/preflight evidence.
5. Open Console Log AI Insights.

Expected result:

- ORDS/CORS issues are classified as high-priority evidence.
- Missing `Access-Control-Allow-Origin` or failed preflight behavior is not treated only as a generic JavaScript error.

### Scenario E - Compare Two HAR Files

Use this for before/after, working/failing, UAT/production, or normal/incognito comparisons.

1. Open Compare.
2. Load baseline HAR.
3. Load comparison HAR.
4. Review added failures, missing requests, timing changes, and new domains.

Expected result:

- Tester can explain what changed between two captures.

---

## 9. OpenAPI Overview

The backend exposes a machine-readable OpenAPI 3.0.3 contract.

This section is important for OCI and automation discussions. The API docs page is the human-readable guide, while the OpenAPI JSON is the contract that automation systems should import.

| Endpoint | Purpose |
|---|---|
| `GET /api-docs` | Human-readable API documentation page |
| `GET /openapi.json` | Machine-readable OpenAPI 3.0.3 contract |
| `GET /health` | Backend availability check |

Full URLs:

```text
http://10.65.39.163:4000/api-docs
http://10.65.39.163:4000/openapi.json
http://10.65.39.163:4000/health
```

For OCI, `openapi.json` should be treated as the contract. The human-readable `/api-docs` page is for quick onboarding and manual validation.

OpenAPI review emphasis:

- `/api-docs` proves that the API is documented for human reviewers.
- `/openapi.json` proves that the API is discoverable by automation tooling.
- `/api/v1/har/...` endpoints are the stable automation surface for HAR diagnostics.

---

## 10. REST/OpenAPI Test Flow

Use this flow when testing the API without the UI.

For normal engineers: follow the numbered flow exactly. Do not skip polling. The diagnostic endpoints should be called only after the uploaded file reaches `ready`.

```text
1. Check backend health
2. Check OpenAPI contract
3. Upload HAR file in chunks
4. Complete upload
5. Poll processing status
6. Fetch HAR summary
7. Fetch failed requests
8. Fetch AI context
9. Generate AI insights
10. Capture response evidence
```

Important behavior:

- Upload is chunked because HAR files can be large.
- Recommended chunk size is 8 MB.
- Server rejects chunks above the configured upload limit.
- Worker must be running for status to reach `ready`.
- API consumers should poll until `ready` before calling final analysis endpoints.

What good looks like:

```text
health succeeds -> OpenAPI loads -> upload completes -> status becomes ready -> summary/errors/context/insights return structured data
```

What should be escalated:

```text
health fails, upload cannot complete, status remains processing for a long time, file enters error state, or v1 endpoints return unexpected 5xx errors
```

---

## 11. API Test 1 - Health And OpenAPI Contract

Run from PowerShell:

```powershell
$baseUrl = "http://10.65.39.163:4000"

Invoke-RestMethod "$baseUrl/health"
Invoke-RestMethod "$baseUrl/openapi.json"
```

Expected:

- `/health` returns a healthy status.
- `/openapi.json` returns an OpenAPI `3.0.3` document.
- The contract includes `/api/v1/har/{fileId}/summary`, `/errors`, `/insights/context`, and `/insights`.

Optional quick check:

```powershell
$spec = Invoke-RestMethod "$baseUrl/openapi.json"
$spec.openapi
$spec.paths.PSObject.Properties.Name | Select-String "/api/v1/har"
```

---

## 12. API Test 2 - REST-Only HAR Upload

Use this when a tester wants to upload a HAR only through APIs.

Update `$filePath` to point to the HAR file on the tester's machine.

```powershell
$baseUrl = "http://10.65.39.163:4000"
$filePath = "C:\path\to\sample.har"
$fileName = Split-Path $filePath -Leaf
$fileId = "file_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

$chunkSize = 8MB
$fileInfo = Get-Item $filePath
$totalChunks = [Math]::Ceiling($fileInfo.Length / $chunkSize)

Write-Host "Uploading $fileName"
Write-Host "fileId: $fileId"
Write-Host "totalChunks: $totalChunks"

$inputStream = [System.IO.File]::OpenRead($filePath)

try {
  for ($i = 0; $i -lt $totalChunks; $i++) {
    $buffer = New-Object byte[] $chunkSize
    $bytesRead = $inputStream.Read($buffer, 0, $chunkSize)

    $chunkPath = Join-Path $env:TEMP "$fileId`_chunk_$i"
    $outputStream = [System.IO.File]::Create($chunkPath)
    try {
      $outputStream.Write($buffer, 0, $bytesRead)
    } finally {
      $outputStream.Close()
    }

    curl.exe -X POST "$baseUrl/api/upload/chunk" `
      -F "fileId=$fileId" `
      -F "chunkIndex=$i" `
      -F "totalChunks=$totalChunks" `
      -F "chunk=@$chunkPath;filename=$fileName.part$i"

    if ($LASTEXITCODE -ne 0) {
      throw "Chunk $i upload failed"
    }

    Remove-Item $chunkPath -Force
  }
} finally {
  $inputStream.Close()
}

$body = @{
  fileId = $fileId
  totalChunks = $totalChunks
  fileName = $fileName
  fileType = "har"
} | ConvertTo-Json

Invoke-RestMethod "$baseUrl/api/upload/complete" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body

Write-Host "Use this fileId for the next steps: $fileId"
```

Expected:

- Each chunk upload returns success.
- Complete upload returns success and a job identifier.
- `$fileId` is printed and should be reused for status and analysis calls.

---

## 13. API Test 3 - Poll Processing Status

After upload completion, poll until status is `ready`.

```powershell
do {
  $status = Invoke-RestMethod "$baseUrl/api/har/$fileId/status"
  $status
  Start-Sleep -Seconds 2
} while ($status.status -ne "ready" -and $status.status -ne "error")
```

Expected statuses:

| Status | Meaning | Tester Action |
|---|---|---|
| `processing`, `parsing`, or `analyzing` | Worker is still processing | Continue polling |
| `ready` | File is ready for API analysis | Continue to v1 endpoints |
| `error` | Processing failed | Capture response and report issue |

Do not call final diagnostic endpoints until status is `ready`.

---

## 14. API Test 4 - HAR Automation Endpoints

Run after the file reaches `ready`.

This is the most important API validation section. If OCI asks whether the tool has REST APIs enabled, this section demonstrates the answer.

```powershell
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/summary"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/errors"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/insights/context"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/insights" -Method Post
```

Expected output:

| Endpoint | Expected Result |
|---|---|
| `GET /api/v1/har/{fileId}/summary` | Request count, error count, status buckets, top domains, methods, timing summary |
| `GET /api/v1/har/{fileId}/errors` | Paginated 4xx/5xx entries, or empty result when no errors exist |
| `GET /api/v1/har/{fileId}/insights/context` | Bounded backend-built diagnostic context |
| `POST /api/v1/har/{fileId}/insights` | Structured AI or fallback diagnostic result |

Example `summary` shape:

```json
{
  "fileId": "file_...",
  "fileName": "sample.har",
  "status": "ready",
  "summary": {
    "totalRequests": 120,
    "errors": 5,
    "errorRate": 4.17,
    "statusBuckets": {
      "2xx": 100,
      "4xx": 4,
      "5xx": 1
    }
  }
}
```

Example `insights` shape:

```json
{
  "fileId": "file_...",
  "sourceType": "har",
  "result": {
    "overallHealth": "warning",
    "summary": "Diagnostic summary",
    "sections": []
  },
  "ai": {
    "source": "oca"
  }
}
```

If OCA is unavailable, `ai.source` can be:

```text
deterministic_fallback
```

That is not automatically a test failure. It means the backend returned conservative rule-based findings instead of failing the diagnostic request.

Minimum evidence for API readiness:

- Screenshot or copied response from `/health`.
- Screenshot or copied response showing OpenAPI `3.0.3`.
- Upload response showing `fileId`.
- Status response showing `ready`.
- Summary response.
- Errors response.
- Insights response showing either `ai.source = oca` or `ai.source = deterministic_fallback`.

---

## 15. API Test 5 - Console Log Upload And Validation

Use this when testing browser console logs through REST APIs.

Upload uses the same chunk endpoints, but `fileType` should be `log`.

```powershell
$baseUrl = "http://10.65.39.163:4000"
$filePath = "C:\path\to\browser-console.log"
$fileName = Split-Path $filePath -Leaf
$fileId = "file_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$chunkSize = 8MB
$fileInfo = Get-Item $filePath
$totalChunks = [Math]::Ceiling($fileInfo.Length / $chunkSize)

$inputStream = [System.IO.File]::OpenRead($filePath)
try {
  for ($i = 0; $i -lt $totalChunks; $i++) {
    $buffer = New-Object byte[] $chunkSize
    $bytesRead = $inputStream.Read($buffer, 0, $chunkSize)
    $chunkPath = Join-Path $env:TEMP "$fileId`_chunk_$i"
    $outputStream = [System.IO.File]::Create($chunkPath)
    try {
      $outputStream.Write($buffer, 0, $bytesRead)
    } finally {
      $outputStream.Close()
    }

    curl.exe -X POST "$baseUrl/api/upload/chunk" `
      -F "fileId=$fileId" `
      -F "chunkIndex=$i" `
      -F "totalChunks=$totalChunks" `
      -F "chunk=@$chunkPath;filename=$fileName.part$i"

    Remove-Item $chunkPath -Force
  }
} finally {
  $inputStream.Close()
}

$body = @{
  fileId = $fileId
  totalChunks = $totalChunks
  fileName = $fileName
  fileType = "log"
} | ConvertTo-Json

Invoke-RestMethod "$baseUrl/api/upload/complete" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

Poll status:

```powershell
do {
  $status = Invoke-RestMethod "$baseUrl/api/console-log/$fileId/status"
  $status
  Start-Sleep -Seconds 2
} while ($status.status -ne "ready" -and $status.status -ne "error")
```

Read console log output:

```powershell
Invoke-RestMethod "$baseUrl/api/console-log/$fileId/stats"
Invoke-RestMethod "$baseUrl/api/console-log/$fileId/entries?levels=error&limit=25"
Invoke-RestMethod "$baseUrl/api/console-log/$fileId/search?search=ORDS"
```

Expected:

- Console log status reaches `ready`.
- Errors and warnings are parsed.
- ORDS/CORS evidence can be searched and reviewed.

---

## 16. Negative And Edge Case Tests

These tests confirm error handling.

| Test | Command / Action | Expected Result |
|---|---|---|
| Unknown HAR file | `Invoke-RestMethod "$baseUrl/api/v1/har/file_missing/summary"` | `404 File not found` |
| Invalid file ID | Use path-like value such as `../bad` | `400 Invalid fileId` |
| Missing chunks | Call upload complete before chunk upload | `400 Missing chunks` |
| Oversized chunk | Upload chunk above server limit | `413 Upload chunk too large` |
| Processing file | Call v1 endpoint before status is ready | `202 Accepted` or processing response |
| No-error HAR | Use HAR with only 2xx responses | Summary succeeds, errors endpoint returns empty list |
| AI unavailable | OCA token expired/unavailable | Summary/errors still work; insights may return fallback or clear AI failure behavior |

When a negative test fails, capture:

- Full command used.
- Full response body.
- Timestamp.
- File ID, if applicable.

---

## 17. Large File And Performance Testing

Large-file testing should be planned because it can consume disk, worker memory, queue time, and MongoDB storage.

Recommended staged approach:

| Stage | File Size | Purpose |
|---|---:|---|
| Small | Less than 20 MB | Basic upload, processing, and endpoint behavior |
| Medium | 100 MB to 250 MB | Chunking, queue behavior, response timing |
| Large | 1 GB, only with approval | Stress behavior and operational sizing |
| High-entry | Many small entries | MongoDB insert and pagination behavior |

For large files, verify:

- Upload completes with 8 MB chunks.
- Processing reaches `ready`.
- Summary endpoint remains responsive.
- Errors endpoint supports pagination.
- AI context remains bounded.
- Worker does not repeatedly restart.
- Disk usage remains acceptable.

Do not run repeated large tests without confirming retention cleanup and available disk space.

---

## 18. Evidence Capture Checklist

For every test round, capture:

| Evidence | Required? |
|---|---|
| Tester name | Yes |
| Date and time | Yes |
| Tool URL used | Yes |
| File type tested: HAR, console log, compare pair, API upload | Yes |
| File size | Yes |
| File ID for API tests | Yes |
| Upload result | Yes |
| Processing status result | Yes |
| Screenshot for UI issue | Yes, if UI issue |
| API response body for API issue | Yes, if API issue |
| Whether AI source was `oca` or `deterministic_fallback` | Yes, for AI test |
| Business impact | Yes, for defects |

Evidence expectations by audience:

| Audience | Minimum Evidence |
|---|---|
| Functional reviewer | UI screenshots showing upload/redaction, Analyzer filter, AI Insights, and Request Flow |
| Support engineer | Same as functional reviewer, plus failed request details and diagnostic explanation |
| Developer / OCI reviewer | API command, file ID, status response, v1 endpoint responses, and OpenAPI link |
| Security/data reviewer | Redaction screen, sensitive-data handling notes, and retention/cleanup expectations |

---

## 19. Feedback Template

Use this format when reporting feedback:

```text
Tester:
Date:
Tool URL:
File type:
File size:
File ID:
Scenario tested:

Result:
Pass / Fail / Partially Passed

What worked:

What did not work:

Steps to reproduce:

Screenshot or API response:

Business impact:
Low / Medium / High

Suggested improvement:
```

---

## 20. Pass Criteria

The testing cycle is successful if:

- Non-technical users can upload a HAR and understand the high-level issue.
- Support engineers can filter and inspect failed requests quickly.
- Authentication/session/performance symptoms can be traced through Analyzer, AI Insights, and Request Flow.
- Console log analysis identifies high-priority browser issues such as ORDS/CORS.
- REST/OpenAPI users can upload, poll, summarize, list errors, build AI context, and generate insights without using the UI.
- The OpenAPI contract is reachable and contains the required automation endpoints.
- Known limitations are documented rather than hidden.

Partial pass is acceptable when:

- UI analysis works but AI is temporarily unavailable and deterministic fallback behavior is documented.
- Small and medium files pass but large-file testing is deferred to a planned sizing exercise.
- API upload and summary work but OCI-specific authentication or gateway policy is still pending.

Fail should be recorded when:

- Upload fails for approved normal-size files.
- Files do not reach `ready`.
- Analyzer cannot show parsed requests.
- OpenAPI contract is not reachable.
- v1 summary/errors/insights endpoints fail for a ready file.

---

## 21. Known Limitations During Testing

- Access control is still expected to be finalized before wider enterprise exposure.
- The current API is intended for trusted internal testing.
- OCA tokens can expire. If AI fails but summary/errors still work, ask the tool owner to refresh the backend token.
- Very large HAR files must use chunked upload.
- Worker process must be running. If files stay in processing, the worker service needs to be checked.
- AI output should support diagnosis, not replace engineer review.
- Retention cleanup is configurable, but dry-run should be reviewed before deleting test artifacts.
- OCI exposure should align on authentication, retention, and data handling policy before broader rollout.

---

## 22. Troubleshooting

| Symptom | Likely Cause | What To Check |
|---|---|---|
| UI does not load | Frontend process unavailable or VPN issue | Open `http://10.65.39.163:3000` again and confirm VPN |
| API health fails | Backend unavailable | Check `http://10.65.39.163:4000/health` |
| Upload succeeds but status never becomes ready | Worker issue or queue backlog | Report file ID and timestamp |
| API returns `404 File not found` | Wrong file ID or cleanup removed file | Recheck file ID from upload response |
| API returns `413 Upload chunk too large` | Chunk size too large | Use 8 MB chunk size |
| AI insights fail but summary works | OCA token/connectivity issue | Capture response and ask owner to refresh token |
| Console log search returns no ORDS/CORS entry | Log file may not contain relevant text or parser did not classify it | Search manually for `ORDS`, `CORS`, `Access-Control-Allow-Origin`, or `preflight` |

---

## 23. OpenAPI Endpoint Reference

Main discovery:

```text
GET /health
GET /api-docs
GET /openapi.json
```

Upload:

```text
POST /api/upload/chunk
POST /api/upload/complete
GET  /api/upload/progress/{fileId}
```

HAR status and UI-backed data:

```text
GET /api/har/{fileId}/status
GET /api/har/{fileId}/entries
GET /api/har/{fileId}/entries/{index}
GET /api/har/{fileId}/stats
GET /api/har/{fileId}/search
```

Stable HAR automation endpoints:

```text
GET  /api/v1/har/{fileId}/summary
GET  /api/v1/har/{fileId}/errors
GET  /api/v1/har/{fileId}/insights/context
POST /api/v1/har/{fileId}/insights
```

Console log:

```text
GET /api/console-log/{fileId}/status
GET /api/console-log/{fileId}/entries
GET /api/console-log/{fileId}/entries/{index}
GET /api/console-log/{fileId}/stats
GET /api/console-log/{fileId}/search
```

Sanitization:

```text
GET  /api/sanitize/{fileId}/scan
POST /api/sanitize/{fileId}
```

AI:

```text
GET  /api/ai/status
POST /api/ai/insights
POST /api/ai/chat
```

---

## 24. Final Recommendation For Confluence

Use this as the primary Confluence page:

```text
HAR File Analyzer - One Page Validation, OpenAPI, And Testing Guide
```

For most users, this one page is enough. Link to the live API documentation at:

```text
http://10.65.39.163:4000/api-docs
```

Link to the machine-readable OpenAPI contract at:

```text
http://10.65.39.163:4000/openapi.json
```

Keep VM operations and deployment recovery steps separate and restricted to maintainers, because those notes contain operational commands and environment-specific details.
