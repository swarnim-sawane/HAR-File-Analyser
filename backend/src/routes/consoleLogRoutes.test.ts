import { describe, expect, it, vi } from 'vitest';
import { buildLogFilter, buildSort } from './consoleLogRoutes';
import { PostgresStore } from '../persistence/postgresStore';

describe('console log route query helpers', () => {
  it('normalizes full-file filters for levels, search, focus, and time range', () => {
    expect(buildLogFilter('file-1', {
      levels: 'error,warn',
      search: 'JPX Namespace /sitedef',
      quickFocus: 'errors',
      startTime: '2026-05-09T17:00:00.000Z',
      endTime: '2026-05-09T17:30:00.000Z',
    })).toEqual({
      levels: ['error', 'warn'],
      search: 'JPX Namespace /sitedef',
      quickFocus: 'errors',
      startTime: '2026-05-09T17:00:00.000Z',
      endTime: '2026-05-09T17:30:00.000Z',
    });
  });

  it('maps issue quick focus to the repository filter', () => {
    expect(buildLogFilter('file-1', { quickFocus: 'http-5xx' })).toMatchObject({
      quickFocus: 'http-5xx',
    });
  });

  it('returns a stable server-side sort specification', () => {
    expect(buildSort({ sortBy: 'timestamp', sortDir: 'desc' })).toEqual({
      field: 'timestamp',
      direction: 'desc',
    });
    expect(buildSort({ sortBy: 'index', sortDir: 'desc' })).toEqual({
      field: 'index',
      direction: 'desc',
    });
  });

  it('builds parser health facets from PostgreSQL results', async () => {
    const results = [
      [{ key: 'error', count: '2' }],
      [{ key: 'exception', count: '2' }],
      [{ key: 'oracle.adf.model.log.Jpx@2240', count: '2' }],
      [{ key: 'parsed', count: '7' }, { key: 'fallback', count: '3' }],
      [{ key: 'catalina-iso', count: '7' }, { key: 'fallback', count: '3' }],
      [{ key: 'Unrecognized log format; captured as raw message.', count: '3' }],
    ];
    const pool = {
      query: vi.fn().mockImplementation(async () => ({ rows: results.shift() ?? [] })),
    };
    const facets = await new PostgresStore(pool as any).getConsoleFacets('file-1', {});

    expect(facets.parseStatusCounts).toEqual({ parsed: 7, fallback: 3 });
    expect(facets.parseFormatCounts).toEqual({ 'catalina-iso': 7, fallback: 3 });
    expect(facets.parseWarningCounts).toEqual({
      'Unrecognized log format; captured as raw message.': 3,
    });
  });
});
