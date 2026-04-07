import { describe, it, expect } from 'vitest';
import { HarAnalyzer } from '../harAnalyzer';
import { makeEntry, makeHarFile, makeRequest, makeResponse, makeTimings } from '../../test-utils/fixtures';

// ── filterByStatusCode ──────────────────────────────────────────────────────

describe('HarAnalyzer.filterByStatusCode', () => {
  const e200 = makeEntry({ response: { ...makeResponse(), status: 200 } });
  const e301 = makeEntry({ response: { ...makeResponse(), status: 301 } });
  const e404 = makeEntry({ response: { ...makeResponse(), status: 404 } });
  const e500 = makeEntry({ response: { ...makeResponse(), status: 500 } });
  const e0   = makeEntry({ response: { ...makeResponse(), status: 0 } });
  const all  = [e200, e301, e404, e500, e0];

  it('keeps only 2xx entries when code=200', () => {
    expect(HarAnalyzer.filterByStatusCode(all, [200])).toEqual([e200]);
  });
  it('keeps only 3xx entries when code=300', () => {
    expect(HarAnalyzer.filterByStatusCode(all, [300])).toEqual([e301]);
  });
  it('keeps 4xx and 5xx when both codes passed', () => {
    const result = HarAnalyzer.filterByStatusCode(all, [400, 500]);
    expect(result).toContain(e404);
    expect(result).toContain(e500);
    expect(result).not.toContain(e200);
  });
  it('keeps status=0 entries when code=0', () => {
    expect(HarAnalyzer.filterByStatusCode(all, [0])).toEqual([e0]);
  });
  it('returns empty array when no entries match', () => {
    expect(HarAnalyzer.filterByStatusCode(all, [100])).toEqual([]);
  });
  it('returns empty array for empty input', () => {
    expect(HarAnalyzer.filterByStatusCode([], [200])).toEqual([]);
  });
});

// ── calculateTotalTime ──────────────────────────────────────────────────────

describe('HarAnalyzer.calculateTotalTime', () => {
  it('sums all timing phases', () => {
    const timings = { blocked: 10, dns: 20, connect: 30, ssl: 5, send: 5, wait: 80, receive: 15 };
    expect(HarAnalyzer.calculateTotalTime(timings)).toBe(165);
  });
  it('treats missing optional phases as 0', () => {
    const timings = { send: 5, wait: 80, receive: 15 };
    expect(HarAnalyzer.calculateTotalTime(timings)).toBe(100);
  });
  it('returns 0 for all-zero timings', () => {
    const timings = { send: 0, wait: 0, receive: 0 };
    expect(HarAnalyzer.calculateTotalTime(timings)).toBe(0);
  });
});

// ── getPerformanceMetrics ───────────────────────────────────────────────────

describe('HarAnalyzer.getPerformanceMetrics', () => {
  it('returns zeros for empty entries array', () => {
    const metrics = HarAnalyzer.getPerformanceMetrics([]);
    expect(metrics.totalRequests).toBe(0);
    expect(metrics.totalSize).toBe(0);
    expect(metrics.totalTime).toBe(0);
    expect(metrics.avgTime).toBe(0);
  });

  it('counts requests correctly', () => {
    const entries = [makeEntry({ time: 100 }), makeEntry({ time: 200 })];
    const metrics = HarAnalyzer.getPerformanceMetrics(entries);
    expect(metrics.totalRequests).toBe(2);
  });

  it('sums body sizes', () => {
    const e1 = makeEntry({ response: { ...makeResponse(), bodySize: 500 } });
    const e2 = makeEntry({ response: { ...makeResponse(), bodySize: 300 } });
    expect(HarAnalyzer.getPerformanceMetrics([e1, e2]).totalSize).toBe(800);
  });

  it('calculates avgTime correctly', () => {
    const entries = [makeEntry({ time: 100 }), makeEntry({ time: 300 })];
    expect(HarAnalyzer.getPerformanceMetrics(entries).avgTime).toBe(200);
  });

  it('groups statusCounts by 100-class', () => {
    const e200 = makeEntry({ response: { ...makeResponse(), status: 200 } });
    const e201 = makeEntry({ response: { ...makeResponse(), status: 201 } });
    const e404 = makeEntry({ response: { ...makeResponse(), status: 404 } });
    const metrics = HarAnalyzer.getPerformanceMetrics([e200, e201, e404]);
    expect(metrics.statusCounts[200]).toBe(2);
    expect(metrics.statusCounts[400]).toBe(1);
  });
});

