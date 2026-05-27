# HAR File Analyzer - User Testing Guide

## Executive Summary For Reviewers

This page explains how to validate the HAR File Analyzer through both the browser UI and REST/OpenAPI endpoints. The testing objective is to confirm that different users can upload diagnostic files, identify the most relevant failure signals, review AI-assisted findings, and capture clear evidence for support or automation workflows.

For managers and business reviewers, focus on sections 1 through 6, section 8, and section 9. For support engineers, include the Analyzer, AI Insights, Request Flow, Console Log, and Compare scenarios. For developers and OCI automation reviewers, also complete section 7 and the technical appendix.

| Review area | What to confirm |
|---|---|
| Business value | A tester can move from uploaded file to clear diagnostic summary without reading raw HAR JSON |
| Support usability | 4xx, 5xx, slow requests, auth/session symptoms, and request sequence issues are easy to isolate |
| Safety | The redaction/sanitization step appears before analysis and sensitive fields are handled intentionally |
| Automation readiness | REST endpoints and OpenAPI contract support upload, status polling, summaries, errors, and AI insights |
| Operational readiness | Large files, worker processing, AI fallback, and retention expectations are documented and testable |

Recommended outcome for this test cycle: collect feedback on usability, correctness of diagnostic findings, API integration fit, and any operational gaps before broader rollout.

## 1. Purpose

This guide explains how to test the HAR File Analyzer as an end user, support engineer, manager, or technical reviewer.

The goal of testing is to confirm that the tool can:

- Upload and process HAR files.
- Protect sensitive information through the redaction workflow.
- Help users find relevant 4xx, 5xx, session, and performance signals.
- Generate AI-assisted diagnostic insight.
- Validate request sequence through Request Flow.
- Analyze browser console logs.
- Compare two HAR files.
- Expose REST/OpenAPI endpoints for automation.

This page is written for mixed audiences. The first sections are suitable for non-technical testers. The later sections provide REST API and validation details for developers and OCI automation reviewers.

## 2. Access

Use the deployed internal URL over VPN:

```text
http://10.65.39.163:3000
```

Hostname URL:

```text
http://celvpvm05798.us.oracle.com:3000
```

Backend health check:

```text
http://10.65.39.163:4000/health
```

OpenAPI documentation:

```text
http://10.65.39.163:4000/api-docs
```

Machine-readable OpenAPI contract:

```text
http://10.65.39.163:4000/openapi.json
```

## 3. Who Should Test What

| Tester type | Recommended focus |
|---|---|
| Managers / reviewers | Upload flow, redaction screen, AI Insights, Request Flow, summary value, ease of use |
| Support engineers | Analyzer filters, 4xx/5xx triage, request details, stale session/auth diagnosis, Request Flow validation |
| Developers | REST upload, OpenAPI contract, processing status, v1 automation endpoints, large file behavior |
| OCI automation reviewers | `/openapi.json`, `/api/v1/har/{fileId}/summary`, `/api/v1/har/{fileId}/errors`, `/api/v1/har/{fileId}/insights`, response shape, polling behavior |
| Security/data reviewers | Redaction workflow, retention cleanup behavior, sensitive data handling expectations |

## 4. Recommended Test Files

Use non-production or approved diagnostic files only.

Recommended files:

- HAR with authentication or session issue.
- HAR with at least one 4xx or 5xx request.
- HAR with performance symptoms, such as slow page load or slow API response.
- Two HAR files from similar flows for Compare testing.
- Browser console log containing an ORDS/CORS error, for example missing `Access-Control-Allow-Origin`.

Do not upload customer-sensitive files unless the testing owner has approved the data handling path.

## 5. Quick Test Checklist

Use this section for a 15 to 20 minute validation.

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the UI | Home/upload screen loads |
| 2 | Upload a HAR file | Upload progress starts and redaction/sanitization screen appears |
| 3 | Continue from redaction | Main HAR workspace opens |
| 4 | Open Analyzer | Request table, filters, and status-code filter are visible |
| 5 | Select 4xx or 5xx filter | Failed requests are easier to isolate |
| 6 | Open one failed request | Request details panel shows URL, method, status, timings, headers/body where available |
| 7 | Open AI Insights | Executive summary and findings are generated |
| 8 | Open Request Flow | Journey or flow view shows the request sequence |
| 9 | Open Scorecard | High-level performance/security signals are visible |
| 10 | Upload console log if available | Console log analyzer parses entries and highlights errors/warnings |
| 11 | Try Compare with two HAR files | Differences in requests/timings/errors are visible |

Testing passes when the user can move from upload to a clear diagnostic explanation without reading raw HAR JSON.

For a non-technical validation round, stop after this checklist and submit feedback using section 9. For a support or developer validation round, continue with the detailed scenarios below.

