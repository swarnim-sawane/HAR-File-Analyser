# HAR File Analyzer - Validation And OpenAPI Testing Guide

## 1. Scope

This guide defines the validation procedure for the deployed HAR File Analyzer environment.

The validation covers:

- Browser UI availability and file upload.
- HAR redaction/sanitization workflow.
- HAR Analyzer filtering and request details.
- AI Insights and Request Flow validation.
- Console log analysis.
- HAR Compare workflow.
- REST/OpenAPI availability.
- REST-only HAR upload and processing.
- HAR automation endpoints under `/api/v1`.
- Error handling and large-file behavior.

All commands and examples use the deployed VM URLs.

---

## 2. Access URLs

| Surface | URL |
|---|---|
| Browser UI | `http://10.65.39.163:3000` |
| Browser UI hostname | `http://celvpvm05798.us.oracle.com:3000` |
| Backend API base URL | `http://10.65.39.163:4000` |
| Backend health check | `http://10.65.39.163:4000/health` |
| Human-readable API documentation | `http://10.65.39.163:4000/api-docs` |
| Machine-readable OpenAPI contract | `http://10.65.39.163:4000/openapi.json` |

Validation requires VPN access to the VM network.

---

## 3. Test Data Requirements

Use approved non-production diagnostic files.

Recommended test files:

- HAR file with at least one 4xx or 5xx request.
- HAR file with authentication, authorization, session, or sign-out behavior.
- HAR file with performance symptoms such as slow API response or slow page load.
- Two HAR files from comparable flows for Compare validation.
- Browser console log containing an ORDS/CORS issue, for example:

```text
Access-Control-Allow-Origin header is missing from ORDS
preflight request failed
blocked by CORS policy
TypeError: Failed to fetch
```

Large-file validation must be planned separately because it can consume disk, worker memory, queue time, and Oracle JSON storage.

---

## 4. Validation Summary

| Area | Validation Goal |
|---|---|
| UI availability | Browser UI loads from the VM URL |
| Upload | HAR and console log files upload successfully |
| Redaction | Sensitive-data review appears before HAR analysis |
| Analyzer | Failed requests and slow requests can be filtered and inspected |
| AI Insights | Diagnostic summary is generated or deterministic fallback is returned |
| Request Flow | Request sequence can be reviewed visually |
| Console Log Analyzer | Browser errors and warnings are parsed and searchable |
| Compare | Two HAR files can be compared for request, timing, and failure differences |
| OpenAPI | `/api-docs` and `/openapi.json` are reachable |
| REST flow | Upload, complete, poll, summary, errors, context, and insights APIs work end to end |

---

## 5. Browser UI Validation

### 5.1 Open The UI

Open:

```text
http://10.65.39.163:3000
```

Expected result:

- The HAR File Analyzer upload screen loads.
- No browser error page is shown.

### 5.2 Upload A HAR File

Steps:

1. Select or drag a HAR file into the upload area.
2. Wait for upload progress to complete.
3. Confirm that the redaction/sanitization step appears.
4. Continue from redaction into the main HAR workspace.

Expected result:

- Upload completes.
- Redaction/sanitization appears before analysis.
- A HAR workspace opens.
- The active HAR tab name matches the uploaded file.

### 5.3 Validate Analyzer

Steps:

1. Open the Analyzer tab.
2. Confirm that the request table is populated.
3. Use the HTTP status filter.
4. Select `4xx` or `5xx` when the file contains failed requests.
5. Open one failed request.
6. Review request details.

Expected result:

- Request table loads.
- Filtering narrows the request list.
- Request details show method, URL, status, timing, and available request/response sections.

### 5.4 Validate Authentication Or Session Diagnosis

Use a HAR that contains sign-in, sign-out, authorization, IDCS, or stale-session behavior.

Steps:

1. Open Analyzer.
2. Filter by `4xx`.
3. Look for `401`, `403`, or auth-related `404` requests.
4. Open a representative failed request.
5. Open AI Insights.
6. Review the diagnostic summary and findings.
7. Open Request Flow.
8. Confirm whether the request sequence supports the finding.

Expected result:

- Auth/session-related failures are easy to locate.
- AI Insights identifies relevant authentication, authorization, session, IDCS, or stale-session patterns when present.
- Request Flow provides sequence evidence around the failure.

### 5.5 Validate Performance Diagnosis

Use a HAR that contains slow requests or a slow page-load symptom.

Steps:

1. Open Analyzer.
2. Sort or filter by timing where available.
3. Open slow requests.
4. Review total time and wait/TTFB values.
5. Open Scorecard.
6. Open Request Flow.

