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
5. Fetch backend-built AI context
6. Generate AI insights using the existing AI insights endpoint
7. Return structured diagnostic result to OCI workflow
```

## Important Integration Note

`POST /api/ai/insights` accepts a prepared diagnostic `context` string. In the UI flow, the React frontend builds this context before calling the backend.

For OCI automation, HAR context generation is now backend-owned through `GET /api/v1/har/{fileId}/insights/context`. OCI does not need to reproduce frontend-specific context-building logic for HAR files.

Current v1 HAR endpoints:

```text
GET  /api/v1/har/{fileId}/summary
GET  /api/v1/har/{fileId}/errors
GET  /api/v1/har/{fileId}/insights/context
```

Recommended next convenience endpoints, if OCI wants a single call that generates AI output directly by file ID:

```text
POST /api/v1/har/{fileId}/insights
POST /api/v1/console-log/{fileId}/insights
```

## Items To Align With OCI

- Authentication model: API gateway policy, service-to-service auth, or internal API key/header
- Deployment model: OCI VM, container, or managed service
- Expected file size limits and timeout behavior
- Synchronous vs asynchronous automation expectations
- Required response shape for automation consumers
- Required outputs: summary, failed requests, AI insights, scorecard, raw entries, or all of these
- Logging, retention, and data handling expectations for customer diagnostic files

## Recommended Positioning

The application is REST-backed today, exposes an OpenAPI contract for integration review, and now includes a stable `/api/v1` HAR automation layer for summary, failed-request triage, and backend-built AI context. It is ready for OCI API evaluation, with the next hardening step being direct v1 AI insight generation by `fileId` and equivalent v1 endpoints for console logs.
