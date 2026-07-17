import { Pool, type QueryResultRow } from 'pg';
import { buildPostgresPoolConfig } from './postgresConfig';
import { runPostgresMigrations } from './postgresMigrations';

export interface StoredFileDocument {
  fileId: string;
  fileName: string;
  artifactKey?: string;
  filePath?: string;
  fileSize: number;
  hash?: string;
  totalEntries: number;
  stats: Record<string, unknown>;
  uploadedAt: Date | string;
  processedAt?: Date | string | null;
  status: string;
}

export interface HarEntryFilter {
  method?: string;
  status?: number;
  domain?: string;
  contentType?: string;
  minimumStatus?: number;
  maximumStatusExclusive?: number;
}

export interface ConsoleEntryFilter {
  levels?: string[];
  startTime?: string;
  endTime?: string;
  search?: string;
  quickFocus?: string;
  level?: string;
  source?: string;
}

export interface PageOptions {
  offset: number;
  limit: number;
}

export interface ConsoleSort {
  field: 'timestamp' | 'level' | 'source' | 'message' | 'index';
  direction: 'asc' | 'desc';
}

export interface ConsoleFacets {
  levelCounts: Record<string, number>;
  issueTagCounts: Record<string, number>;
  topSources: Array<{ source: string; count: number }>;
  parseStatusCounts: Record<string, number>;
  parseFormatCounts: Record<string, number>;
  parseWarningCounts: Record<string, number>;
}

const FILE_TABLES = {
  har: 'har_files',
  console: 'console_log_files',
} as const;

function fileFromRow(row: Record<string, any>): StoredFileDocument {
  return {
    fileId: row.file_id,
    fileName: row.file_name,
    ...(row.artifact_key ? { artifactKey: row.artifact_key } : {}),
    ...(row.file_path ? { filePath: row.file_path } : {}),
    fileSize: Number(row.file_size ?? 0),
    ...(row.hash ? { hash: row.hash } : {}),
    totalEntries: Number(row.total_entries ?? 0),
    stats: row.stats ?? {},
    uploadedAt: row.uploaded_at,
    processedAt: row.processed_at,
    status: row.status,
  };
}

function countMap(rows: Array<{ key: string | null; count: string | number }>): Record<string, number> {
  return Object.fromEntries(rows.filter((row) => row.key).map((row) => [row.key as string, Number(row.count)]));
}

export class PostgresStore {
  constructor(readonly pool: Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getFile(kind: keyof typeof FILE_TABLES, fileId: string): Promise<StoredFileDocument | null> {
    const result = await this.pool.query(`SELECT * FROM ${FILE_TABLES[kind]} WHERE file_id = $1`, [fileId]);
    return result.rows[0] ? fileFromRow(result.rows[0]) : null;
  }

  async upsertFile(kind: keyof typeof FILE_TABLES, document: StoredFileDocument): Promise<void> {
    await this.pool.query(`
      INSERT INTO ${FILE_TABLES[kind]} (
        file_id, file_name, artifact_key, file_path, file_size, hash, total_entries,
        stats, uploaded_at, processed_at, status, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,NOW())
      ON CONFLICT (file_id) DO UPDATE SET
        file_name = EXCLUDED.file_name,
        artifact_key = EXCLUDED.artifact_key,
        file_path = EXCLUDED.file_path,
        file_size = EXCLUDED.file_size,
        hash = EXCLUDED.hash,
        total_entries = EXCLUDED.total_entries,
        stats = EXCLUDED.stats,
        uploaded_at = EXCLUDED.uploaded_at,
        processed_at = EXCLUDED.processed_at,
        status = EXCLUDED.status,
        updated_at = NOW()
    `, [
      document.fileId, document.fileName, document.artifactKey ?? null, document.filePath ?? null,
      document.fileSize, document.hash ?? null, document.totalEntries, JSON.stringify(document.stats ?? {}),
      document.uploadedAt, document.processedAt ?? null, document.status,
    ]);
  }

  async deleteHarEntries(fileId: string): Promise<number> {
    return (await this.pool.query('DELETE FROM har_entries WHERE file_id = $1', [fileId])).rowCount ?? 0;
  }

  async insertHarEntries(fileId: string, entries: unknown[]): Promise<void> {
    if (!entries.length) return;
    await this.pool.query(`
      INSERT INTO har_entries (
        file_id, entry_index, started_datetime, duration_ms, request_method,
        request_url, response_status, response_mime_type, payload, created_at
      )
      SELECT $1, (item->>'index')::integer, item->>'startedDateTime',
        NULLIF(item->>'time', '')::double precision, item#>>'{request,method}',
        item#>>'{request,url}', NULLIF(item#>>'{response,status}', '')::integer,
        item#>>'{response,content,mimeType}', item, COALESCE((item->>'createdAt')::timestamptz, NOW())
      FROM jsonb_array_elements($2::jsonb) AS item
      ON CONFLICT (file_id, entry_index) DO UPDATE SET
        started_datetime = EXCLUDED.started_datetime,
        duration_ms = EXCLUDED.duration_ms,
        request_method = EXCLUDED.request_method,
        request_url = EXCLUDED.request_url,
        response_status = EXCLUDED.response_status,
        response_mime_type = EXCLUDED.response_mime_type,
        payload = EXCLUDED.payload,
        created_at = EXCLUDED.created_at
    `, [fileId, JSON.stringify(entries)]);
  }

  private harWhere(fileId: string, filter: HarEntryFilter = {}): { sql: string; values: unknown[] } {
    const clauses = ['file_id = $1'];
    const values: unknown[] = [fileId];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      clauses.push(sql.replace('?', `$${values.length}`));
    };
    if (filter.method) add('request_method = ?', filter.method);
    if (filter.status !== undefined) add('response_status = ?', filter.status);
    if (filter.domain) add("request_url ILIKE '%' || ? || '%'", filter.domain);
    if (filter.contentType) add("response_mime_type ILIKE '%' || ? || '%'", filter.contentType);
    if (filter.minimumStatus !== undefined) add('response_status >= ?', filter.minimumStatus);
    if (filter.maximumStatusExclusive !== undefined) add('response_status < ?', filter.maximumStatusExclusive);
    return { sql: clauses.join(' AND '), values };
  }