Expected result:

- Slow requests are visible.
- Successful but slow requests can be distinguished from failed requests.
- Request Flow shows whether the slow request is isolated or part of a larger chain.

### 5.6 Validate AI Insights

Steps:

1. Open AI Insights after the HAR has processed.
2. Review Executive Summary, Overall Health, findings, and recommendations.
3. Confirm whether the finding references evidence visible in Analyzer or Request Flow.

Expected result:

- AI Insights returns structured diagnostic output.
- If AI service is unavailable, fallback behavior is clear and the rest of the analysis remains usable.

### 5.7 Validate Request Flow

Steps:

1. Open Request Flow.
2. Review Journey Map.
3. Locate the request sequence around failed, redirected, or slow requests.
4. Use detailed views only when deeper technical validation is required.

Expected result:

- Request sequence is visible.
- Sequence-related findings can be validated without reading raw HAR JSON.

### 5.8 Validate Console Log Analyzer

Steps:

1. Open the console log area.
2. Upload a browser console log.
3. Confirm that log entries are parsed.
4. Filter by error or warning.
5. Search for `ORDS`, `CORS`, `Access-Control-Allow-Origin`, or `preflight`.
6. Open Console Log AI Insights.

Expected result:

- Errors and warnings are parsed.
- ORDS/CORS/preflight issues are searchable.
- Console Log AI Insights classifies relevant browser-side errors.

### 5.9 Validate Compare

Use two HAR files from similar flows.

Steps:

1. Open Compare.
2. Load the baseline HAR.
3. Load the comparison HAR.
4. Review added requests, missing requests, timing changes, new failures, and new domains.

Expected result:

- Differences between two captures are visible.
- Regressions can be identified without manually comparing raw HAR files.

---

## 6. OpenAPI Availability Validation

Run from PowerShell:

```powershell
$baseUrl = "http://10.65.39.163:4000"

Invoke-RestMethod "$baseUrl/health"
Invoke-RestMethod "$baseUrl/openapi.json"
```

Expected result:

- `/health` returns a healthy response.
- `/openapi.json` returns an OpenAPI `3.0.3` document.
- `/api-docs` opens in the browser.

Optional contract check:

```powershell
$spec = Invoke-RestMethod "$baseUrl/openapi.json"
$spec.openapi
$spec.paths.PSObject.Properties.Name | Select-String "/api/v1/har"
```

Expected result:

- OpenAPI version is `3.0.3`.
- The contract includes `/api/v1/har/{fileId}/summary`.
- The contract includes `/api/v1/har/{fileId}/errors`.
- The contract includes `/api/v1/har/{fileId}/insights/context`.
- The contract includes `/api/v1/har/{fileId}/insights`.

---

## 7. REST-Only HAR Upload Validation

Use this flow to test HAR upload without using the browser UI.

Update `$filePath` before running.

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