// ── getMimeTypeBreakdown ────────────────────────────────────────────────────

describe('HarAnalyzer.getMimeTypeBreakdown', () => {
  it('counts each mime type', () => {
    const eJson1 = makeEntry({ response: { ...makeResponse(), content: { size: 100, mimeType: 'application/json' } } });
    const eJson2 = makeEntry({ response: { ...makeResponse(), content: { size: 200, mimeType: 'application/json' } } });
    const eHtml  = makeEntry({ response: { ...makeResponse(), content: { size: 300, mimeType: 'text/html' } } });
    const result = HarAnalyzer.getMimeTypeBreakdown([eJson1, eJson2, eHtml]);
    expect(result['application/json']).toBe(2);
    expect(result['text/html']).toBe(1);
  });
  it('returns empty object for empty entries', () => {
    expect(HarAnalyzer.getMimeTypeBreakdown([])).toEqual({});
  });
});

// ── getTimingBreakdown ──────────────────────────────────────────────────────

describe('HarAnalyzer.getTimingBreakdown', () => {
  it('returns all phases with defaults for missing optionals', () => {
    const entry = makeEntry({ timings: { send: 5, wait: 80, receive: 15 } });
    const result = HarAnalyzer.getTimingBreakdown(entry);
    expect(result.blocked).toBe(0);
    expect(result.dns).toBe(0);
    expect(result.connect).toBe(0);
    expect(result.ssl).toBe(0);
    expect(result.send).toBe(5);
    expect(result.wait).toBe(80);
    expect(result.receive).toBe(15);
  });
  it('passes through all phases when present', () => {
    const entry = makeEntry({ timings: { blocked: 10, dns: 20, connect: 30, ssl: 5, send: 5, wait: 80, receive: 15 } });
    const result = HarAnalyzer.getTimingBreakdown(entry);
    expect(result.blocked).toBe(10);
    expect(result.ssl).toBe(5);
  });
});

// ── buildSearchIndex + searchEntries ────────────────────────────────────────

describe('HarAnalyzer.buildSearchIndex + searchEntries', () => {
  const eGet = makeEntry({ request: { ...makeRequest(), method: 'GET', url: 'https://api.example.com/users' } });
  const ePost = makeEntry({ request: { ...makeRequest(), method: 'POST', url: 'https://api.example.com/login' } });
  const eImage = makeEntry({
    request: { ...makeRequest(), url: 'https://cdn.example.com/logo.png' },
    response: { ...makeResponse(), content: { size: 2000, mimeType: 'image/png' } },
  });
  const entries = [eGet, ePost, eImage];
  const harData = makeHarFile(entries);
  const index = HarAnalyzer.buildSearchIndex(harData);

  it('returns all entries for empty search term', () => {
    expect(HarAnalyzer.searchEntries(entries, '', index)).toHaveLength(3);
  });

  it('finds entries by URL substring', () => {
    const result = HarAnalyzer.searchEntries(entries, '/users', index);
    expect(result).toContain(eGet);
    expect(result).not.toContain(ePost);
  });

  it('finds entries by HTTP method (case-insensitive)', () => {
    const result = HarAnalyzer.searchEntries(entries, 'post', index);
    expect(result).toContain(ePost);
    expect(result).not.toContain(eGet);
  });

  it('finds entries by mime type', () => {
    const result = HarAnalyzer.searchEntries(entries, 'image/png', index);
    expect(result).toContain(eImage);
  });

  it('multi-word query: both tokens must match', () => {
    const result = HarAnalyzer.searchEntries(entries, 'get users', index);
    expect(result).toContain(eGet);
    expect(result).not.toContain(ePost);
  });

  it('returns empty array when no entries match and file corpus also has no match', () => {
    const result = HarAnalyzer.searchEntries(entries, 'zzznomatch', index);
    expect(result).toHaveLength(0);
  });

  it('does not include base64 body content in searchable text', () => {
    const b64Entry = makeEntry({
      response: {
        ...makeResponse(),
        content: {
          size: 100,
          mimeType: 'image/png',
          encoding: 'base64',
          text: 'iVBORw0KGgoAAAANSUhEUgAAAAUA',
        },
      },
    });
    const b64Har = makeHarFile([b64Entry]);
    const b64Index = HarAnalyzer.buildSearchIndex(b64Har);
    const result = HarAnalyzer.searchEntries([b64Entry], 'iVBORw0KGgo', b64Index);
    expect(result).toHaveLength(0);
  });
});