## 6. Detailed UI Test Scenarios

### Scenario A: Basic HAR Upload And Analysis

1. Open the tool.
2. Upload a HAR file.
3. Confirm that the redaction/sanitization screen appears before analysis.
4. Proceed to the HAR workspace.
5. Confirm that the HAR tab name matches the uploaded file.
6. Open the Analyzer tab.
7. Confirm that the request table is populated.
8. Use the left-side HTTP status filter.
9. Select `4xx` or `5xx` if available.
10. Open a request from the filtered list.
11. Confirm that request details show useful evidence such as method, URL, response status, timings, and request/response sections.

Expected result:

- The HAR is processed successfully.
- The user can isolate relevant failed requests.
- Request details help explain what failed.

Evidence to capture:

- Screenshot of the redaction/sanitization screen.
- Screenshot of the Analyzer table after applying a status filter.
- Screenshot of one request details panel.

### Scenario B: Authentication Or Session Issue

Use this when the customer symptom is sign-in, sign-out, authorization, or stale session behavior.

1. Upload the HAR.
2. Go to Analyzer.
3. Filter by `4xx`.
4. Look for `401`, `403`, or auth-related `404` requests.
5. Open one of the failed requests.
6. Review URL, status, and timing.
7. Go to AI Insights.
8. Check whether AI Insights identifies auth, session, IDCS, stale session, or sign-out sequence symptoms.
9. Go to Request Flow.
10. Validate whether the request sequence supports the AI finding.

Expected result:

- 4xx requests are easy to locate.
- AI Insights should not focus only on successful 2xx traffic when auth failures exist.
- Request Flow helps validate the sequence around sign-in or sign-out.

Evidence to capture:

- Filtered Analyzer view showing 4xx requests.
- Request details for one representative auth/session-related request.
- AI Insights finding that explains whether this appears to be auth, session, IDCS, stale session, or sign-out related.
- Request Flow view showing the sequence around the failure.

### Scenario C: Performance Issue

1. Upload the HAR.
2. Open Analyzer.
3. Sort or filter by timing if available.
4. Open slow requests.
5. Review timing breakdown, especially wait/TTFB and total time.
6. Open Scorecard.
7. Review performance recommendations.
8. Open Request Flow to see whether the slow request is isolated or part of a chain.

Expected result:

- Slow requests are visible.
- The tool distinguishes failed requests from successful but slow requests.
- The user can explain whether the issue appears network-side, server-side, or sequence-related.

Evidence to capture:

- Slowest request or timing view.
- Scorecard/performance signal.
- Request Flow view if the slow request is part of a larger sequence.

### Scenario D: Console Log Analysis

Use this when there is a browser console log or copied browser error output.

1. Open the console log upload/analyzer area.
2. Upload the console log.
3. Confirm that log entries are parsed.
4. Filter by error or warning.
5. Look for ORDS/CORS evidence such as:

```text
Access-Control-Allow-Origin header is missing
preflight request failed
blocked by CORS policy
TypeError: Failed to fetch
```

6. Open Console Log AI Insights.

Expected result:

- ORDS/CORS issues are classified as high-priority evidence.
- The tool should identify missing `Access-Control-Allow-Origin` or failed preflight behavior as an ORDS/proxy CORS issue, not only as a generic JavaScript error.

Evidence to capture:

- Console log error list filtered to errors/warnings.
- Console Log AI Insights result for the ORDS/CORS issue.

### Scenario E: Compare Two HAR Files

Use this when testing before/after, working/failing, UAT/production, or normal/incognito sessions.

1. Open Compare.
2. Load the baseline HAR.
3. Load the comparison HAR.
4. Review request differences.
5. Look for added failures, missing requests, timing changes, and new domains.

Expected result:

- The user can explain what changed between two captures.
- Regressions are easier to identify than by manually comparing files.

Evidence to capture:

- Compare view showing added, missing, slower, or newly failing requests.

## 7. REST API Testing For Technical Users

The UI uses REST APIs behind the scenes. Automation users can test the same backend without using the UI.

Use this section when the tester wants to validate the backend directly, without relying on the browser UI. The upload flow is intentionally chunked because real HAR files can be larger than a single safe request payload.

### Health And OpenAPI

```powershell
$baseUrl = "http://10.65.39.163:4000"

Invoke-RestMethod "$baseUrl/health"
Invoke-RestMethod "$baseUrl/openapi.json"
```

Expected:

- `/health` returns `status: ok`.
- `/openapi.json` returns an OpenAPI `3.0.3` document.

### REST-Only HAR Upload

