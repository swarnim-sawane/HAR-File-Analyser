# OCI Container Deployment Progress

Last updated: 2026-07-16

## Current Source of Truth

The active deployment procedure is [OCI GenAI Hosted Deployment](./OCI_GENAI_HOSTED_DEPLOYMENT.md). It supersedes the June 2026 five-container OCI Container Instance configuration for new deployments in the `har-analyzer` compartment.

## Validated OCI Trial

The OCI Container Instance proof of concept established that the HAR Analyzer frontend, API, background worker, MongoDB, Redis, browser upload flow, and OCIR private-image pull path work in OCI. The successful test used one Container Instance with `har-web`, `har-api`, `har-worker`, MongoDB, and Redis containers.

That topology must not be copied to GenAI Hosted Deployment because the hosted runtime requires port 8080, provides a read-only filesystem except `/tmp`, does not support shared volumes, and manages each application image as a separate deployment.

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
| Frontend tests | 36 files and 285 tests passed on 2026-07-16 |
| Backend tests | 25 files and 131 tests passed on 2026-07-16 |
| Production builds | Frontend, backend, and frontend lint passed on 2026-07-16 |
| Local hosted image build | Reconfirmed blocked by network refusal to global and Mumbai Oracle Container Registry endpoints on 2026-07-16 |
| OCI DevOps build | Build specification prepared at `deploy/hosted/build_spec.yaml`; not yet executed in the target tenancy |

## Immediate Next Action

1. Confirm the Hosted Deployment region and operator access for `har-analyzer`.
2. Create or identify the three private OCIR repositories and Object Storage bucket.
3. Configure the IAM dynamic group and policies listed in the active runbook.
4. Run the OCI DevOps Managed Build from `main` using `deploy/hosted/build_spec.yaml`.
5. Deliver the three build artifacts to immutable OCIR tags.
6. Create `har-analyzer-app` and `har-analyzer-worker`, then run the end-to-end validation gate.

Do not place MongoDB, Redis, OAuth, OCIR, or OpenAI secrets in this document or in Git.
