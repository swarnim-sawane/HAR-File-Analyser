import { describe, it, expect } from 'vitest';
import { HarAnalyzer } from '../harAnalyzer';
import { makeEntry, makeHarFile, makeRequest, makeResponse } from '../../test-utils/fixtures';
import type { Entry } from '../../types/har';

function makeLargeEntrySet(count: number): Entry[] {
  return Array.from({ length: count }, (_, i) => makeEntry({
    request: {
      ...makeRequest(),
      method: i % 3 === 0 ? 'POST' : 'GET',
      url: `https://api.example.com/resource/${i}?q=${i % 50}`,
      queryString: [{ name: 'q', value: String(i % 50) }],
    },
    response: {
      ...makeResponse(),
      status: i % 20 === 0 ? 404 : 200,
      statusText: i % 20 === 0 ? 'Not Found' : 'OK',
      content: { size: 256, mimeType: 'application/json', text: `{"id":${i}}` },
      bodySize: 256,
    },
    time: 50 + (i % 200),
  }));
}

describe('HarAnalyzer.buildSearchIndex — performance', () => {
  it('builds a search index for 5,000 entries in under 5 seconds', () => {
    const entries = makeLargeEntrySet(5_000);
    const harData = makeHarFile(entries);
    const start = Date.now();
    HarAnalyzer.buildSearchIndex(harData);
    const elapsed = Date.now() - start;
    console.log(`buildSearchIndex 5k: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(5_000);
  });
});

describe('HarAnalyzer.searchEntries — performance', () => {
  it('searches 5,000 entries in under 1 second', () => {
    const entries = makeLargeEntrySet(5_000);
    const harData = makeHarFile(entries);
    const index = HarAnalyzer.buildSearchIndex(harData);
    const start = Date.now();
    const results = HarAnalyzer.searchEntries(entries, '/resource/42', index);
    const elapsed = Date.now() - start;
    console.log(`searchEntries 5k (match): ${elapsed}ms, matched: ${results.length}`);
    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('no-match search on 5,000 entries completes in under 1 second', () => {
    const entries = makeLargeEntrySet(5_000);
    const harData = makeHarFile(entries);
    const index = HarAnalyzer.buildSearchIndex(harData);
    const start = Date.now();
    const results = HarAnalyzer.searchEntries(entries, 'zzznomatchtoken', index);
    const elapsed = Date.now() - start;
    console.log(`searchEntries 5k (no-match): ${elapsed}ms`);
    expect(results).toHaveLength(0);
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe('HarAnalyzer.filterByStatusCode — performance', () => {
  it('filters 5,000 entries in under 500ms', () => {
    const entries = makeLargeEntrySet(5_000);
    const start = Date.now();
    const results = HarAnalyzer.filterByStatusCode(entries, [200, 400]);
    const elapsed = Date.now() - start;
    console.log(`filterByStatusCode 5k: ${elapsed}ms, matched: ${results.length}`);
    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });
});
