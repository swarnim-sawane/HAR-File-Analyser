
# HAR Analyzer — Ops & Debug Runbook

## Stack Overview

| Service | Process | Port | Notes |
|---|---|---|---|
| Frontend | `har-frontend` | 3000 | Static files via `python3 -m http.server` |
| Backend API | `har-backend` | 4000 | 4x cluster, Express + TypeScript |
| Worker | `har-worker` | N/A | 2x fork mode, Oracle AQ/TEQ-backed queue, --expose-gc --max-old-space-size=4096 |
| Oracle Database | external/local Oracle service | configured by connect string | JSON persistence, runtime cache, AQ/TEQ queues, and event state |

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
# Optional after a ready HAR exists:
# curl -X POST http://localhost:4000/api/v1/har/PASTE_READY_FILEID/insights

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

### 6. Oracle runtime or duplicate document issue
If an upload appears stuck or a duplicate document/update issue is suspected, first confirm the backend and worker are using the same Oracle Database credentials and table name.

**Fix path:**
```bash
pm2 logs har-backend --lines 100
pm2 logs har-worker --lines 100
pm2 restart har-backend --update-env
pm2 delete har-worker
pm2 start /tmp/worker.config.cjs
```

For manual data cleanup, coordinate with the Oracle Database owner and remove only the affected `fileId` documents from the relevant logical collections in the Oracle JSON table.

### 7. Clear stale Oracle-backed jobs
Use this only when old jobs are being replayed and you intentionally want to clear pending HAR/log processing work. `pm2 flush` only clears PM2 logs; it does not clear Oracle AQ/TEQ messages or Oracle runtime queue audit documents.

Stop the worker first, coordinate with the database owner, and clear only the affected AQ/TEQ messages plus related runtime job audit documents for the affected queue/fileId from the `oracle_runtime_jobs` logical collection. Then recreate `/tmp/worker.config.cjs` from section 5 if missing and start the worker again:

```bash
pm2 delete har-worker
pm2 start /tmp/worker.config.cjs
```

### 8. Retention cleanup for large diagnostic files
Retention cleanup is disabled unless `RETENTION_CLEANUP_ENABLED=true` is set in `backend/.env`. Use dry-run first so the deletion counts can be reviewed before removing customer diagnostic artifacts.

```bash
cd /refresh/home/Downloads/har-analyzer/backend
npm run build

# Dry-run: prints JSON counts without deleting files or database records.
RETENTION_MAX_AGE_HOURS=168 RETENTION_CLEANUP_DRY_RUN=true npm run cleanup:retention

# Actual cleanup after reviewing dry-run output.
RETENTION_MAX_AGE_HOURS=168 RETENTION_CLEANUP_DRY_RUN=false npm run cleanup:retention
```

For scheduled cleanup through the backend process, add these to `backend/.env` and restart `har-backend`:

```bash
RETENTION_CLEANUP_ENABLED=true
RETENTION_MAX_AGE_HOURS=168
RETENTION_CLEANUP_INTERVAL_MINUTES=60
RETENTION_CLEANUP_DRY_RUN=false
```

The cleanup removes expired `har_files`, `har_entries`, `console_log_files`, `console_logs`, Oracle runtime metadata/status keys, processed files, and stale upload chunks that are older than the configured cutoff.

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

# Oracle Database
# Use the approved SQL client/connection method for ORACLE_DB_CONNECT_STRING.
# Inspect HAR_ANALYZER_DOCS rows only with the database owner's guidance.
```

***

## Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `All HAR uploads failed` | Frontend pointing to `localhost:4000` | Rebuild with correct `.env.production` |
| Duplicate document/update issue | Stale Oracle JSON document for the same fileId | Coordinate with DB owner and remove only affected logical collection documents |
| `ConnectTimeoutError` on OCA | Node.js fetch ignores proxy | Ensure `setGlobalDispatcher` is in `server.ts` |
| `fetch failed` in Node test | No proxy set | Proxy vars missing from `.env` |
| AI chat shows old UI | Wrong branch built | `git checkout main` before building |
| `OCA proxy error: fetch failed` | Token expired | Run `refresh-token` alias |
| Worker processes stale jobs | Old Oracle runtime job documents still pending | Stop `har-worker`, clear only affected runtime job documents with DB-owner approval, then recreate worker from config |
| `bash: /tmp/serve-frontend.sh: No such file or directory` | PM2 frontend points to a deleted temp script | Recreate `har-frontend` with `python3 -m http.server` |
| `[PM2][ERROR] File /tmp/worker.config.cjs not found` | `/tmp` worker config disappeared | Recreate `/tmp/worker.config.cjs`, then `pm2 start /tmp/worker.config.cjs` |
| Oversized HAR body text causes storage failure | Old worker build did not truncate large response bodies before Oracle storage | Pull latest `main`, rebuild backend, restart workers |

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

# Oracle Database
PERSISTENCE_BACKEND=oracle-json
ORACLE_DB_USER=<oracle-user>
ORACLE_DB_PASSWORD=<oracle-password>
ORACLE_DB_CONNECT_STRING=<oracle-connect-string>
ORACLE_JSON_TABLE=HAR_ANALYZER_DOCS
ORACLE_DB_POOL_MIN=1
ORACLE_DB_POOL_MAX=10
ORACLE_AQ_AUTO_CREATE=false
ORACLE_AQ_QUEUE_PREFIX=HAR_ANALYZER
ORACLE_QUEUE_POLL_INTERVAL_MS=500
ORACLE_EVENT_POLL_INTERVAL_MS=250
UPLOAD_DIR=/tmp/har-processed
PROCESSED_DIR=/tmp/har-processed

# Retention cleanup (disabled unless explicitly enabled)
RETENTION_CLEANUP_ENABLED=false
RETENTION_MAX_AGE_HOURS=168
RETENTION_CLEANUP_INTERVAL_MINUTES=60
RETENTION_CLEANUP_DRY_RUN=false

# Corporate proxy (required for Node.js fetch to reach OCA)
HTTPS_PROXY=http://www-proxy-phx.oraclecorp.com:80
HTTP_PROXY=http://www-proxy-phx.oraclecorp.com:80
https_proxy=http://www-proxy-phx.oraclecorp.com:80
http_proxy=http://www-proxy-phx.oraclecorp.com:80
NO_PROXY=localhost,127.0.0.1,10.65.39.163,celvpvm05798.us.oracle.com
```