Write-Host "fileId: $fileId"
```

Expected result:

- Each chunk upload succeeds.
- Upload completion succeeds.
- A `fileId` is available for status polling and analysis requests.

---

## 8. HAR Processing Status Validation

Run after upload completion.

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
| `processing`, `parsing`, or `analyzing` | File is still being processed |
| `ready` | File is ready for analysis endpoints |
| `error` | File processing failed |

Continue to the automation endpoints only after status is `ready`.

---

## 9. HAR Automation Endpoint Validation

Run after status is `ready`.

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
| `GET /api/v1/har/{fileId}/errors` | Paginated 4xx/5xx entries, or an empty result when no errors exist |
| `GET /api/v1/har/{fileId}/insights/context` | Bounded backend-built diagnostic context |
| `POST /api/v1/har/{fileId}/insights` | Structured AI or deterministic fallback diagnostic result |

Example summary response shape:

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

Example insights response shape:

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

Fallback behavior:

```text
ai.source = deterministic_fallback
```

`deterministic_fallback` means the backend returned conservative rule-based findings instead of failing the request when AI output was unavailable or unusable.

---

## 10. REST-Only Console Log Validation

Update `$filePath` before running.

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

Expected result:

- Console log upload completes.
- Console log status reaches `ready`.
- Error and warning entries are returned.
- ORDS/CORS/preflight evidence can be searched.

---

## 11. Negative And Edge Case Validation

| Test | Action | Expected Result |
|---|---|---|
| Unknown HAR file | Call `GET /api/v1/har/file_missing/summary` | `404 File not found` |
| Invalid file ID | Use path-like value such as `../bad` | `400 Invalid fileId` |
| Missing chunks | Call upload complete before chunk upload | `400 Missing chunks` |
| Oversized chunk | Upload chunk above server limit | `413 Upload chunk too large` |
| Processing file | Call v1 endpoint before status is ready | `202 Accepted` or processing response |
| No-error HAR | Use HAR with only 2xx responses | Summary succeeds and errors endpoint returns an empty list |
| AI unavailable | AI token/connectivity unavailable | Summary/errors still work; insights returns fallback or clear failure behavior |

Capture the full command, response body, timestamp, and `fileId` for any failed negative test.

---

## 12. Large File Validation

Large-file validation must be controlled because it can consume disk, memory, queue time, and database storage.

| Stage | File Size | Purpose |
|---|---:|---|
| Small | Less than 20 MB | Basic upload, processing, and endpoint behavior |
| Medium | 100 MB to 250 MB | Chunking, queue behavior, and response timing |
| Large | 1 GB | Stress behavior and operational sizing |
| High-entry | Many small entries | Oracle JSON insert and pagination behavior |

Validate:

- Upload completes with 8 MB chunks.
- Processing reaches `ready`.
- Summary endpoint remains responsive.
- Errors endpoint supports pagination.
- AI context remains bounded.
- Worker does not repeatedly restart.
- Disk usage remains acceptable.

---

## 13. Evidence Capture

Capture the following for each validation run:

| Evidence | Required |
|---|---|
| Date and time | Yes |
| Tool URL used | Yes |
| File type: HAR, console log, compare pair, or API upload | Yes |
| File size | Yes |
| File ID for API tests | Yes |
| Upload result | Yes |
| Processing status result | Yes |
| Screenshot for UI issue | If applicable |
| API response body for API issue | If applicable |
| AI source: `oca` or `deterministic_fallback` | For AI validation |
| Reproduction steps for defects | For failures |

Feedback format:

```text
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

## 14. Pass And Fail Criteria

Pass:

- UI loads successfully.
- HAR upload completes.
- Redaction/sanitization appears before analysis.
- Analyzer displays parsed requests.
- 4xx/5xx and slow requests can be filtered and inspected.
- AI Insights returns structured output or deterministic fallback.
- Request Flow displays request sequence.
- OpenAPI contract is reachable.
- REST upload, status polling, summary, errors, context, and insights endpoints work for a ready file.

Partial pass:

- UI analysis works but AI is temporarily unavailable and deterministic fallback behavior is returned.
- Small and medium files pass while large-file validation remains pending.
- API upload and summary work while environment-specific access controls remain pending.

Fail:

- UI does not load.
- Upload fails for approved normal-size files.
- Files do not reach `ready`.
- Analyzer cannot display parsed requests.
- OpenAPI contract is not reachable.
- v1 summary/errors/context/insights endpoints fail for a ready file.

---

## 15. Known Limitations

- Access control is expected to be finalized before wider exposure.
- Current API validation is intended for trusted internal testing.
- OCA tokens can expire. Summary, errors, and context endpoints can still work when AI is unavailable.
- Very large HAR files require chunked upload.
- Worker service must be running for files to reach `ready`.
- AI output supports diagnosis but does not replace engineer review.
- Retention cleanup is configurable and must be reviewed before deleting test artifacts.
- OCI exposure requires alignment on authentication, retention, and diagnostic data handling.

---

## 16. Troubleshooting

| Symptom | Likely Cause | Check |
|---|---|---|
| UI does not load | Frontend process unavailable or VPN issue | Open `http://10.65.39.163:3000` and confirm VPN |
| API health fails | Backend unavailable | Open `http://10.65.39.163:4000/health` |
| Upload succeeds but status never becomes ready | Worker issue or queue backlog | Capture file ID and timestamp |
| API returns `404 File not found` | Wrong file ID or cleanup removed file | Recheck file ID from upload response |
| API returns `413 Upload chunk too large` | Chunk size too large | Use 8 MB chunks |
| AI insights fail but summary works | AI token/connectivity issue | Capture response and validate fallback behavior |
| Console log search returns no ORDS/CORS entry | Log file may not contain matching text or parser did not classify it | Search for `ORDS`, `CORS`, `Access-Control-Allow-Origin`, or `preflight` |

---

## 17. OpenAPI Endpoint Reference

Discovery:

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

HAR:

```text
GET /api/har/{fileId}/status
GET /api/har/{fileId}/entries
GET /api/har/{fileId}/entries/{index}
GET /api/har/{fileId}/stats
GET /api/har/{fileId}/search
```

HAR automation:

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
