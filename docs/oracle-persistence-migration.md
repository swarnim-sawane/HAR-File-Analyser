# Oracle JSON Persistence Migration

## Goal

Run HAR File Analyzer with Oracle-managed persistence. This branch stores analyzer documents in Oracle Database JSON storage and has no non-Oracle document-store runtime fallback.

## Current Branch Position

- **Document persistence:** Oracle Database with JSON support.
- **Node driver:** `oracledb`.
- **Runtime fallback:** none. The backend requires Oracle Database credentials at startup.
- **Cache / queue / pub-sub:** Redis-compatible cache remains required for BullMQ, upload progress, and Socket.IO event bridging. In OCI this should map to an approved Redis-compatible cache service.
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

CACHE_HOST=<cache-host>
CACHE_PORT=6379
# or CACHE_URL=rediss://<cache-endpoint>:6379
# CACHE_TLS=true
# CACHE_USERNAME=<optional-user>
# CACHE_PASSWORD=<optional-password>
```

## Storage Model

The adapter stores documents in one Oracle table by logical collection:

- `har_files`
- `har_entries`
- `console_log_files`
- `console_logs`

The table keeps hot query fields as indexed columns and stores the full analyzer payload in a JSON-checked CLOB column.

Hot indexed fields include:

- `collection_name`
- `file_id`
- `entry_index`
- `uploaded_at`
- HAR status/method/url/timing fields
- console level/source/timestamp/severity fields
- parser status and parser format

## Compatibility Approach

Most routes and workers currently use a document-collection style API. The Oracle adapter intentionally exposes a small compatible API:

- `collection(name)`
- `find`, `findOne`, `sort`, `skip`, `limit`, `project`, `toArray`
- `insertOne`, `insertMany`
- `countDocuments`, `deleteMany`
- selected aggregation stages used by console-log facets

This keeps the migration scoped while avoiding a risky application-wide rewrite. The adapter remains an internal compatibility layer; Oracle JSON is the only configured document persistence backend on this branch.

## Local Development

Local compose starts only Redis and Qdrant:

```powershell
docker compose -f backend/docker-compose.yml up -d redis qdrant
```

An Oracle Database connect string must be supplied in `backend/.env` before starting the backend.

## Validation Checklist

- Backend starts only when Oracle Database credentials are present.
- Non-Oracle document-store backend settings are rejected.
- HAR upload parses and stores file metadata and entries in Oracle JSON persistence.
- Console-log upload parses and stores metadata and paged entries in Oracle JSON persistence.
- Search, filters, sorting, pagination, details, retention cleanup, and automation endpoints continue to work.
- Redis-compatible cache still delivers queue jobs, upload progress, and socket events.

## Remaining Hardening

- Run against a real OCI Oracle Database instance with representative HAR and console-log volumes.
- Confirm DDL permissions and table/index naming policy with the database-owning team.
- Add migration/versioning scripts if the owning team wants schema changes managed outside app startup.
- Decide whether Qdrant remains acceptable or should be replaced by an Oracle-approved retrieval service later.
