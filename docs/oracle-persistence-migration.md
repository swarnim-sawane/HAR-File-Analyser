# Oracle JSON Persistence And Runtime Migration

## Goal

Run HAR File Analyzer with Oracle Database as the only required backend state service. This branch stores analyzer documents, transient upload metadata, queue audit state, and Socket.IO event envelopes in Oracle Database JSON storage, and uses Oracle AQ/TEQ for worker job delivery.

## Current Branch Position

- **Document persistence:** Oracle Database with JSON support.
- **Runtime cache:** Oracle-backed document keys via `OracleCacheStore`.
- **Queueing:** Oracle AQ/TEQ via `OracleAqJobQueue`; Oracle JSON keeps queue audit/count records.
- **Cross-process events:** Oracle-backed event stream via `OracleEventBus`.
- **Runtime fallback:** none. The backend requires Oracle Database credentials at startup.
- **Vector store:** Qdrant remains optional for embedding retrieval paths.

## Required Backend Environment

```bash
PERSISTENCE_BACKEND=oracle-json
ORACLE_DB_USER=<oracle-user>
ORACLE_DB_PASSWORD=<oracle-password>
ORACLE_DB_CONNECT_STRING=<oracle-connect-string>
ORACLE_JSON_TABLE=HAR_ANALYZER_DOCS
ORACLE_DB_POOL_MIN=1
ORACLE_DB_POOL_MAX=10

ORACLE_AQ_AUTO_CREATE=true
ORACLE_AQ_QUEUE_PREFIX=HAR_ANALYZER
ORACLE_QUEUE_POLL_INTERVAL_MS=500
ORACLE_EVENT_POLL_INTERVAL_MS=250

QDRANT_URL=http://localhost:6333
```

## Storage Model

The adapter stores documents in one Oracle table by logical collection:

- `har_files`
- `har_entries`
- `console_log_files`
- `console_logs`
- `oracle_runtime_cache`
- `oracle_runtime_sets`
- `oracle_runtime_jobs`
- `oracle_runtime_events`

The table keeps hot query fields as indexed columns and stores the full analyzer payload in a JSON-checked CLOB column.

## Compatibility Approach

Most routes and workers use a document-collection style API. The Oracle adapter intentionally exposes a small compatible API:

- `collection(name)`
- `find`, `findOne`, `sort`, `skip`, `limit`, `project`, `toArray`
- `insertOne`, `insertMany`
- `countDocuments`, `deleteMany`
- selected aggregation stages used by console-log facets

Runtime cache and event delivery are implemented above the same Oracle JSON adapter. Worker jobs are delivered through Oracle AQ/TEQ so the API and worker use a database-native durable queue instead of Redis/BullMQ or the earlier document-polling queue.

## Oracle AQ/TEQ Setup

For local development, the application can create and start its own TEQ queues when `ORACLE_AQ_AUTO_CREATE=true`. The database user needs AQ administration privileges:

```sql
GRANT EXECUTE ON DBMS_AQADM TO <app_user>;
GRANT EXECUTE ON DBMS_AQ TO <app_user>;
GRANT AQ_ADMINISTRATOR_ROLE TO <app_user>;
```

For production, the recommended path is for the database-owning team to pre-provision the queues, start them, grant enqueue/dequeue access to the application schema, and set:

```bash
ORACLE_AQ_AUTO_CREATE=false
```

Default physical queue names:

| Logical queue | Physical AQ/TEQ queue |
| --- | --- |
| `har-processing` | `HAR_ANALYZER_HAR_PROCESSING` |
| `log-processing` | `HAR_ANALYZER_LOG_PROCESSING` |

Worker dequeue uses transactional acknowledgement: the job message is removed only when processing commits successfully, or when a failed attempt is committed with a delayed retry message. Size `ORACLE_DB_POOL_MAX` for API traffic plus active worker concurrency because each active job can hold one Oracle connection until it completes.

## Local Development

Optional Qdrant container:

```powershell
docker compose -f backend/docker-compose.yml up -d qdrant
```

An Oracle Database connect string must be supplied in `backend/.env` before starting the backend.

## Validation Checklist

- Backend starts only when Oracle Database credentials are present.
- Non-Oracle document-store backend settings are rejected.
- HAR upload parses and stores file metadata and entries in Oracle JSON persistence.
- Console-log upload parses and stores metadata and paged entries in Oracle JSON persistence.
- Queue jobs are enqueued, claimed, completed, and retried through Oracle AQ/TEQ.
- Queue audit counts are visible through Oracle JSON runtime job documents.
- Upload progress and file status metadata are read from Oracle runtime cache documents.
- Socket.IO status/progress events are delivered through Oracle runtime event documents.
- Search, filters, sorting, pagination, details, retention cleanup, and automation endpoints continue to work.

## Remaining Hardening

- Run against a real OCI Oracle Database instance with representative HAR and console-log volumes.
- Confirm AQ/TEQ queue ownership, grants, retention, and naming policy with the database-owning team.
- Confirm DDL permissions and table/index naming policy with the database-owning team.
- Add migration/versioning scripts if the owning team wants schema changes managed outside app startup.
- Decide whether Qdrant remains acceptable or should be replaced by an Oracle-approved retrieval service later.
