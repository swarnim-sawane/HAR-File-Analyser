import { describe, expect, it } from 'vitest';
import { POSTGRES_MIGRATIONS } from '../persistence/postgresMigrations';

describe('PostgreSQL schema', () => {
  it('defines durable file, entry, and usage tables', () => {
    const sql = POSTGRES_MIGRATIONS.map((migration) => migration.sql).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS har_files');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS har_entries');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS console_log_files');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS console_logs');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ai_usage_events');
  });

  it('enforces one parsed entry per file and index', () => {
    const sql = POSTGRES_MIGRATIONS[0].sql;
    expect(sql.match(/PRIMARY KEY \(file_id, entry_index\)/g)).toHaveLength(2);
    expect(sql).toContain('REFERENCES har_files(file_id) ON DELETE CASCADE');
    expect(sql).toContain('REFERENCES console_log_files(file_id) ON DELETE CASCADE');
  });
});
