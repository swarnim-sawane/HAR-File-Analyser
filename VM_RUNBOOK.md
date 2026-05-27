
# HAR Analyzer — Ops & Debug Runbook

## Stack Overview

| Service | Process | Port | Notes |
|---|---|---|---|
| Frontend | `har-frontend` (PM2 id:7) | 3000 | Static files via python3 http.server |
| Backend API | `har-backend` (PM2 ids:2-5) | 4000 | 4x cluster, Express + TypeScript |
| Worker | `har-worker` (PM2 ids:6-7) | 4001 | 2x fork mode, BullMQ, --expose-gc --max-old-space-size=4096 |
| MongoDB | system service | 27017 | `har-analyzer` database |
| Redis | system service | 6379 | Job queue + pub/sub |

**VM:** `celvpvm05798.us.oracle.com`
**UI URL:** `http://10.65.39.163:3000`
**UI Hostname URL:** `http://celvpvm05798.us.oracle.com:3000`
**Backend URL:** `http://10.65.39.163:4000`

***

## Experimental Support Analyzer Workbench Deployment

The experimental deployment must stay separate from the original HAR Analyzer
deployment. Do not reuse ports 3000, 4000, 4173, or 4317 for the experiment.

| Service | PM2 Process | Port | Path |
|---|---|---|---|
| HAR experimental frontend | `har-exp-frontend` | 3100 | `/refresh/home/Downloads/har-analyzer-exp` |
| HAR experimental backend | `har-exp-backend` | 4100 | `/refresh/home/Downloads/har-analyzer-exp/backend` |
| HAR experimental worker | `har-exp-worker` | n/a | `/refresh/home/Downloads/har-analyzer-exp/backend` |
| Support Analyzer MCP endpoint | `har-exp-backend` | 4100 | `http://10.65.39.163:4100/mcp` |
| Support Workbench experimental frontend | `support-workbench-exp-frontend` | 4174 | `/refresh/home/Downloads/support-workbench-exp` |
| Support Workbench experimental backend | `support-workbench-exp-backend` | 4318 | `/refresh/home/Downloads/support-workbench-exp/backend` |

**Experimental UI URL:** `http://10.65.39.163:3100`
**Experimental Workbench embed URL:** `http://10.65.39.163:4174/?embedded=1&theme=dark`
**Experimental HAR backend URL:** `http://10.65.39.163:4100`
**Experimental MCP URL:** `http://10.65.39.163:4100/mcp`
**Experimental Workbench backend URL:** `http://10.65.39.163:4318`

### Source Branch

The current experimental HAR shell work is pushed from:

```bash
https://github.com/swarnim-sawane/HAR-File-Analyser.git
branch: unified-support-workbench
```

The embedded AI Diagnosis workbench is pushed from:

```bash
https://github.com/swarnim-sawane/support-workbench.git
branch: uat
```

Use the original `main` branch only for the existing production-style HAR
deployment. Use `unified-support-workbench` for the experimental Support
Analyzer Workbench. Use `uat` for the experimental Support Workbench embed.

### Critical VM Rule: No npm install on VCAP

Do not run `npm install`, `npm ci`, or frontend `npm run build` on the VCAP VM.
Build locally, then copy build artifacts to the VM.

Allowed on VM:

- `git fetch`, `git checkout`, `git pull`
- PM2 restarts
- extracting tarballs created locally
- using already-copied `node_modules`
- backend `npm run build` only if the Linux dependencies already exist and no package changes were made

Not allowed on VM:

- dependency installation from npm registry
- frontend Vite builds
- changing the original 3000/4000 deployment while updating the experiment

### Local Build for Experimental HAR Frontend

Before copying frontend artifacts, set local `.env.production` for the
experimental ports:

```powershell
VITE_API_URL=http://10.65.39.163:4100
VITE_BACKEND_URL=http://10.65.39.163:4100
VITE_WS_URL=http://10.65.39.163:4100
VITE_SUPPORT_WORKBENCH_URL=http://10.65.39.163:4174
```

Then build and copy the frontend:

```powershell
cd "C:\Users\ssawane\Documents\Work\HAR LATEST\Experimental build\HAR-File-Analyser"
git checkout unified-support-workbench
git pull origin unified-support-workbench
npm run build
scp -r dist oracle@celvpvm05798.us.oracle.com:/refresh/home/Downloads/har-analyzer-exp/
```

On the VM:

```bash
cd /refresh/home/Downloads/har-analyzer-exp
git fetch origin unified-support-workbench
git checkout unified-support-workbench
git pull origin unified-support-workbench
pm2 restart har-exp-frontend --update-env
pm2 save
```

