import { describe, expect, it } from 'vitest';
import type { ParsedHarEntry } from './streamingParser';
import {
  buildHarAutomationSummary,
  buildHarAutomationPendingResponse,
  buildHarErrorListResponse,
  buildHarInsightContext,
  isSafeAutomationFileId,
} from './harAutomationService';
import { makeParsedEntry } from '../test-utils/fixtures';

function entry(status: number, overrides: Partial<ParsedHarEntry> = {}): ParsedHarEntry {
  return makeParsedEntry({
    response: {
      ...makeParsedEntry().response,
      status,
      statusText: status >= 400 ? 'Error' : 'OK',
    },
    ...overrides,
  });
}

describe('HAR automation service', () => {
  it('accepts only safe file IDs for automation routes', () => {
    expect(isSafeAutomationFileId('file_1774520285813_s97u4gqtr')).toBe(true);
    expect(isSafeAutomationFileId('sanitized_file-123')).toBe(true);

    expect(isSafeAutomationFileId('../etc/passwd')).toBe(false);
    expect(isSafeAutomationFileId('file id with spaces')).toBe(false);
    expect(isSafeAutomationFileId('{"$ne":null}')).toBe(false);
  });

  it('builds a compact summary from file metadata and stats', () => {
    const summary = buildHarAutomationSummary({
      fileId: 'file-1',
      fileName: 'sample.har',
      status: 'ready',
      totalEntries: 6,
      uploadedAt: new Date('2026-05-25T08:00:00.000Z'),
      processedAt: new Date('2026-05-25T08:01:00.000Z'),
      stats: {
        totalRequests: 6,
        errors: 3,
        statusCodes: { 200: 2, 302: 1, 401: 1, 404: 1, 503: 1 },
        methods: { GET: 4, POST: 2 },
        domains: { 'idcs.example.com': 3, 'vb.example.com': 2, 'ords.example.com': 1 },
        averageTime: 125,
        maxTime: 900,
        totalSize: 2048,
      },
    });

    expect(summary.summary.statusBuckets).toEqual({
      '0': 0,
      '1xx': 0,
      '2xx': 2,
      '3xx': 1,
      '4xx': 2,
      '5xx': 1,
    });
    expect(summary.summary.topDomains[0]).toEqual({ domain: 'idcs.example.com', count: 3 });
    expect(summary.summary.errorRate).toBeCloseTo(0.5);
  });

  it('builds a pending response when automation data is not ready yet', () => {
    const response = buildHarAutomationPendingResponse('file-1', {
      fileName: 'sample.har',
      status: 'processing',
      uploadedAt: '2026-05-25T08:00:00.000Z',
    });

    expect(response).toEqual({
      error: 'File is not ready for automation analysis yet',
      message: 'Wait until processing status is ready, then retry this endpoint.',
      fileId: 'file-1',
      fileName: 'sample.har',
      status: 'processing',
      totalEntries: null,
      uploadedAt: '2026-05-25T08:00:00.000Z',
      processedAt: null,
    });
  });

  it('returns only failed HAR requests in automation error responses', () => {
    const response = buildHarErrorListResponse(
      [
        entry(200),
        entry(401, { index: 1, request: { ...makeParsedEntry().request, method: 'POST', url: 'https://idcs.example.com/oauth2/v1/token' } }),
        entry(503, { index: 2, time: 1600, request: { ...makeParsedEntry().request, url: 'https://ords.example.com/ords/api' } }),
      ],
      { page: 1, limit: 25, totalEntries: 2 },
    );

    expect(response.entries).toHaveLength(2);
    expect(response.entries.map((item) => item.status)).toEqual([401, 503]);
    expect(response.entries[0]).toEqual(expect.objectContaining({
      index: 1,
      method: 'POST',
      url: 'https://idcs.example.com/oauth2/v1/token',
      status: 401,
    }));
    expect(response.pagination.totalEntries).toBe(2);
  });

  it('builds HAR insight context with server errors before client errors', () => {
    const context = buildHarInsightContext(
      [
        entry(404, { index: 1, request: { ...makeParsedEntry().request, url: 'https://vb.example.com/missing' } }),
        entry(503, { index: 2, request: { ...makeParsedEntry().request, url: 'https://ords.example.com/ords/api' } }),
        entry(200, { index: 3, time: 2500, request: { ...makeParsedEntry().request, url: 'https://vb.example.com/slow' } }),
      ],
      { totalRequests: 3, statusCodes: { 200: 1, 404: 1, 503: 1 }, errors: 2 },
    );

    expect(context).toContain('HAR SUMMARY');
    expect(context.indexOf('5XX SERVER ERRORS')).toBeLessThan(context.indexOf('4XX CLIENT ERRORS'));
    expect(context).toContain('ords.example.com/ords/api');
    expect(context).toContain('vb.example.com/missing');
  });
});