  async listHarEntries(fileId: string, page: PageOptions, filter: HarEntryFilter = {}, orderBy = 'entry_index ASC'): Promise<any[]> {
    const where = this.harWhere(fileId, filter);
    const result = await this.pool.query(
      `SELECT payload FROM har_entries WHERE ${where.sql} ORDER BY ${orderBy} OFFSET $${where.values.length + 1} LIMIT $${where.values.length + 2}`,
      [...where.values, page.offset, page.limit],
    );
    return result.rows.map((row) => row.payload);
  }

  async countHarEntries(fileId: string, filter: HarEntryFilter = {}): Promise<number> {
    const where = this.harWhere(fileId, filter);
    const result = await this.pool.query(`SELECT COUNT(*)::bigint AS count FROM har_entries WHERE ${where.sql}`, where.values);
    return Number(result.rows[0]?.count ?? 0);
  }

  async getHarEntry(fileId: string, index: number): Promise<any | null> {
    const result = await this.pool.query('SELECT payload FROM har_entries WHERE file_id = $1 AND entry_index = $2', [fileId, index]);
    return result.rows[0]?.payload ?? null;
  }

  async getHarInsightEntries(fileId: string): Promise<any[]> {
    const result = await this.pool.query(`
      WITH samples AS (
          (SELECT entry_index, payload FROM har_entries WHERE file_id=$1 AND response_status >= 500 ORDER BY entry_index LIMIT 100)
          UNION ALL
          (SELECT entry_index, payload FROM har_entries WHERE file_id=$1 AND response_status >= 400 AND response_status < 500 ORDER BY entry_index LIMIT 100)
          UNION ALL
          (SELECT entry_index, payload FROM har_entries WHERE file_id=$1 ORDER BY duration_ms DESC NULLS LAST LIMIT 50)
      ), ids AS (SELECT DISTINCT entry_index FROM samples)
      SELECT entries.payload
      FROM har_entries entries
      JOIN ids USING (entry_index)
      WHERE entries.file_id=$1
      ORDER BY entries.entry_index
    `, [fileId]);
    return result.rows.map((row) => row.payload);
  }

  async deleteConsoleEntries(fileId: string): Promise<number> {
    return (await this.pool.query('DELETE FROM console_logs WHERE file_id = $1', [fileId])).rowCount ?? 0;
  }

