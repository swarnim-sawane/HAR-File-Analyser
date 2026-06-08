# Oracle Persistence Migration Plan

## Goal

Move the HAR File Analyzer away from self-managed MongoDB and Redis while keeping the application deployable in Oracle-controlled infrastructure.

## Recommended Path

### Phase 1: Oracle-managed compatibility mode

This is the lowest-risk rollout path because it keeps the existing application behavior and avoids a risky full persistence rewrite.

- **Document store:** Oracle Database API for MongoDB / Autonomous Database JSON-compatible endpoint.
  - Keep the current MongoDB Node driver.
  - Point `MONGODB_URL` at the Oracle Database API for MongoDB connection string.
  - Validate existing query operators used by the app: equality, `$in`, `$lt`, `$regex`, `$and`, `$or`, projection, sort, skip/limit, count, insertMany, deleteMany, and aggregation group/unwind.

- **Cache / queue / pub-sub:** OCI Cache non-sharded Valkey/Redis-compatible cluster.
  - Keep `ioredis` and BullMQ for now.
  - Use `OCI_CACHE_URL` or `OCI_CACHE_HOST` / `OCI_CACHE_PORT`.
  - Prefer a non-sharded cluster because BullMQ depends on Redis-compatible queue semantics and Lua scripting behavior.

This branch adds cache configuration support for:

```bash
OCI_CACHE_URL=rediss://<cache-endpoint>:6379
OCI_CACHE_TLS=true
OCI_CACHE_USERNAME=<optional-user>
OCI_CACHE_PASSWORD=<optional-password>
```

or:

```bash
OCI_CACHE_HOST=<cache-endpoint>
OCI_CACHE_PORT=6379
OCI_CACHE_TLS=true
OCI_CACHE_PASSWORD=<optional-password>
```

Legacy local development variables still work:

```bash
MONGODB_URL=mongodb://localhost:27017/har-analyzer
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Phase 2: Native Oracle persistence rewrite

Use this only if OCI/security requires no MongoDB protocol and no Redis-compatible cache layer.

### Database

Replace direct Mongo collection calls with repository interfaces backed by Oracle Database:

- `har_files`
- `har_entries`
- `console_log_files`
- `console_logs`
- upload/session/cache metadata

Recommended table shape:

- relational columns for hot filters: `file_id`, `entry_index`, `status`, `method`, `url`, `timestamp`, `level`, `source`, `inferred_severity`, `parse_status`, `parse_format`
- native JSON column for full HAR/log payload
- Oracle JSON/search indexes for URL/message/source search

### Queue and status events

Replace BullMQ/Redis with Oracle Transactional Event Queues or Advanced Queuing:

- `HAR_PROCESSING_QUEUE`
- `LOG_PROCESSING_QUEUE`
- optional `SOCKET_EVENT_QUEUE`

Workers dequeue jobs from Oracle AQ/TxEventQ, process files, and write progress/status into Oracle tables. The backend can either consume socket events from AQ/TxEventQ or poll status rows for active uploads.

## Current Redis Responsibilities

Redis is not just cache in this app:

- BullMQ queue backend for HAR and console-log processing
- upload chunk tracking
- upload progress
- in-progress file metadata/status
- stats cache
- Socket.IO cross-process event bridge
- session activity marker
- retention cleanup key deletion

That is why replacing Redis with native Oracle AQ is a real rewrite, not a package swap.

## Acceptance Criteria

Phase 1 is acceptable when:

- Upload chunk flow works against OCI Cache.
- HAR processing and console-log processing complete through BullMQ.
- Socket progress events reach the browser from worker process to backend process.
- Existing analyzer pagination/search/filter endpoints work against Oracle Database API for MongoDB.
- Retention cleanup deletes Oracle-backed metadata and cache keys correctly.

Phase 2 is acceptable when:

- No `mongodb`, `ioredis`, or `bullmq` runtime dependency is required.
- All persistence access goes through repository/queue interfaces.
- Oracle schema migrations are repeatable.
- Large HAR and console-log files still stream into storage without loading the full file into memory.
- Existing API and UI behavior remain unchanged.

