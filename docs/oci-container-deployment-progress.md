# OCI Container Deployment Progress

Last updated: 2026-07-17

## Current Source of Truth

The active deployment procedure is [OCI GenAI Hosted Deployment](./OCI_GENAI_HOSTED_DEPLOYMENT.md). It supersedes the June 2026 five-container OCI Container Instance configuration for new deployments in the `har-analyzer` compartment.

## Validated OCI Trial

The OCI Container Instance proof of concept established that the HAR Analyzer frontend, API, background worker, MongoDB, Redis, browser upload flow, and OCIR private-image pull path worked in OCI. The successful test used one Container Instance with `har-web`, `har-api`, `har-worker`, MongoDB, and Redis containers. This is a historical validation record, not the production dependency design.

That topology must not be copied to GenAI Hosted Deployment because the hosted runtime requires port 8080, provides a read-only filesystem except `/tmp`, does not support shared volumes, and manages each application image as a separate deployment.

## coefmw OpenAI Pilot

The current MongoDB/Redis release was packaged and published to the existing private `coefmw` OCIR repositories on 2026-07-16:

- `bom.ocir.io/coefmw/har-analyzer/har-web:openai-pilot-20260716-de2bd81`
- `bom.ocir.io/coefmw/har-analyzer/har-backend:openai-pilot-20260716-8ff8721`

The tenancy did not permit creating separate dependency repositories. To avoid runtime pulls from Docker Hub, the tested Linux/AMD64 MongoDB and Redis images were published as clearly named pilot-only tags in the existing private backend repository:

- `bom.ocir.io/coefmw/har-analyzer/har-backend:dependency-mongo-7-pilot-20260716`
- `bom.ocir.io/coefmw/har-analyzer/har-backend:dependency-redis-7-alpine-pilot-20260716`

These dependency tags are for the short-lived `coefmw` pilot and still require the normal Oracle OSS and vulnerability review before production use.

Rancher Desktop acceptance checks passed before publication:

- Web, API, worker, MongoDB, and Redis remained healthy in the five-container topology.
- A 1.5 MB HAR upload completed and the Linux worker parsed all 10 requests, including three HTTP 500 responses.
- The HAR contents were not sent to OpenAI. A synthetic diagnostic fixture was used for the external AI validation.
- The OpenAI status probe and synthetic insights request completed successfully with `gpt-5.6-terra`.
- The synthetic test completed in approximately six seconds and recorded 1,702 tokens with an estimated cost of USD 0.0092675.
- Usage accounting reported two completed requests, no failed or unpriced requests, and confirmed that prompts, responses, and API keys were not stored.

The Linux trial exposed and fixed an exact-case `JSONStream` module import that Windows development did not detect. The first public-IP deployment also exposed a CORS regression: `CORS_ORIGIN=*` was being compared as a literal origin, causing upload preflight requests to return HTTP 500. Commit `8ff8721` restores explicit wildcard handling for Express and Socket.IO. A browser-origin preflight returned HTTP 204 and a multipart chunk upload returned HTTP 200 before the corrected backend image was published. The backend test suite passed with 25 files and 134 tests after the fix.

The current `coefmw` Container Instance must use the corrected backend tag for both `har-api` and `har-worker`. Keep the existing web, MongoDB, and Redis image tags, mount the same ephemeral `/workspace` path into the API and worker, and configure:

| Container | Required trial configuration |
| --- | --- |
| `har-web` | Published web image; default command; expose port 80 |
| `har-api` | Published backend image; default command; MongoDB/Redis connection values; shared `/workspace`; public URL/CORS values; OpenAI key and model; usage rates |
| `har-worker` | Published backend image; command `npm run worker`; MongoDB/Redis connection values; shared `/workspace`; `WORKER_CONCURRENCY=2`; no OpenAI key |

Use these non-secret AI values on `har-api` only:

```text
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.6-terra
AI_USAGE_TRACKING_ENABLED=true
OPENAI_INPUT_USD_PER_1M_TOKENS=2.50
OPENAI_CACHED_INPUT_USD_PER_1M_TOKENS=0.25
OPENAI_OUTPUT_USD_PER_1M_TOKENS=15.00
```

Inject `OPENAI_API_KEY` through the approved secret path. Do not copy it into this document, an image, source control, or the worker container.

## Hosted Deployment Readiness

