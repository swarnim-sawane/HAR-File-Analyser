# HAR File Analyzer OpenAPI / Automation Notes

This document explains how external automation, such as OCI workflows, can discover and call the HAR File Analyzer backend.

For a shorter OCI-facing summary, see [oci-openapi-integration-brief.md](./oci-openapi-integration-brief.md).

## OpenAPI Endpoints

The backend exposes:

- `GET /openapi.json` - machine-readable OpenAPI 3.0 document
- `GET /api-docs` - lightweight human-readable API landing page

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
5. Fetch deeper UI-backed analysis data when needed:
   - `GET /api/har/{fileId}/stats`
   - `GET /api/har/{fileId}/entries`
   - `GET /api/har/{fileId}/search`
   - `GET /api/console-log/{fileId}/stats`
   - `GET /api/console-log/{fileId}/entries`
   - `GET /api/console-log/{fileId}/search`
6. Generate AI insights with `POST /api/ai/insights` using the context returned by `GET /api/v1/har/{fileId}/insights/context`.

## Important Integration Note

`POST /api/ai/insights` accepts a prepared `context` string. The React UI builds this context for the browser workflow. OCI automation should use `GET /api/v1/har/{fileId}/insights/context` so the context is built server-side from stored HAR entries instead of being recreated by the automation client.

Recommended future convenience endpoint:

```text
POST /api/v1/har/{fileId}/insights
POST /api/v1/console-log/{fileId}/insights
```

That would collapse the final two steps into:

```text
upload -> poll status -> generate insights by fileId -> return structured result
```

The current implementation already avoids frontend context-building for HAR files by exposing the v1 context endpoint.

## Security Note

The current REST API is intended for trusted internal deployment. Before exposing it through a wider OCI automation surface, define the access model, such as API gateway policy, service-to-service auth, or an internal API key/header.
