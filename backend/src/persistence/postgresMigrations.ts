import type { Pool, PoolClient } from 'pg';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATION_LOCK_ID = 721_045_331;

export const POSTGRES_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_analysis_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS har_files (
        file_id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        artifact_key TEXT,
        file_path TEXT,
        file_size BIGINT NOT NULL DEFAULT 0,
        hash TEXT,
        total_entries INTEGER NOT NULL DEFAULT 0,
        stats JSONB NOT NULL DEFAULT '{}'::jsonb,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        status TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS har_entries (
        file_id TEXT NOT NULL REFERENCES har_files(file_id) ON DELETE CASCADE,
        entry_index INTEGER NOT NULL,
        started_datetime TEXT,
        duration_ms DOUBLE PRECISION,
        request_method TEXT,
        request_url TEXT,
        response_status INTEGER,
        response_mime_type TEXT,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (file_id, entry_index)
      );

      CREATE TABLE IF NOT EXISTS console_log_files (
        file_id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        artifact_key TEXT,
        file_path TEXT,
        file_size BIGINT NOT NULL DEFAULT 0,
        hash TEXT,
        total_entries INTEGER NOT NULL DEFAULT 0,
        stats JSONB NOT NULL DEFAULT '{}'::jsonb,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        status TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS console_logs (
        file_id TEXT NOT NULL REFERENCES console_log_files(file_id) ON DELETE CASCADE,
        entry_index INTEGER NOT NULL,
        timestamp_raw TEXT,
        level TEXT,
        source TEXT,
        message TEXT,
        raw_text TEXT,
        url TEXT,
        stack_trace TEXT,
        inferred_severity TEXT,
        issue_tags TEXT[] NOT NULL DEFAULT '{}',
        primary_issue TEXT,
        parse_status TEXT,
        parse_format TEXT,
        parse_warnings TEXT[] NOT NULL DEFAULT '{}',
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (file_id, entry_index)
      );

      CREATE TABLE IF NOT EXISTS ai_usage_events (
        request_id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'openai',
        model TEXT,
        response_id TEXT,
        provider_http_status INTEGER,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        usage_captured BOOLEAN NOT NULL DEFAULT FALSE,
        input_tokens BIGINT NOT NULL DEFAULT 0,
        cached_input_tokens BIGINT NOT NULL DEFAULT 0,
        output_tokens BIGINT NOT NULL DEFAULT 0,
        reasoning_tokens BIGINT NOT NULL DEFAULT 0,
        total_tokens BIGINT NOT NULL DEFAULT 0,
        estimated_cost_usd NUMERIC(20, 12),
        pricing JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS har_files_uploaded_at_idx ON har_files (uploaded_at DESC);
      CREATE INDEX IF NOT EXISTS har_files_status_idx ON har_files (status);
      CREATE INDEX IF NOT EXISTS har_entries_method_idx ON har_entries (file_id, request_method, entry_index);
      CREATE INDEX IF NOT EXISTS har_entries_status_idx ON har_entries (file_id, response_status, entry_index);
      CREATE INDEX IF NOT EXISTS har_entries_duration_idx ON har_entries (file_id, duration_ms DESC);
      CREATE INDEX IF NOT EXISTS console_log_files_uploaded_at_idx ON console_log_files (uploaded_at DESC);
      CREATE INDEX IF NOT EXISTS console_log_files_status_idx ON console_log_files (status);
      CREATE INDEX IF NOT EXISTS console_logs_level_idx ON console_logs (file_id, level, entry_index);
      CREATE INDEX IF NOT EXISTS console_logs_source_idx ON console_logs (file_id, source, entry_index);
      CREATE INDEX IF NOT EXISTS console_logs_timestamp_idx ON console_logs (file_id, timestamp_raw, entry_index);
      CREATE INDEX IF NOT EXISTS console_logs_issue_tags_idx ON console_logs USING GIN (issue_tags);
      CREATE INDEX IF NOT EXISTS console_logs_parse_status_idx ON console_logs (file_id, parse_status, entry_index);
      CREATE INDEX IF NOT EXISTS console_logs_parse_format_idx ON console_logs (file_id, parse_format, entry_index);
      CREATE INDEX IF NOT EXISTS console_logs_parse_warnings_idx ON console_logs USING GIN (parse_warnings);
      CREATE INDEX IF NOT EXISTS ai_usage_created_at_idx ON ai_usage_events (created_at DESC);
      CREATE INDEX IF NOT EXISTS ai_usage_model_created_at_idx ON ai_usage_events (model, created_at DESC);
      CREATE INDEX IF NOT EXISTS ai_usage_operation_created_at_idx ON ai_usage_events (operation, created_at DESC);
    `,
  },
];

async function runMigration(client: PoolClient, migration: Migration): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
      [migration.version, migration.name],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function runPostgresMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const applied = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
    const versions = new Set(applied.rows.map((row) => row.version));
    for (const migration of POSTGRES_MIGRATIONS) {
      if (!versions.has(migration.version)) await runMigration(client, migration);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