| Area | Status |
| --- | --- |
| Application runtime | Combined React/Express image binds to `0.0.0.0:8080` and exposes `/health` and `/ready` |
| Worker runtime | Separate worker image binds its health server to `0.0.0.0:8080` |
| PostgreSQL | MongoDB has been replaced by native PostgreSQL schema migrations, JSONB repositories, indexed paging/filtering, retention, and AI usage accounting; exercised against live PostgreSQL 15 locally |
| Redis | OCI Cache TLS configuration is implemented; production must use non-sharded OCI Cache Redis 7 because BullMQ requires Redis scripting |
| Cross-container files | Migrated to OCI Object Storage artifact keys; local work is confined to `/tmp` |
| AI | OpenAI Responses API, governed-key configuration, and persistent token/cost accounting are ready; inject the key as a secret |
| Docker Hub | Prohibited; Oracle Linux/OCIR/Oracle Artifactory paths only |
| Release source | Reviewed release candidate promoted to `main` on 2026-07-16 |
| Production access | Operator/admin access and the existing OCIR repository are now available; the team instructed direct OCIR publication until its DevOps pipeline is ready |
| Frontend tests | 38 files and 293 tests passed on 2026-07-17 |
| Backend tests | 26 files and 131 tests passed on 2026-07-17; the live PostgreSQL integration test passed separately |
| End-to-end validation | Real HAR and console-log uploads completed through the API, Redis queue, worker, and PostgreSQL; the OpenAPI endpoint suite passed all 47 checks; a 32 MB Oracle HAR containing an embedded NUL byte completed with 123 entries after PostgreSQL-safe evidence encoding |
| Production builds | Frontend, backend, and frontend lint passed on 2026-07-17 |
| Hosted image publication | Completed on 2026-07-17 through the approved BOAT/OCIR path; all release manifests resolve from Phoenix OCIR |
| OCI DevOps build | Build specification prepared at `deploy/hosted/build_spec.yaml`; direct OCIR publication is the approved interim path |

## Published Hosted Images

The initial PostgreSQL/OCI Cache/Object Storage Hosted Deployment images were built from source commit `c294535` and published directly to the private `har-analyzer` repositories in Phoenix OCIR:

| Image | Immutable tag | Registry digest |
| --- | --- | --- |
| Oracle Linux Node.js base | `phx.ocir.io/axfm33dl0mwg/har-analyzer/node-base:ol9-node22-postgres-hosted-20260717-a190a42` | `sha256:882db65119df1b8c9ba0df12f109148d80cf47fcbf0d4e6d8eef961b18b94fa6` |
| Application | `phx.ocir.io/axfm33dl0mwg/har-analyzer/har-app:postgres-hosted-20260717-c294535` | `sha256:3c1a4382afb70131f0f284f26644e10147467422efa49a1d1d1040864208b0a8` |
| Worker | `phx.ocir.io/axfm33dl0mwg/har-analyzer/har-worker:postgres-hosted-20260717-c294535` | `sha256:4adb08b229ca64cf65d78681bb5b32bc20189a73a825679ebaaa47487ae802b7` |

Both runtime images are Linux/AMD64, run as `10001:10001`, expose port `8080`, and retain the `/health` image health check. The app command is `node dist/server.js`; the worker command is `node dist/worker.js`. Do not override these commands in Hosted Deployment.

Share `deploy/hosted/app.env.example` and `deploy/hosted/worker.env.example` as configuration checklists. Never attach populated `.env` files or place credentials in Slack; database, Redis, CA, and OpenAI values must be injected through the approved secret configuration.

## Current Migration Work

The active migration branch is `codex/oci-postgres-hosted-migration`. Its purpose is to complete and validate the managed-service architecture before any new production image is published:

1. OCI PostgreSQL replaces MongoDB for file metadata, HAR/console entries, retention data, and AI usage events.
2. OCI Cache Redis remains the queue/event service with hosted TLS enforcement and bounded BullMQ job retention.
3. OCI Object Storage is the only durable cross-runtime artifact exchange; `/tmp` is scratch space only.
4. The API and worker both bind to `0.0.0.0:8080` in Hosted Deployment and fail startup on incompatible hosted configuration.

The old `dependency-mongo-*` and `dependency-redis-*` pilot tags must not be copied into Hosted Deployment.

## Immediate Next Action

1. Obtain/provision the OCI PostgreSQL database, non-sharded OCI Cache Redis 7 endpoint, Object Storage bucket, VCN/subnet path, TLS CA material, and secret references.
2. Validate application and worker readiness against all three real OCI services.
3. Merge the tested migration to `main` and record the exact commit.
4. Scan the published images, create the two Hosted Applications with Custom networking, and inject the environment/secret configuration.
5. Run upload, worker processing, OpenAI, token/cost accounting, retention dry-run, and readiness validation against the managed OCI services.

Do not place PostgreSQL, Redis, OAuth, OCIR, or OpenAI secrets in this document or in Git.
