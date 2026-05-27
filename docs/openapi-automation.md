# HAR File Analyzer OpenAPI / Automation Notes

This document explains how external automation, such as OCI workflows, can discover and call the HAR File Analyzer backend.

For the single Confluence-ready validation guide, including UI testing, OpenAPI testing, REST-only upload, expected responses, and evidence capture, see [confluence-user-testing-guide.md](./confluence-user-testing-guide.md).

## OpenAPI Endpoints

The deployed VM backend exposes:

- `GET http://10.65.39.163:4000/openapi.json` - machine-readable OpenAPI 3.0 document
- `GET http://10.65.39.163:4000/api-docs` - human-readable API documentation page

Set `OPENAPI_SERVER_URL` or `PUBLIC_API_URL` in the backend environment when the service is behind a proxy or gateway and the generated server URL should not be derived from the incoming request host.

## Current Automation Flow

1. Upload chunks with `POST /api/upload/chunk`.
2. Complete assembly with `POST /api/upload/complete`.
3. Poll processing with:
   - `GET /api/har/{fileId}/status` for HAR files
   - `GET /api/console-log/{fileId}/status` for console logs
4. For HAR automation, use the stable v1 endpoints:
   - `GET /api/v1/har/{fileId}/summary` for a compact diagnostic summary
   - `GET /api/v1/har/{fileId}/errors` for paginated 4xx/5xx requests
   - `GET /api/v1/har/{fileId}/insights/context` for backend-built AI context
   - `POST /api/v1/har/{fileId}/insights` for one-call insight generation from a processed HAR
5. Fetch deeper UI-backed analysis data when needed:
   - `GET /api/har/{fileId}/stats`
   - `GET /api/har/{fileId}/entries`
   - `GET /api/har/{fileId}/search`
   - `GET /api/console-log/{fileId}/stats`
   - `GET /api/console-log/{fileId}/entries`
   - `GET /api/console-log/{fileId}/search`
6. Generate AI insights with `POST /api/v1/har/{fileId}/insights`.

## Important Integration Note

`POST /api/v1/har/{fileId}/insights` is the preferred HAR automation endpoint after upload and processing are complete. It builds the HAR context server-side, calls the AI path when OCA is available, and returns deterministic fallback findings when OCA is unavailable or returns unusable output.

`POST /api/ai/insights` still exists for advanced callers that already have their own prepared `context` string. The React UI can continue to use it directly.

Current convenience endpoint:

```text
POST /api/v1/har/{fileId}/insights
```

This collapses the final two HAR steps into:

```text
upload -> poll status -> generate insights by fileId -> return structured result
```

The current implementation already avoids frontend context-building for HAR files by exposing the v1 context endpoint and the v1 insight-generation endpoint.

## REST-Only Upload Example

Use chunk upload for files larger than the 12 MB per-chunk limit. A safe default chunk size is 8 MB.

```powershell
$baseUrl = "http://10.65.39.163:4000"
$filePath = "C:\Users\ssawane\Downloads\DE2_vbcs (1).har"
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
    try { $outputStream.Write($buffer, 0, $bytesRead) } finally { $outputStream.Close() }

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
  fileType = "har"
} | ConvertTo-Json

Invoke-RestMethod "$baseUrl/api/upload/complete" -Method Post -ContentType "application/json" -Body $body
```

Then poll and analyze:

```powershell
Invoke-RestMethod "$baseUrl/api/har/$fileId/status"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/summary"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/errors"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/insights" -Method Post
```

## AI Fallback Behavior

`POST /api/v1/har/{fileId}/insights` returns:

- `ai.source = "oca"` when OCA generated the insight result
- `ai.source = "deterministic_fallback"` when OCA is unavailable, returns an error, returns empty content, or returns invalid JSON

Fallback output is intentionally conservative. It uses backend evidence rules from the generated HAR context, such as 5xx failures and authentication-focused 401/403 responses.

## Retention Cleanup

Retention cleanup is disabled by default so local development data is not deleted unexpectedly. Enable it in backend environment variables when running in CEL or OCI:

```text
RETENTION_CLEANUP_ENABLED=true
RETENTION_MAX_AGE_HOURS=168
RETENTION_CLEANUP_INTERVAL_MINUTES=60
RETENTION_CLEANUP_DRY_RUN=false
```

For one-off cleanup after building the backend:

```powershell
cd backend
npm run build
$env:RETENTION_MAX_AGE_HOURS='168'
$env:RETENTION_CLEANUP_DRY_RUN='true'
npm run cleanup:retention
```

Run first with `RETENTION_CLEANUP_DRY_RUN=true`, review the JSON counts, then run with `false` when ready.

## Deployment Sizing Guidance

Local validation covered 1 GB HAR upload and a 25,000-entry HAR profile. CEL or OCI should still validate sizing with realistic customer files.

Recommended starting point for a controlled internal deployment:

- Backend: 2-4 Node.js cluster workers
- Worker: 2 PM2 worker processes with `--max-old-space-size=4096 --expose-gc`
- Chunk size: 8 MB client-side chunks
- Disk: at least 3x the largest expected active HAR size, plus MongoDB storage
- Queue concurrency: start conservative, then increase after measuring CPU, RAM, and Mongo insert time
- Monitoring: track upload failures, queue depth, processing duration, worker restarts, retention cleanup counts, and OCA fallback rate

## Security Note

The current REST API is intended for trusted internal deployment. Before exposing it through a wider OCI automation surface, define the access model, such as API gateway policy, service-to-service auth, or an internal API key/header.
