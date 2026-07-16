# OCI Container Deployment Progress

Last updated: 2026-07-16

## Current Source of Truth

The active deployment procedure is [OCI GenAI Hosted Deployment](./OCI_GENAI_HOSTED_DEPLOYMENT.md). It supersedes the June 2026 five-container OCI Container Instance configuration for new deployments in the `har-analyzer` compartment.

## Validated OCI Trial

The OCI Container Instance proof of concept established that the HAR Analyzer frontend, API, background worker, MongoDB, Redis, browser upload flow, and OCIR private-image pull path work in OCI. The successful test used one Container Instance with `har-web`, `har-api`, `har-worker`, MongoDB, and Redis containers.

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
| MongoDB | Retained; an approved reachable URI is required |
| Redis | Retained; OCI Cache `REDIS_URL` is supported |
| Cross-container files | Migrated to OCI Object Storage artifact keys; local work is confined to `/tmp` |
| AI | OpenAI Responses API, governed-key configuration, and persistent token/cost accounting are ready; inject the key as a secret |
| Docker Hub | Prohibited; Oracle Linux/OCIR/Oracle Artifactory paths only |
| Release source | Reviewed release candidate promoted to `main` on 2026-07-16 |
| Production access | Developer has compartment details only; tenancy team must provide Managed Build or delegated OCIR push/deploy access |
| Frontend tests | 36 files and 285 tests passed on 2026-07-16 |
| Backend tests | 25 files and 134 tests passed on 2026-07-16 |
| Production builds | Frontend, backend, and frontend lint passed on 2026-07-16 |
| Local hosted image build | Reconfirmed blocked by network refusal to global and Mumbai Oracle Container Registry endpoints on 2026-07-16 |
| OCI DevOps build | Build specification prepared at `deploy/hosted/build_spec.yaml`; not yet executed in the target tenancy |

## Immediate Next Action

1. Ask the production tenancy team to select either team-owned Managed Build or delegated OCIR push access.
2. Obtain the target region, OCIR namespace/repositories, repository compartment, and operator group or pipeline owner.
3. Have the production team create the Object Storage bucket, IAM dynamic group, image-pull policies, and Hosted Deployment access.
4. Run the OCI DevOps Managed Build from `main` using `deploy/hosted/build_spec.yaml`, or use the explicitly delegated OCIR repository.
5. Deliver the three build artifacts to immutable OCIR tags.
6. Have the authorized operator create `har-analyzer-app` and `har-analyzer-worker`, then run the end-to-end validation gate with the developer.

Do not place MongoDB, Redis, OAuth, OCIR, or OpenAI secrets in this document or in Git.