  async insertConsoleEntries(fileId: string, entries: unknown[]): Promise<void> {
    if (!entries.length) return;
    await this.pool.query(`
      INSERT INTO console_logs (
        file_id, entry_index, timestamp_raw, level, source, message, raw_text, url,
        stack_trace, inferred_severity, issue_tags, primary_issue, parse_status,
        parse_format, parse_warnings, payload, created_at
      )
      SELECT $1, (item->>'index')::integer, item->>'timestamp', LOWER(item->>'level'),
        item->>'source', item->>'message', item->>'rawText', item->>'url', item->>'stackTrace',
        item->>'inferredSeverity', ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'issueTags', '[]'::jsonb))),
        item->>'primaryIssue', item->>'parseStatus', item->>'parseFormat',
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'parseWarnings', '[]'::jsonb))),
        item, COALESCE((item->>'createdAt')::timestamptz, NOW())
      FROM jsonb_array_elements($2::jsonb) AS item
      ON CONFLICT (file_id, entry_index) DO UPDATE SET
        timestamp_raw=EXCLUDED.timestamp_raw, level=EXCLUDED.level, source=EXCLUDED.source,
        message=EXCLUDED.message, raw_text=EXCLUDED.raw_text, url=EXCLUDED.url,
        stack_trace=EXCLUDED.stack_trace, inferred_severity=EXCLUDED.inferred_severity,
        issue_tags=EXCLUDED.issue_tags, primary_issue=EXCLUDED.primary_issue,
        parse_status=EXCLUDED.parse_status, parse_format=EXCLUDED.parse_format,
        parse_warnings=EXCLUDED.parse_warnings, payload=EXCLUDED.payload, created_at=EXCLUDED.created_at
    `, [fileId, JSON.stringify(entries)]);
  }