Use chunked upload. The backend rejects chunks larger than 12 MB, so an 8 MB chunk size is recommended.

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
```

### Poll Processing Status

```powershell
do {
  $status = Invoke-RestMethod "$baseUrl/api/har/$fileId/status"
  $status
  Start-Sleep -Seconds 2
} while ($status.status -ne "ready" -and $status.status -ne "error")
```

Expected statuses:

| Status | Meaning |
|---|---|
| `processing` / `parsing` / `analyzing` | Worker is still processing the file |
| `ready` | File is ready for analysis |
| `error` | Processing failed |

Continue only after the status is `ready`.

### Call Automation Endpoints

```powershell
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/summary"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/errors"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/insights/context"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/insights" -Method Post
```

Expected:

- `summary` returns total requests, errors, status buckets, top domains, methods, and timing summary.
- `errors` returns paginated 4xx/5xx requests.
- `insights/context` returns the backend-built context used for AI.
- `insights` returns structured diagnostic output.

The `insights` response includes:

```json
{
  "fileId": "file_...",
  "sourceType": "har",
  "result": {
    "overallHealth": "warning",
    "summary": "...",
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

That is not automatically a test failure. It means the backend returned conservative rule-based findings instead of failing the entire diagnostic request.

### Optional Developer Regression Scripts

These scripts are intended for local or controlled technical validation where MongoDB, Redis, backend, and worker test services are available. They are not required for a manager-led UI test.

```powershell
$env:OPENAPI_TEST_BASE_URL = "http://localhost:4200"
npm run test:openapi:endpoints
```

For stress testing, start with a smaller profile before using a large file profile:

```powershell
$env:STRESS_BASE_URL = "http://localhost:4200"
$env:STRESS_SIZE_MB = "128"
$env:STRESS_ENTRIES = "25000"
$env:STRESS_STREAM_UPLOAD = "1"
npm run test:openapi:stress
```

Only run 1 GB stress profiles when the machine has enough disk, memory, and time budget for a long-running test.

## 8. Expected Test Evidence To Capture

For every test round, capture:

- Tester name.
- Date and time.
- Tool URL used.
- File type tested: HAR, console log, compare pair, API upload.
- File size.
- Whether upload succeeded.
- Whether processing reached `ready`.
- Key tab or endpoint tested.
- Screenshot or copied response for any issue.
- Whether AI output was `oca` or `deterministic_fallback`.
- Any confusing UI behavior or unexpected result.

## 9. Feedback Template

Use this format when reporting feedback:

```text
Tester:
Date:
Tool URL:
File type:
File size:
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

## 10. Known Limitations During Testing

- Access control is still expected to be finalized before wider enterprise exposure.
- OCA tokens can expire. If AI fails but summary/errors still work, ask the tool owner to refresh the backend token.
- Very large HAR files need chunked upload. Single payload upload can fail if the file exceeds the 12 MB chunk limit.
- The worker must be running. If files stay in processing, check the worker service.
- AI output should support diagnosis, not replace engineer review.
- Retention cleanup is configurable, but should be run in dry-run mode before deleting test artifacts.
- The current API is intended for trusted internal testing. Wider OCI exposure should align on authentication, retention, and data handling policy first.

## 11. Pass Criteria

The testing cycle is successful if:

- Non-technical users can upload a HAR and understand the high-level issue.
- Support engineers can filter and inspect failed requests quickly.
- AI Insights gives useful, evidence-backed guidance or deterministic fallback.
- Request Flow helps validate sequence-related findings.
- Console log analysis identifies high-priority browser issues such as ORDS/CORS.
- REST/OpenAPI users can upload, poll, summarize, list errors, and generate insights without using the UI.

## 12. Technical Appendix

### Main UI URL

```text
http://10.65.39.163:3000
```

### Main Backend URL

```text
http://10.65.39.163:4000
```

### OpenAPI

```text
GET /openapi.json
GET /api-docs
```

### Main REST Flow

```text
POST /api/upload/chunk
POST /api/upload/complete
GET  /api/har/{fileId}/status
GET  /api/v1/har/{fileId}/summary
GET  /api/v1/har/{fileId}/errors
GET  /api/v1/har/{fileId}/insights/context
POST /api/v1/har/{fileId}/insights
```

### Recommended Technical Validation Commands

For local or controlled technical validation, use:

```powershell
$env:OPENAPI_TEST_BASE_URL = "http://localhost:4200"
npm run test:openapi:endpoints

$env:STRESS_BASE_URL = "http://localhost:4200"
$env:STRESS_SIZE_MB = "128"
$env:STRESS_ENTRIES = "25000"
$env:STRESS_STREAM_UPLOAD = "1"
npm run test:openapi:stress
```

The stress test can validate large files using streamed generated uploads. For a 1 GB profile, ensure there is enough disk space before running.

### Deployment And Operations Reference

Use [VM_RUNBOOK.md](../VM_RUNBOOK.md) for VM deployment, PM2 process recovery, proxy handling, OCA token refresh, worker restart behavior, and retention cleanup commands.
