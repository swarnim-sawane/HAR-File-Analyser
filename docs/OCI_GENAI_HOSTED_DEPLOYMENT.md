# OCI GenAI Hosted Deployment

## Runtime Contract

The hosted deployment uses two images:

- `har-analyzer-app`: React frontend and Express API on `0.0.0.0:8080`.
- `har-analyzer-worker`: BullMQ worker with health endpoints on `0.0.0.0:8080`.

Both images expose `GET /health` and `GET /ready`. The application serves the frontend and API from the same origin. Do not override the image commands or configure ports `80`, `3000`, or `4000` in Hosted Deployment.

## Image Build

Public Docker Hub base images are prohibited. The Dockerfiles have no default base image, and the build script accepts only Oracle Artifactory, OCIR, or Oracle Container Registry hosts.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-hosted-images.ps1 `
  -NodeImage <approved-oracle-registry>/<node-image>:<immutable-tag> `
  -AppImage bom.ocir.io/<namespace>/har-analyzer/har-app:<tag> `
  -WorkerImage bom.ocir.io/<namespace>/har-analyzer/har-worker:<tag>
```

The selected Node image must contain Node.js, npm, and a non-root `node` user. The script builds `linux/amd64` images and rejects a different resulting architecture.

## Required Environment

Set these variables on both deployments:

```text
NODE_ENV=production
HOSTED_DEPLOYMENT=true
HOST=0.0.0.0
PORT=8080
MONGODB_URL=<managed MongoDB connection string>
REDIS_HOST=<managed Redis host>
REDIS_PORT=<managed Redis port>
```

Set `WORKER_CONCURRENCY=2` on the worker. Add Redis credentials and TLS variables required by the approved managed Redis service. Do not add placeholder AI credentials; deterministic analysis remains available without AI.

## File Storage Gate

The images keep writable scratch paths under `/tmp`, which satisfies the hosted read-only root filesystem. The current upload queue still passes a local file path from the API to the worker. Because separate Hosted Deployments do not share `/tmp`, full upload processing requires OCI Object Storage exchange or another approved durable object store before production traffic is enabled.

Until that storage gate is completed, the images are suitable for platform creation, health checks, OAuth/network validation, and UI/API startup validation, but not a production upload sign-off.

## Validation

1. Confirm both deployments return HTTP 200 from `/health`.
2. Confirm both return HTTP 200 from `/ready` after MongoDB and Redis connect.
3. Confirm the application UI and `/api/support-workbench` are reachable through the same hosted origin.
4. Confirm no image manifest or build log references `docker.io`.
5. Complete an end-to-end HAR and console-log upload only after shared artifact storage is configured.
