# OpenAPI Stress Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and run an opt-in stress harness for GB-scale HAR uploads and high-entry-count diagnostic API checks.

**Architecture:** Keep the existing fast `test:openapi:endpoints` suite as the regular regression gate, and add a separate Node-based stress script that streams generated HAR fixtures to disk, uploads them chunk-by-chunk, polls worker completion, exercises v1 automation endpoints, and cleans test data. The harness uses isolated Oracle table names, queue names, upload directories, and backend ports supplied through environment variables.

**Tech Stack:** Node.js CommonJS script, native `fetch`/`FormData`, Oracle Database driver, Express backend, Oracle-backed worker.

---

### Task 1: Stress Harness

**Files:**
- Create: `scripts/openapi-stress-test.cjs`
- Modify: `package.json`

- [ ] **Step 1: Create a streaming fixture generator**

Implement a function that writes a valid HAR file to disk using `fs.createWriteStream`. It must write entry JSON incrementally and generate large `response.content.text` fields in repeated 1 MB blocks so a 1 GB fixture is never held fully in memory.

- [ ] **Step 2: Create chunked upload runner**

Implement a function that reads the generated fixture with `fs.open`, uploads each chunk through `POST /api/upload/chunk` using chunk buffers below the backend 12 MB limit, then calls `POST /api/upload/complete`.

- [ ] **Step 3: Poll and assert diagnostic endpoints**

Poll `GET /api/har/{fileId}/status` until `ready`, then assert `GET /api/v1/har/{fileId}/summary`, `GET /api/v1/har/{fileId}/errors`, `GET /api/v1/har/{fileId}/insights/context`, and representative legacy HAR endpoints.

- [ ] **Step 4: Add package script**

Add `test:openapi:stress` pointing to the stress harness so it can be rerun with environment variables such as `STRESS_SIZE_MB`, `STRESS_ENTRIES`, and `STRESS_CHUNK_MB`.

### Task 2: Isolated Runtime

**Files:**
- No source changes expected.

- [ ] **Step 1: Build backend**

Run `npm run build` in `backend` so the stress test uses compiled JavaScript instead of `ts-node`.

- [ ] **Step 2: Start isolated backend**

Start `node dist/server.js` with `PORT=4200`, Oracle Database environment variables, `HAR_QUEUE_NAME=har-openapi-stress`, `LOG_QUEUE_NAME=log-openapi-stress`, `UPLOAD_DIR=C:\tmp\har-openapi-stress\uploads`, and `PROCESSED_DIR=C:\tmp\har-openapi-stress\processed`.

- [ ] **Step 3: Start isolated worker**

Start `node --max-old-space-size=4096 --expose-gc dist/worker.js` with the same database, queue, upload, and processed directories.

### Task 3: Execute Stress Profiles

**Files:**
- No source changes expected unless failures expose a root cause.

- [ ] **Step 1: Run GB-scale profile**

Run `npm run test:openapi:stress` with `STRESS_SIZE_MB=1024`, `STRESS_ENTRIES=64`, and `STRESS_CHUNK_MB=8`. Expected result: upload completes, worker reaches `ready`, v1 endpoints return bounded responses, and cleanup removes test files.

- [ ] **Step 2: Run high-entry profile**

Run `npm run test:openapi:stress` with `STRESS_SIZE_MB=128`, `STRESS_ENTRIES=25000`, and `STRESS_CHUNK_MB=8`. Expected result: Oracle JSON insertion succeeds, summary/error pagination remain responsive, and context generation stays bounded.

- [ ] **Step 3: Record timings**

Capture generation time, upload time, completion time, worker processing time, and endpoint response times. Flag any endpoint over 2 seconds for summary/errors or over 5 seconds for context.

### Task 4: Verification

**Files:**
- Existing tests and builds.

- [ ] **Step 1: Run endpoint regression**

Run `npm run test:openapi:endpoints`. Expected result: all endpoint checks pass.

- [ ] **Step 2: Run backend tests and build**

Run `npm run test` and `npm run build` from `backend`. Expected result: all tests pass and TypeScript compiles.

- [ ] **Step 3: Run root tests and build**

Run `npm run test` and `npm run build` from the repo root. Expected result: all tests pass and Vite builds, allowing the existing chunk-size warning only.
