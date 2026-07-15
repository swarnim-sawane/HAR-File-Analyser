# OCI OpenAPI Integration Brief

## Current Position

The HAR File Analyzer has an Express-based REST backend used by the current UI. The backend now exposes an OpenAPI contract and a stable `/api/v1` HAR automation surface so OCI teams can discover and call the diagnostic workflow programmatically.

Available discovery endpoints:

- `GET /openapi.json`
- `GET /api-docs`

## Existing API Coverage

The current REST API supports:

- Chunked HAR and console log upload
- Upload completion and processing kickoff
- Upload progress tracking
- HAR processing status
- Automation-ready HAR summary via `/api/v1/har/{fileId}/summary`
- Automation-ready HAR 4xx/5xx error list via `/api/v1/har/{fileId}/errors`
- Backend-built HAR AI context via `/api/v1/har/{fileId}/insights/context`
- One-call HAR insight generation via `POST /api/v1/har/{fileId}/insights`
- HAR statistics, entry retrieval, and search
- Console log processing status
- Console log statistics, entry retrieval, and search
- HAR sanitization scan and redaction
- AI backend status
- AI insights generation
- AI chat/follow-up diagnostic endpoint

## Suggested OCI Automation Flow

```text
1. Upload HAR or console log file
2. Complete upload assembly
3. Poll processing status
4. Fetch v1 HAR summary and failed requests
5. Generate HAR insights by file ID with `POST /api/v1/har/{fileId}/insights`
6. Return structured diagnostic result to OCI workflow
```

## Important Integration Note

`POST /api/v1/har/{fileId}/insights` is the preferred HAR automation endpoint after processing is complete. It builds diagnostic context server-side, calls the configured OpenAI Responses API when available, and returns deterministic fallback findings when AI is unavailable or returns unusable output.

`POST /api/ai/insights` remains available for advanced callers that already have their own prepared diagnostic `context` string. OCI does not need to reproduce frontend-specific context-building logic for HAR files.

Current v1 HAR endpoints:

```text
GET  /api/v1/har/{fileId}/summary
GET  /api/v1/har/{fileId}/errors
GET  /api/v1/har/{fileId}/insights/context
POST /api/v1/har/{fileId}/insights
```

## Items To Align With OCI

- Authentication model: API gateway policy, service-to-service auth, or internal API key/header
- Deployment model: OCI VM, container, or managed service
- Expected file size limits and timeout behavior
- Synchronous vs asynchronous automation expectations
- Required response shape for automation consumers
- Required outputs: summary, failed requests, AI insights, scorecard, raw entries, or all of these
- Logging, retention, and data handling expectations for customer diagnostic files
- Retention policy values: `RETENTION_MAX_AGE_HOURS`, cleanup interval, and dry-run validation process
- OCI sizing validation: disk, MongoDB storage, backend cluster count, worker count, and queue concurrency under realistic customer HAR volumes

## Recommended Positioning

The application is REST-backed today, exposes an OpenAPI contract for integration review, and now includes a stable `/api/v1` HAR automation layer for summary, failed-request triage, backend-built AI context, and direct v1 AI insight generation by `fileId`. It is ready for OCI API evaluation, with the next hardening steps being access control alignment, OCI sizing validation, and equivalent v1 insight endpoints for console logs.