### If Backend Code or Dependencies Changed

If `backend/`, `package.json`, `package-lock.json`, `backend/package.json`, or
`backend/package-lock.json` changed, do an artifact deployment instead of a
simple frontend copy.

Local machine:

```powershell
cd "C:\Users\ssawane\Documents\Work\HAR LATEST\Experimental build\HAR-File-Analyser"
git checkout unified-support-workbench
git pull origin unified-support-workbench
npm run build
cd backend
npm run build
cd ..
tar -czf har-analyzer-exp-artifacts.tgz dist package.json package-lock.json node_modules backend/package.json backend/package-lock.json backend/node_modules backend/dist shared scripts VM_RUNBOOK.md
scp har-analyzer-exp-artifacts.tgz oracle@celvpvm05798.us.oracle.com:/refresh/home/Downloads/
```

VM:

```bash
cd /refresh/home/Downloads/har-analyzer-exp
git fetch origin unified-support-workbench
git checkout unified-support-workbench
git pull origin unified-support-workbench
tar -xzf /refresh/home/Downloads/har-analyzer-exp-artifacts.tgz -C /refresh/home/Downloads/har-analyzer-exp
pm2 restart har-exp-backend --update-env
pm2 restart har-exp-frontend --update-env
pm2 restart har-exp-worker --update-env
pm2 save
```

### Local Build for Experimental Support Workbench

Pulling the Support Workbench source is not enough when frontend, backend, or
runtime code changes. The experimental PM2 apps run compiled output from
`frontend/dist`, `backend/dist`, and `runtime/dist`, so build locally and copy
those artifacts to the VM.

Local machine:

```powershell
cd "C:\Users\ssawane\Documents\Work\claude-code"
git checkout uat
git pull origin uat
npm run test
npm run build
tar -czf support-workbench-exp-artifacts.tgz frontend/dist backend/dist runtime/dist package.json package-lock.json frontend/package.json backend/package.json runtime/package.json frontend-server.mjs
scp support-workbench-exp-artifacts.tgz oracle@celvpvm05798.us.oracle.com:/refresh/home/Downloads/
```

VM:

```bash
cd /refresh/home/Downloads/support-workbench-exp
git fetch origin uat
git checkout uat
git pull origin uat
tar -xzf /refresh/home/Downloads/support-workbench-exp-artifacts.tgz -C /refresh/home/Downloads/support-workbench-exp
pm2 restart support-workbench-exp-backend --update-env
pm2 restart support-workbench-exp-frontend --update-env
pm2 save
```

If package files changed, also copy the matching local `node_modules` artifact.
Do not run `npm install` or `npm ci` on the VM.

### Experimental HAR Backend .env Minimums

```bash
PORT=4100
MONGODB_URL=mongodb://localhost:27017/har-analyzer-exp
REDIS_HOST=localhost
REDIS_PORT=6379
HAR_QUEUE_NAME=har-processing-exp
LOG_QUEUE_NAME=log-processing-exp
UPLOAD_DIR=/refresh/home/Downloads/har-analyzer-exp/runtime/uploads
PROCESSED_DIR=/refresh/home/Downloads/har-analyzer-exp/runtime/processed
CORS_ORIGIN=http://10.65.39.163:3100
SUPPORT_WORKBENCH_API_URL=http://localhost:4318
SUPPORT_ANALYZER_HAR_API_URL=http://localhost:4100
SUPPORT_ANALYZER_UI_URL=http://10.65.39.163:3100
QDRANT_URL=http://localhost:6333
HTTPS_PROXY=http://www-proxy-phx.oraclecorp.com:80
HTTP_PROXY=http://www-proxy-phx.oraclecorp.com:80
NO_PROXY=localhost,127.0.0.1,10.65.39.163,celvpvm05798.us.oracle.com
```

### Experimental MCP Server

The normal MCP access path is the VCAP-hosted HTTP endpoint exposed by
`har-exp-backend`:

```text
http://10.65.39.163:4100/mcp
```

Engineers should configure the approved LLM client with that URL. They should
not need to run a local MCP process for normal usage.

The endpoint calls the experimental HAR backend on 4100 and the experimental
Support Workbench backend on 4318. Workspace state is persisted through Redis so
PM2 cluster workers can share MCP workspaces.

HTTP smoke test after extracting backend artifacts and restarting
`har-exp-backend`:

