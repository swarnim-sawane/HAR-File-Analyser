
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
**Backend URL:** `http://10.65.39.163:4000`

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
# ALWAYS build from single-upload branch
git checkout single-upload
git pull origin single-upload

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
> deployed via `scp`. Running `npm run build` on the VM will fail because
> `@rollup/rollup-linux-x64-gnu` is missing (node_modules came from Windows).

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
NO_PROXY=localhost,127.0.0.1,10.65.39.163
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
| AI chat shows old UI | Wrong branch built | `git checkout single-upload` before building |
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
NO_PROXY=localhost,127.0.0.1,10.65.39.163
```

