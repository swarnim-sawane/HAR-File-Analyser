import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPostgresMigrations } from './postgresMigrations';
import { PostgresStore } from './postgresStore';

const connectionString = process.env.POSTGRES_TEST_URL?.trim();
const describeWithPostgres = connectionString ? describe : describe.skip;

describeWithPostgres('PostgresStore integration', () => {
  const pool = new Pool({ connectionString });
  const store = new PostgresStore(pool);
  const suffix = randomUUID();
  const harFileId = `integration-har-${suffix}`;
  const consoleFileId = `integration-console-${suffix}`;
  const usageRequestId = `integration-usage-${suffix}`;

  beforeAll(async () => {
    await runPostgresMigrations(pool);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM ai_usage_events WHERE request_id = $1', [usageRequestId]);
    await store.deleteFiles('har', [harFileId]);
    await store.deleteFiles('console', [consoleFileId]);
    await pool.end();
  });

  it('persists, filters, facets, and cascade-deletes analyzer data', async () => {
    const now = new Date();
    await store.upsertFile('har', {
      fileId: harFileId,
      fileName: 'integration.har',
      fileSize: 256,
      totalEntries: 2,
      stats: { totalRequests: 2 },
      uploadedAt: now,
      processedAt: now,
      status: 'ready',
    });
    await store.insertHarEntries(harFileId, [
      {
        index: 0,
        startedDateTime: now.toISOString(),
        time: 42,
        request: { method: 'GET', url: 'https://example.test/ok' },
        response: { status: 200, content: { mimeType: 'application/json' } },
      },
      {
        index: 1,
        startedDateTime: now.toISOString(),
        time: 310,
        request: { method: 'POST', url: 'https://example.test/fail' },
        response: { status: 503, content: { mimeType: 'text/plain' } },
      },
    ]);

    expect(await store.countHarEntries(harFileId, { minimumStatus: 500 })).toBe(1);
    const failed = await store.listHarEntries(
      harFileId,
      { offset: 0, limit: 10 },
      { method: 'POST', minimumStatus: 500 },
    );
    expect(failed).toHaveLength(1);
    expect(failed[0].response.status).toBe(503);

    await store.upsertFile('console', {
      fileId: consoleFileId,
      fileName: 'integration.log',
      fileSize: 128,
      totalEntries: 2,
      stats: { totalEntries: 2 },
      uploadedAt: now,
      processedAt: now,
      status: 'ready',
    });
    await store.insertConsoleEntries(consoleFileId, [
      {
        index: 0,
        timestamp: '2026-07-17T10:00:00.000Z',
        level: 'info',
        source: 'browser',
        message: 'Request completed',
        rawText: 'Request completed',
        issueTags: [],
        parseStatus: 'parsed',
        parseFormat: 'browser-console',
        parseWarnings: [],
      },
      {
        index: 1,
        timestamp: '2026-07-17T10:00:01.000Z',
        level: 'error',
        source: 'server',
        message: 'HTTP/1.1 503 upstream unavailable',
        rawText: 'HTTP/1.1 503 upstream unavailable',
        inferredSeverity: 'error',
        issueTags: ['http-5xx'],
        parseStatus: 'partial',
        parseFormat: 'generic-level',
        parseWarnings: ['timestamp-not-detected'],
      },
    ]);

    const consoleFilter = { search: 'upstream', quickFocus: 'errors' };
    expect(await store.countConsoleEntries(consoleFileId, consoleFilter)).toBe(1);
    const facets = await store.getConsoleFacets(consoleFileId, consoleFilter);
    expect(facets.levelCounts.error).toBe(1);
    expect(facets.issueTagCounts['http-5xx']).toBe(1);
    expect(facets.parseStatusCounts.partial).toBe(1);
    expect(facets.parseWarningCounts['timestamp-not-detected']).toBe(1);

    await pool.query(`
      INSERT INTO ai_usage_events (
        request_id, operation, status, model, duration_ms, usage_captured,
        input_tokens, output_tokens, total_tokens, estimated_cost_usd
      ) VALUES ($1, 'insights', 'completed', 'integration-model', 10, TRUE, 20, 5, 25, 0.001)
    `, [usageRequestId]);
    const usage = await pool.query('SELECT total_tokens FROM ai_usage_events WHERE request_id = $1', [usageRequestId]);
    expect(Number(usage.rows[0].total_tokens)).toBe(25);

    const deleted = await store.deleteFiles('har', [harFileId]);
    expect(deleted).toEqual({ files: 1, entries: 2 });
    expect(await store.countHarEntries(harFileId)).toBe(0);
  });
});