```bash
curl -s -X POST http://localhost:4100/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected response includes these tools:

- `create_workspace`
- `upload_evidence`
- `list_evidence`
- `analyze_evidence`
- `search_evidence`
- `inspect_evidence`
- `ask_ai_diagnosis`
- `generate_support_report`
- `open_in_workbench`

Example remote MCP client config for the experimental VM:

```json
{
  "mcpServers": {
    "support-analyzer-workbench": {
      "url": "http://10.65.39.163:4100/mcp"
    }
  }
}
```

The older stdio entry point still exists for maintainers who are debugging the
MCP implementation directly:

```bash
cd /refresh/home/Downloads/har-analyzer-exp/backend
node dist/mcp/server.js
```

### Experimental Verification

Run these after every experimental deploy:

```bash
curl -I http://localhost:3100
curl -s http://localhost:4100/health
curl -s http://localhost:4318/api/health/oca
curl -I "http://localhost:4174/?embedded=1&theme=dark"
pm2 list
```

Expected PM2 processes online:

- `har-exp-backend`
- `har-exp-worker`
- `har-exp-frontend`
- `support-workbench-exp-backend`
- `support-workbench-exp-frontend`

If files uploaded in Visual Analysis do not appear in AI Diagnosis, check:

```bash
grep SUPPORT_WORKBENCH_API_URL /refresh/home/Downloads/har-analyzer-exp/backend/.env
grep -o "10\.65\.39\.163:4174\|localhost:4173" /refresh/home/Downloads/har-analyzer-exp/dist/assets/*.js | sort | uniq -c
pm2 logs har-exp-backend --lines 100
pm2 logs support-workbench-exp-backend --lines 100
```

The frontend bundle must reference `10.65.39.163:4174`, not `localhost:4173`,
for the experimental AI Diagnosis iframe.

***

## Daily Token Refresh (OCA expires ~1hr)

```bash
refresh-token   # alias in ~/.bashrc — prompts for token, updates .env, restarts backend
```

Manual alternative:
```bash
sed -i 's/^OCA_TOKEN=.*/OCA_TOKEN=YOUR_NEW_TOKEN/' ~/Downloads/har-analyzer/backend/.env
pm2 restart har-backend --update-env
```

***

## Full Redeploy from Local

### Step 1 — Local machine (PowerShell)
```powershell
# ALWAYS build from main branch
git checkout main
git pull origin main

# Frontend build — .env.production MUST have both vars
# C:\Users\ssawane\Downloads\har-analyzer\.env.production:
#   VITE_API_URL=http://10.65.39.163:4000
#   VITE_BACKEND_URL=http://10.65.39.163:4000
npm run build

# Deploy frontend
scp -r dist oracle@celvpvm05798.us.oracle.com:/refresh/home/Downloads/har-analyzer/
```

### Step 2 — On VM
```bash
# Pull latest code
cd ~/Downloads/har-analyzer
git pull origin main

# Rebuild backend (TypeScript only — tsc works without native binaries)
cd backend
npm run build

# Restart everything
pm2 restart har-backend --update-env
pm2 restart har-frontend --update-env

