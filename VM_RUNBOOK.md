
# HAR Analyzer — Ops & Debug Runbook

## Stack Overview

| Service | Process | Port | Notes |
|---|---|---|---|
| Frontend | `har-frontend` | 3000 | Static files via `python3 -m http.server` |
| Backend API | `har-backend` | 4000 | 4x cluster, Express + TypeScript |
| Worker | `har-worker` | N/A | 2x fork mode, BullMQ, --expose-gc --max-old-space-size=4096 |
| MongoDB | system service | 27017 | `har-analyzer` database |
| Redis | system service | 6379 | Job queue + pub/sub |

**VM:** `celvpvm05798.us.oracle.com`
**UI URL:** `http://10.65.39.163:3000`
**UI Hostname URL:** `http://celvpvm05798.us.oracle.com:3000`
**Backend URL:** `http://10.65.39.163:4000`

***

## Daily Token Refresh (OCA expires ~1hr)

```bash
refresh-token   # alias in ~/.bashrc — prompts for token, updates .env, restarts backend
```

Manual alternative:
```bash
sed -i 's/^OCA_TOKEN=.*/OCA_TOKEN=YOUR_NEW_TOKEN/' /refresh/home/Downloads/har-analyzer/backend/.env
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
# C:\Users\ssawane\Documents\Work\HAR LATEST\Deployed build\HAR-File-Analyser\.env.production:
#   VITE_API_URL=http://10.65.39.163:4000
#   VITE_BACKEND_URL=http://10.65.39.163:4000
npm run build

# Deploy frontend
scp -r dist oracle@celvpvm05798.us.oracle.com:/refresh/home/Downloads/har-analyzer/
```

### Step 2 — On VM
```bash
# Pull latest code
cd /refresh/home/Downloads/har-analyzer
git -c http.proxy=http://www-proxy-phx.oraclecorp.com:80 \
    -c https.proxy=http://www-proxy-phx.oraclecorp.com:80 \
    pull origin main

git log -1 --oneline

# Rebuild backend (TypeScript only — tsc works without native binaries)
cd backend
npm run build
cd ..

# Restart backend
pm2 restart har-backend --update-env

# Frontend - replace stale/temp script based processes with direct python server.
pm2 delete har-frontend
pm2 start "python3" \
  --name har-frontend \
  -- -m http.server 3000 --directory /refresh/home/Downloads/har-analyzer/dist

# Workers — DO NOT use pm2 restart for workers (loses --expose-gc flag).
# /tmp is ephemeral, so recreate the config before starting workers.
cat > /tmp/worker.config.cjs <<'EOF'
module.exports = {
  apps: [{
    name: 'har-worker',
    script: '/refresh/home/Downloads/har-analyzer/backend/dist/worker.js',
    instances: 2,
    exec_mode: 'fork',
    node_args: '--max-old-space-size=4096 --expose-gc',
    env: {
      NODE_ENV: 'production',
      WORKER_CONCURRENCY: '4',
    }
  }]
};
EOF

pm2 delete har-worker
pm2 start /tmp/worker.config.cjs

# Verify before saving. Do not run pm2 save while har-frontend or har-worker is missing/errored.
pm2 list
pm2 show har-worker | grep "interpreter args"
curl -I http://localhost:3000
curl http://localhost:4000/health
curl http://localhost:4000/openapi.json | grep "/api/v1/har"

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
grep -o "10\.65\.39\.163:4000" /refresh/home/Downloads/har-analyzer/dist/assets/*.js | wc -l
# Must return 2 or more
```

### 4. Frontend PM2 process must not depend on `/tmp/serve-frontend.sh`
If `har-frontend` is `errored` and logs show:

```text
bash: /tmp/serve-frontend.sh: No such file or directory
```

delete and recreate it with the direct Python command:

```bash
pm2 delete har-frontend
pm2 start "python3" \
  --name har-frontend \
  -- -m http.server 3000 --directory /refresh/home/Downloads/har-analyzer/dist

curl -I http://localhost:3000
pm2 save
```

### 5. Worker Node.js flags are silently ignored by `pm2 start --node-args`
`pm2 start dist/worker.js --node-args="--expose-gc"` appears to work but
`pm2 show har-worker` will show no interpreter args and `global.gc()` calls
will be silent no-ops. The only reliable way is a config file.

**Config file at `/tmp/worker.config.cjs` (recreate before every deploy because `/tmp` is ephemeral):**
```js
module.exports = {
  apps: [{
    name: 'har-worker',
    script: '/refresh/home/Downloads/har-analyzer/backend/dist/worker.js',
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
# Verify flags applied:
pm2 show har-worker | grep "interpreter args"
# Expected: --max-old-space-size=4096 | --expose-gc
pm2 save
```

### 6. MongoDB duplicate key on re-upload
If you see `E11000 duplicate key error ... fileId_1`, a stale record exists.

**Fix:**
```bash
mongosh
db = db.getSiblingDB('har-analyzer')
db.har_files.deleteMany({ fileId: "PASTE_CONFLICTING_FILEID_HERE" })
exit
pm2 restart har-backend --update-env
# Recreate worker from the config in section 5 if processing needs a restart.
pm2 delete har-worker
pm2 start /tmp/worker.config.cjs
```

### 7. Clear stale BullMQ jobs
Use this only when old jobs are being replayed and you intentionally want to clear pending HAR/log processing work. `pm2 flush` only clears PM2 logs; it does not clear Redis queues.

```bash
# Stop workers first so they do not keep consuming stale jobs.
pm2 delete har-worker

# Inspect queue backlog.
redis-cli LLEN bull:har-processing:wait
redis-cli ZCARD bull:har-processing:delayed
redis-cli ZCARD bull:har-processing:failed
redis-cli LLEN bull:log-processing:wait
redis-cli ZCARD bull:log-processing:delayed
redis-cli ZCARD bull:log-processing:failed

# Clear only this application's BullMQ queues.
redis-cli --scan --pattern 'bull:har-processing:*' | xargs -r redis-cli DEL
redis-cli --scan --pattern 'bull:log-processing:*' | xargs -r redis-cli DEL

# Recreate /tmp/worker.config.cjs from section 5 if missing, then start workers.
pm2 start /tmp/worker.config.cjs
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
  -H "Authorization: Bearer $(grep OCA_TOKEN /refresh/home/Downloads/har-analyzer/backend/.env | cut -d= -f2)"
# Expected: 200

# Verify proxy is in PM2 env; use any current har-backend id from pm2 list.
pm2 env <har-backend-id> | grep -i proxy

# Check what API URL is baked into frontend
grep -o "10\.65\.39\.163:4000\|localhost:4000" /refresh/home/Downloads/har-analyzer/dist/assets/*.js | sort | uniq -c

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
| Worker processes stale jobs | Old BullMQ jobs still pending in Redis | Stop `har-worker`, clear only `bull:har-processing:*` / `bull:log-processing:*`, then recreate worker from config |
| `bash: /tmp/serve-frontend.sh: No such file or directory` | PM2 frontend points to a deleted temp script | Recreate `har-frontend` with `python3 -m http.server` |
| `[PM2][ERROR] File /tmp/worker.config.cjs not found` | `/tmp` worker config disappeared | Recreate `/tmp/worker.config.cjs`, then `pm2 start /tmp/worker.config.cjs` |
| `Document is larger than the maximum size 16777216` | Old worker build stored oversized HAR body text in MongoDB | Pull latest `main`, rebuild backend, restart workers |

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

