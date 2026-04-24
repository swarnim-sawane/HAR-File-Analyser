# VM Performance Design — HAR File Analyser
**Date:** 2026-04-24

## Context

HAR File Analyser deployed on Oracle Linux 9.2 VirtualBox VM (8 CPU, 16GB RAM, 100GB storage).
Upload + processing of large HAR files (45MB–100MB) takes 2–3 minutes on VM vs 2–3 seconds locally.

### Root Cause Analysis (Confirmed via HAR diagnostic capture)

| Cause | Evidence | Impact |
|-------|----------|--------|
| Corporate network caps at ~0.8 MB/s | HAR capture: chunks upload at 0.5–1.6 MB/s | 99MB ÷ 0.8 MB/s = 124s upload |
| HAR fetch reads+re-serializes entire file | `harRoutes.ts:52-59`: readFile → JSON.parse → res.json | 32.5s for response |
| No gzip on API responses | No compression middleware | Large JSON sent uncompressed |
| 4 parallel chunks on bandwidth-constrained link | HAR shows chunk timeouts, status 0 errors | Contention + retries |
| Root partition 95% full | `df -h`: /dev/sda3 95% | MongoDB WAL slow |
| Worker concurrency 8 (2×4) on disk bottleneck | ecosystem.config.cjs | Parallel writes contend on slow disk |

**Already fixed (Phase 0 — done):**
- MongoDB migrated from `/` (95% full) to `/refresh` (37GB free)
- Worker concurrency reduced from 8 to 2
- Root disk cleaned

## Design

### Four code changes, highest to lowest impact

---

### Change 1 — Express gzip compression (server → client)

**Files:** `backend/src/server.ts`, `backend/package.json`

Add `compression` middleware. All JSON API responses gzip'd automatically. HAR files are JSON text — compresses ~10:1.

```
Before: 99MB raw JSON response → ~124s download at 0.8 MB/s
After:  ~10MB gzip'd response  → ~12.5s download at 0.8 MB/s
```

Middleware goes before all routes, after CORS.

---

### Change 2 — Stream HAR file directly (skip parse + re-serialize)

**File:** `backend/src/routes/harRoutes.ts` (lines 52–59)

Current code: `readFile(99MB) → JSON.parse → res.json`. This parses and re-serializes the entire file on every fetch — wasted CPU and memory.

Replace with `res.sendFile(resolvedFilePath)` after validating path. File was already validated on upload; no need to re-parse. Works with Change 1 (compression middleware gzips the stream).

```
Before: readFile → JSON.parse → res.json (CPU-bound, full 99MB in memory)
After:  res.sendFile (streaming, OS-level, no parse overhead)
```

---

### Change 3 — Frontend upload compression

**Files:** `src/services/chunkedUploader.ts`, `backend/src/routes/uploadRoutes.ts`, `backend/src/services/streamingParser.ts`

Compress the File blob with browser's native `CompressionStream('gzip')` before chunking. Send compressed data. Server receives compressed assembly, worker decompresses via `zlib.createGunzip()` pipe in streaming parser.

```
Before: 99MB raw upload at 0.8 MB/s = 124s
After:  ~10MB compressed upload = 12.5s
```

Handshake: add `compressed: 'gzip'` field in `/api/upload/complete` body. Worker reads flag from job data, conditionally pipes gunzip.

HAR JSON compresses ~10:1. Log files compress ~8:1.

---

### Change 4 — Reduce parallel chunks and chunk size

**File:** `src/services/chunkedUploader.ts`

```
CHUNK_SIZE:      10MB → 3MB   (cheaper retry on timeout; fewer multer-size issues)
PARALLEL_UPLOADS: 4  → 2     (less bandwidth contention on 0.8 MB/s link)
```

On a bandwidth-constrained link, 4 parallel × 10MB chunks compete for the same pipe, causing timeouts and retries (Chunk #9 in HAR: 59s timeout, status 0). Sequential/reduced parallelism avoids this.

---

## Data Flow After Changes

```
Browser → compress File (gzip) → slice 3MB chunks → 2 parallel uploads
      → /api/upload/chunk (multer, no decompression needed, assembles .gz)
      → /api/upload/complete { compressed: 'gzip' }
      → BullMQ job { filePath, compressed: 'gzip' }
      → Worker: createReadStream(filePath).pipe(createGunzip()).pipe(JSONStream)
      → MongoDB batch inserts (5000/batch, ordered:false, j:false)

Browser → GET /api/har/:fileId
      → res.sendFile (stream raw file)
      → compression middleware gzips on the fly
      → Browser receives ~10MB instead of ~99MB
```

---

## Files Changed

| File | Change |
|------|--------|
| `backend/package.json` | add `compression`, `@types/compression` |
| `backend/src/server.ts` | `app.use(compression())` before routes |
| `backend/src/routes/harRoutes.ts` | replace readFile→parse→json with `res.sendFile` |
| `src/services/chunkedUploader.ts` | compress before chunking; CHUNK_SIZE→3MB; PARALLEL→2 |
| `backend/src/routes/uploadRoutes.ts` | pass `compressed` flag through to job data |
| `backend/src/services/streamingParser.ts` | conditionally pipe through `zlib.createGunzip()` |

---

## Verification

1. **Upload speed**: Upload 45MB HAR. Should complete upload phase in <60s (vs ~60s raw, now ~6s compressed)
2. **HAR fetch**: After processing, `GET /api/har/:fileId` response time <10s (vs 32.5s)
3. **No regression**: Upload 100KB HAR — should still work correctly, parse correctly
4. **Content check**: Frontend analyzer must render entries correctly (same data, just compressed in transit)
5. **Compression header check**: `curl -I -H 'Accept-Encoding: gzip' http://10.65.39.163:4000/api/har/...` → `Content-Encoding: gzip`
6. **Worker logs**: `pm2 logs har-worker` — confirm processing completes, no gunzip errors

## Expected Outcome

| Scenario | Before | After |
|----------|--------|-------|
| 99MB HAR upload | ~124s network + ~40s processing | ~12s network + ~40s processing |
| HAR fetch response | 32.5s | 3–5s |
| 45MB HAR total | ~2 min | ~20s |
| Chunk timeout rate | High (4 parallel × 10MB) | Low (2 parallel × 3MB) |