# Workers — DO NOT use pm2 restart for workers (loses --expose-gc flag).
# Instead, delete and re-create from the config file:
pm2 delete har-worker
pm2 start /tmp/worker.config.cjs
pm2 save
```

> **Note:** Frontend must always be built on local machine (`npm run build`) and
> deployed via `scp`. Do not run `npm install` or frontend `npm run build` on the
> VM: npm registry access is blocked by the corporate proxy setup, and copied
> `node_modules` may also miss Linux-native optional packages such as Rollup.

***

## Known Workarounds (DO NOT SKIP)

### 1. Node.js fetch doesn't use HTTPS_PROXY
`curl` respects proxy env vars but Node.js undici does NOT automatically.

**Fix already applied in `backend/src/server.ts` (top of file):**
```ts
import { setGlobalDispatcher, ProxyAgent } from 'undici';
const _proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (_proxy) { setGlobalDispatcher(new ProxyAgent(_proxy)); }
```

If this ever gets lost after a git pull or reset, re-add it and rebuild.

### 2. PM2 doesn't inherit shell proxy vars
Proxy must be in `backend/.env` explicitly:
```
HTTPS_PROXY=http://www-proxy-phx.oraclecorp.com:80
HTTP_PROXY=http://www-proxy-phx.oraclecorp.com:80
https_proxy=http://www-proxy-phx.oraclecorp.com:80
http_proxy=http://www-proxy-phx.oraclecorp.com:80
NO_PROXY=localhost,127.0.0.1,10.65.39.163,celvpvm05798.us.oracle.com
```

### 3. Frontend must be built with correct env vars
If AI chat silently fails or uploads go to `localhost`, the build used wrong/missing `.env.production`.

**Verify after every deploy:**
```bash
grep -o "10\.65\.39\.163:4000" ~/Downloads/har-analyzer/dist/assets/*.js | wc -l
# Must return 2 or more
```

### 4. Worker Node.js flags are silently ignored by `pm2 start --node-args`
`pm2 start dist/worker.js --node-args="--expose-gc"` appears to work but
`pm2 show har-worker` will show no interpreter args and `global.gc()` calls
will be silent no-ops. The only reliable way is a config file.

**Config file at `/tmp/worker.config.cjs` (recreate if VM reboots):**
```js
module.exports = {
  apps: [{
    name: 'har-worker',
    script: '/home/oracle/Downloads/har-analyzer/backend/dist/worker.js',
    instances: 2,
    exec_mode: 'fork',
    node_args: '--max-old-space-size=4096 --expose-gc',
    env: {
      NODE_ENV: 'production',
      WORKER_CONCURRENCY: '4',
    }
  }]
};
```

**Start command:**
```bash
pm2 delete har-worker
pm2 start /tmp/worker.config.cjs
pm2 save
# Verify flags applied:
pm2 show har-worker | grep "interpreter args"
# Expected: --max-old-space-size=4096 | --expose-gc
```

### 5. MongoDB duplicate key on re-upload
If you see `E11000 duplicate key error ... fileId_1`, a stale record exists.

**Fix:**
```bash
mongosh
db = db.getSiblingDB('har-analyzer')
db.har_files.deleteMany({ fileId: "PASTE_CONFLICTING_FILEID_HERE" })
exit
pm2 restart har-backend --update-env
pm2 restart har-worker --update-env
```

***

## Debugging Cheatsheet

```bash
# Watch all live logs
pm2 logs

# Watch specific service
pm2 logs har-backend --lines 0
pm2 logs har-worker --lines 0

# Clear all logs before reproducing a bug
pm2 flush

# Check all process status
pm2 list

# Verify OCA is reachable from shell
curl -s -o /dev/null -w "%{http_code}" \
  https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm/v1/models \
  -H "Authorization: Bearer $(grep OCA_TOKEN ~/Downloads/har-analyzer/backend/.env | cut -d= -f2)"
# Expected: 200

# Verify proxy is in PM2 env
pm2 env 2 | grep -i proxy

# Check what API URL is baked into frontend
grep -o "10\.65\.39\.163:4000\|localhost:4000" ~/Downloads/har-analyzer/dist/assets/*.js | sort | uniq -c

# MongoDB shell
mongosh
db = db.getSiblingDB('har-analyzer')
db.har_files.find().sort({uploadedAt:-1}).limit(5)
```

***

## Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `All HAR uploads failed` | Frontend pointing to `localhost:4000` | Rebuild with correct `.env.production` |
| `E11000 duplicate key` | Stale MongoDB record | `deleteMany({ fileId: "..." })` in mongosh |
| `ConnectTimeoutError` on OCA | Node.js fetch ignores proxy | Ensure `setGlobalDispatcher` is in `server.ts` |
| `fetch failed` in Node test | No proxy set | Proxy vars missing from `.env` |
| AI chat shows old UI | Wrong branch built | `git checkout main` before building |
| `OCA proxy error: fetch failed` | Token expired | Run `refresh-token` alias |
| Worker processes stale jobs | PM2 in-memory retry | `pm2 flush` then `pm2 restart har-worker` |

***

## Backend .env Template

```bash
# Oracle Cloud AI
OCA_BASE_URL=https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm/v1
OCA_MODEL=oca/gpt-5.4
OCA_TOKEN=<refresh every ~1hr via refresh-token alias>
OCA_TOKEN_SET_AT=0

# Ollama fallback
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

# Databases
MONGODB_URL=mongodb://localhost:27017/har-analyzer
REDIS_HOST=localhost
REDIS_PORT=6379
UPLOAD_DIR=/tmp/har-processed
PROCESSED_DIR=/tmp/har-processed

# Corporate proxy (required for Node.js fetch to reach OCA)
HTTPS_PROXY=http://www-proxy-phx.oraclecorp.com:80
HTTP_PROXY=http://www-proxy-phx.oraclecorp.com:80
https_proxy=http://www-proxy-phx.oraclecorp.com:80
http_proxy=http://www-proxy-phx.oraclecorp.com:80
NO_PROXY=localhost,127.0.0.1,10.65.39.163,celvpvm05798.us.oracle.com
```

