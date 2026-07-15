import { describe, it, expect } from 'vitest';
import { makeParsedEntry } from '../../test-utils/fixtures';
import type { ParsedHarEntry } from '../../services/streamingParser';

// ── Reference implementations of the private harProcessor functions ─────────
// These mirror the logic in harProcessor.ts exactly.
// If harProcessor.ts changes, update these to match.

type StatsAcc = {
  totalSize: number;
  totalTime: number;
  statusCodes: Record<number, number>;
  methods: Record<string, number>;
  domains: Record<string, number>;
  contentTypes: Record<string, number>;
  minTime: number;
  maxTime: number;
  errors: number;
};

function makeStats(): StatsAcc {
  return {
    totalSize: 0, totalTime: 0,
    statusCodes: {}, methods: {}, domains: {}, contentTypes: {},
    minTime: Infinity, maxTime: 0, errors: 0,
  };
}

function updateStats(stats: StatsAcc, entry: ParsedHarEntry, cache?: Map<string, string>): void {
  const status = entry.response?.status || 0;
  stats.statusCodes[status] = (stats.statusCodes[status] || 0) + 1;
  if (status >= 400) stats.errors++;

  const method = entry.request?.method || 'UNKNOWN';
  stats.methods[method] = (stats.methods[method] || 0) + 1;

  const rawUrl = entry.request?.url || '';
  let domain: string;
  if (cache?.has(rawUrl)) {
    domain = cache.get(rawUrl)!;
  } else {
    try { domain = new URL(rawUrl).hostname || 'invalid'; }
    catch { domain = 'invalid'; }
    if (cache && rawUrl) cache.set(rawUrl, domain);
  }
  stats.domains[domain] = (stats.domains[domain] || 0) + 1;

  const contentType = entry.response?.content?.mimeType?.split(';')[0] || 'unknown';
  stats.contentTypes[contentType] = (stats.contentTypes[contentType] || 0) + 1;

  const time = entry.time || 0;
  stats.totalTime += time;
  stats.minTime = Math.min(stats.minTime, time);
  stats.maxTime = Math.max(stats.maxTime, time);
  stats.totalSize += entry.response?.bodySize || 0;
}

