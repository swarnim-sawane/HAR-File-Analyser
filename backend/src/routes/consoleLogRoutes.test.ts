import { describe, expect, it } from 'vitest';
import { buildFacets, buildLogFilter, buildSort } from './consoleLogRoutes';

describe('console log route query helpers', () => {
  it('builds full-file filters for levels, search, quick focus, and time range', () => {
    const filter = buildLogFilter('file-1', {
      levels: 'error,warn',
      search: 'JPX Namespace /sitedef',
      quickFocus: 'errors',
      startTime: '2026-05-09T17:00:00.000Z',
      endTime: '2026-05-09T17:30:00.000Z',
    }) as any;

    expect(filter.$and).toEqual(
      expect.arrayContaining([
        { fileId: 'file-1' },
        { level: { $in: ['error', 'warn'] } },
        { timestamp: { $gte: '2026-05-09T17:00:00.000Z', $lte: '2026-05-09T17:30:00.000Z' } },
        {
          $or: [
            { level: 'error' },
            { inferredSeverity: 'error' },
          ],
        },
      ]),
    );
    expect(filter.$and.some((clause: any) => clause.$or?.[0]?.message instanceof RegExp)).toBe(true);
  });

  it('maps issue quick focus to issueTags', () => {
    const filter = buildLogFilter('file-1', { quickFocus: 'http-5xx' }) as any;

    expect(filter.$and).toEqual(expect.arrayContaining([
      { fileId: 'file-1' },
      { issueTags: 'http-5xx' },
    ]));
  });

  it('adds index tie-breaker for stable server-side sorting', () => {
    expect(buildSort({ sortBy: 'timestamp', sortDir: 'desc' })).toEqual({
      timestamp: -1,
      index: 1,
    });
    expect(buildSort({ sortBy: 'index', sortDir: 'desc' })).toEqual({ index: 1 });
  });

  it('builds parser health facets from full-file aggregate results', async () => {
    const aggregateResults = [
      [{ _id: 'error', count: 2 }],
      [{ _id: 'exception', count: 2 }],
      [{ _id: 'oracle.adf.model.log.Jpx@2240', count: 2 }],
      [{ _id: 'parsed', count: 7 }, { _id: 'fallback', count: 3 }],
      [{ _id: 'catalina-iso', count: 7 }, { _id: 'fallback', count: 3 }],
      [{ _id: 'Unrecognized log format; captured as raw message.', count: 3 }],
    ];
    const collection = {
      aggregate: vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue(aggregateResults.shift() ?? []),
      })),
    };

    const facets = await buildFacets(collection, { fileId: 'file-1' });

    expect(facets.parseStatusCounts).toEqual({ parsed: 7, fallback: 3 });
    expect(facets.parseFormatCounts).toEqual({ 'catalina-iso': 7, fallback: 3 });
    expect(facets.parseWarningCounts).toEqual({
      'Unrecognized log format; captured as raw message.': 3,
    });
  });
});