  private consoleWhere(fileId: string, filter: ConsoleEntryFilter): { sql: string; values: unknown[] } {
    const clauses = ['file_id = $1'];
    const values: unknown[] = [fileId];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      clauses.push(sql.replace('?', `$${values.length}`));
    };
    if (filter.levels?.length) add('level = ANY(?::text[])', filter.levels);
    if (filter.level) add('LOWER(level) = LOWER(?)', filter.level);
    if (filter.source) add('source = ?', filter.source);
    if (filter.startTime) add('timestamp_raw >= ?', filter.startTime);
    if (filter.endTime) add('timestamp_raw <= ?', filter.endTime);
    if (filter.search) {
      add(`(
        message ILIKE '%' || ? || '%' OR raw_text ILIKE '%' || $${values.length + 1} || '%'
        OR source ILIKE '%' || $${values.length + 1} || '%' OR url ILIKE '%' || $${values.length + 1} || '%'
        OR stack_trace ILIKE '%' || $${values.length + 1} || '%' OR primary_issue ILIKE '%' || $${values.length + 1} || '%'
        OR EXISTS (SELECT 1 FROM unnest(issue_tags) tag WHERE tag ILIKE '%' || $${values.length + 1} || '%')
      )`, filter.search);
    }
    if (filter.quickFocus === 'errors') clauses.push("(level = 'error' OR inferred_severity = 'error')");
    else if (filter.quickFocus === 'warnings') clauses.push("(level = 'warn' OR inferred_severity = 'warning')");
    else if (filter.quickFocus && filter.quickFocus !== 'all') add('? = ANY(issue_tags)', filter.quickFocus);
    return { sql: clauses.join(' AND '), values };
  }

  async listConsoleEntries(fileId: string, page: PageOptions, filter: ConsoleEntryFilter, sort: ConsoleSort): Promise<any[]> {
    const where = this.consoleWhere(fileId, filter);
    const columns = { timestamp: 'timestamp_raw', level: 'level', source: 'source', message: 'message', index: 'entry_index' } as const;
    const order = sort.field === 'index' ? 'entry_index ASC' : `${columns[sort.field]} ${sort.direction.toUpperCase()} NULLS LAST, entry_index ASC`;
    const result = await this.pool.query(
      `SELECT payload - 'rawText' - 'args' AS payload FROM console_logs WHERE ${where.sql} ORDER BY ${order} OFFSET $${where.values.length + 1} LIMIT $${where.values.length + 2}`,
      [...where.values, page.offset, page.limit],
    );
    return result.rows.map((row) => row.payload);
  }

  async countConsoleEntries(fileId: string, filter: ConsoleEntryFilter): Promise<number> {
    const where = this.consoleWhere(fileId, filter);
    const result = await this.pool.query(`SELECT COUNT(*)::bigint AS count FROM console_logs WHERE ${where.sql}`, where.values);
    return Number(result.rows[0]?.count ?? 0);
  }

  async getConsoleEntry(fileId: string, index: number): Promise<any | null> {
    const result = await this.pool.query('SELECT payload FROM console_logs WHERE file_id=$1 AND entry_index=$2', [fileId, index]);
    return result.rows[0]?.payload ?? null;
  }

  async getConsoleFacets(fileId: string, filter: ConsoleEntryFilter): Promise<ConsoleFacets> {
    const where = this.consoleWhere(fileId, filter);
    const [levels, issues, sources, statuses, formats, warnings] = await Promise.all([
      this.pool.query(`SELECT level AS key, COUNT(*)::bigint AS count FROM console_logs WHERE ${where.sql} GROUP BY level`, where.values),
      this.pool.query(`SELECT tag AS key, COUNT(*)::bigint AS count FROM console_logs, unnest(issue_tags) tag WHERE ${where.sql} GROUP BY tag ORDER BY count DESC LIMIT 12`, where.values),
      this.pool.query(`SELECT source AS key, COUNT(*)::bigint AS count FROM console_logs WHERE ${where.sql} GROUP BY source ORDER BY count DESC LIMIT 10`, where.values),
      this.pool.query(`SELECT parse_status AS key, COUNT(*)::bigint AS count FROM console_logs WHERE ${where.sql} GROUP BY parse_status`, where.values),
      this.pool.query(`SELECT parse_format AS key, COUNT(*)::bigint AS count FROM console_logs WHERE ${where.sql} GROUP BY parse_format ORDER BY count DESC LIMIT 12`, where.values),
      this.pool.query(`SELECT warning AS key, COUNT(*)::bigint AS count FROM console_logs, unnest(parse_warnings) warning WHERE ${where.sql} GROUP BY warning ORDER BY count DESC LIMIT 12`, where.values),
    ]);
    return {
      levelCounts: countMap(levels.rows),
      issueTagCounts: countMap(issues.rows),
      topSources: sources.rows.filter((row) => row.key).map((row) => ({ source: row.key, count: Number(row.count) })),
      parseStatusCounts: countMap(statuses.rows),
      parseFormatCounts: countMap(formats.rows),
      parseWarningCounts: countMap(warnings.rows),
    };
  }

  async findExpiredFiles(kind: keyof typeof FILE_TABLES, cutoff: Date): Promise<StoredFileDocument[]> {
    const result = await this.pool.query(`SELECT * FROM ${FILE_TABLES[kind]} WHERE uploaded_at < $1`, [cutoff]);
    return result.rows.map(fileFromRow);
  }

  async deleteFiles(kind: keyof typeof FILE_TABLES, fileIds: string[]): Promise<{ files: number; entries: number }> {
    if (!fileIds.length) return { files: 0, entries: 0 };
    const entriesTable = kind === 'har' ? 'har_entries' : 'console_logs';
    const entryCount = await this.pool.query(`SELECT COUNT(*)::bigint AS count FROM ${entriesTable} WHERE file_id = ANY($1::text[])`, [fileIds]);
    const deleted = await this.pool.query(`DELETE FROM ${FILE_TABLES[kind]} WHERE file_id = ANY($1::text[])`, [fileIds]);
    return { files: deleted.rowCount ?? 0, entries: Number(entryCount.rows[0]?.count ?? 0) };
  }

  async query<T extends QueryResultRow = any>(text: string, values: unknown[] = []) {
    return this.pool.query<T>(text, values);
  }
}

let store: PostgresStore | null = null;

export async function connectPostgres(): Promise<PostgresStore> {
  if (store) return store;
  const pool = new Pool(buildPostgresPoolConfig());
  pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error));
  await pool.query('SELECT 1');
  await runPostgresMigrations(pool);
  store = new PostgresStore(pool);
  return store;
}

export function getPostgresStore(): PostgresStore {
  if (!store) throw new Error('PostgreSQL is not connected.');
  return store;
}

export async function closePostgres(): Promise<void> {
  if (!store) return;
  const current = store;
  store = null;
  await current.close();
}