function finalizeStats(stats: StatsAcc, totalEntries: number) {
  return {
    totalRequests: totalEntries,
    totalSize: stats.totalSize,
    totalTime: stats.totalTime,
    statusCodes: stats.statusCodes,
    methods: stats.methods,
    domains: stats.domains,
    contentTypes: stats.contentTypes,
    averageTime: totalEntries > 0 ? stats.totalTime / totalEntries : 0,
    minTime: stats.minTime === Infinity ? 0 : stats.minTime,
    maxTime: stats.maxTime,
    errors: stats.errors,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('updateStats — status codes and errors', () => {
  it('counts status codes correctly', () => {
    const stats = makeStats();
    updateStats(stats, makeParsedEntry({ response: { ...makeParsedEntry().response, status: 200 } }));
    updateStats(stats, makeParsedEntry({ response: { ...makeParsedEntry().response, status: 200 } }));
    updateStats(stats, makeParsedEntry({ response: { ...makeParsedEntry().response, status: 404 } }));
    expect(stats.statusCodes[200]).toBe(2);
    expect(stats.statusCodes[404]).toBe(1);
  });

  it('counts errors only for 4xx and 5xx', () => {
    const stats = makeStats();
    updateStats(stats, makeParsedEntry({ response: { ...makeParsedEntry().response, status: 200 } }));
    updateStats(stats, makeParsedEntry({ response: { ...makeParsedEntry().response, status: 404 } }));
    updateStats(stats, makeParsedEntry({ response: { ...makeParsedEntry().response, status: 500 } }));
    expect(stats.errors).toBe(2);
  });

  it('does not count 3xx as errors', () => {
    const stats = makeStats();
    updateStats(stats, makeParsedEntry({ response: { ...makeParsedEntry().response, status: 301 } }));
    expect(stats.errors).toBe(0);
  });
});

describe('updateStats — size and timing', () => {
  it('accumulates totalSize from bodySize', () => {
    const stats = makeStats();
    updateStats(stats, makeParsedEntry({ response: { ...makeParsedEntry().response, bodySize: 500 } }));
    updateStats(stats, makeParsedEntry({ response: { ...makeParsedEntry().response, bodySize: 300 } }));
    expect(stats.totalSize).toBe(800);
  });

  it('tracks minTime and maxTime correctly', () => {
    const stats = makeStats();
    updateStats(stats, makeParsedEntry({ time: 50 }));
    updateStats(stats, makeParsedEntry({ time: 300 }));
    updateStats(stats, makeParsedEntry({ time: 150 }));
    expect(stats.minTime).toBe(50);
    expect(stats.maxTime).toBe(300);
  });

  it('accumulates totalTime', () => {
    const stats = makeStats();
    updateStats(stats, makeParsedEntry({ time: 100 }));
    updateStats(stats, makeParsedEntry({ time: 200 }));
    expect(stats.totalTime).toBe(300);
  });
});

describe('updateStats — methods and domains', () => {
  it('groups by HTTP method', () => {
    const stats = makeStats();
    updateStats(stats, makeParsedEntry({ request: { ...makeParsedEntry().request, method: 'GET' } }));
    updateStats(stats, makeParsedEntry({ request: { ...makeParsedEntry().request, method: 'POST' } }));
    updateStats(stats, makeParsedEntry({ request: { ...makeParsedEntry().request, method: 'GET' } }));
    expect(stats.methods['GET']).toBe(2);
    expect(stats.methods['POST']).toBe(1);
  });

  it('extracts hostname from URL', () => {
    const stats = makeStats();
    updateStats(stats, makeParsedEntry({ request: { ...makeParsedEntry().request, url: 'https://api.example.com/v1' } }));
    expect(stats.domains['api.example.com']).toBe(1);
  });

  it('uses "invalid" for unparseable URLs', () => {
    const stats = makeStats();
    updateStats(stats, makeParsedEntry({ request: { ...makeParsedEntry().request, url: 'not-a-url' } }));
    expect(stats.domains['invalid']).toBe(1);
  });

  it('uses domain cache to avoid re-parsing the same URL', () => {
    const stats = makeStats();
    const cache = new Map<string, string>();
    const url = 'https://example.com/repeated';
    updateStats(stats, makeParsedEntry({ request: { ...makeParsedEntry().request, url } }), cache);
    updateStats(stats, makeParsedEntry({ request: { ...makeParsedEntry().request, url } }), cache);
    expect(cache.has(url)).toBe(true);
    expect(stats.domains['example.com']).toBe(2);
  });
});

describe('finalizeStats', () => {
  it('sets averageTime to 0 when totalEntries is 0', () => {
    expect(finalizeStats(makeStats(), 0).averageTime).toBe(0);
  });

  it('converts minTime=Infinity to 0', () => {
    expect(finalizeStats(makeStats(), 0).minTime).toBe(0);
  });

  it('uses totalEntries argument as totalRequests', () => {
    const stats = makeStats();
    updateStats(stats, makeParsedEntry());
    expect(finalizeStats(stats, 42).totalRequests).toBe(42);
  });

  it('calculates correct averageTime', () => {
    const stats = makeStats();
    updateStats(stats, makeParsedEntry({ time: 100 }));
    updateStats(stats, makeParsedEntry({ time: 300 }));
    expect(finalizeStats(stats, 2).averageTime).toBe(200);
  });

  it('includes all accumulated fields in output', () => {
    const stats = makeStats();
    updateStats(stats, makeParsedEntry());
    const result = finalizeStats(stats, 1);
    expect(result).toHaveProperty('totalRequests');
    expect(result).toHaveProperty('totalSize');
    expect(result).toHaveProperty('statusCodes');
    expect(result).toHaveProperty('methods');
    expect(result).toHaveProperty('domains');
    expect(result).toHaveProperty('contentTypes');
    expect(result).toHaveProperty('errors');
  });
});
