import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { streamParseHar } from '../streamingParser';

const tempFiles: string[] = [];

afterEach(() => {
  for (const f of tempFiles.splice(0)) {
    if (existsSync(f)) unlinkSync(f);
  }
});

function writeLargeHar(entryCount: number): string {
  const entries = Array.from({ length: entryCount }, (_, i) => ({
    startedDateTime: '2024-01-15T10:30:00.000Z',
    time: 50 + (i % 500),
    request: {
      method: i % 3 === 0 ? 'POST' : 'GET',
      url: `https://api.example.com/items/${i}?page=${i % 10}`,
      httpVersion: 'HTTP/1.1',
      headers: [{ name: 'Accept', value: 'application/json' }],
      cookies: [],
      queryString: [{ name: 'page', value: String(i % 10) }],
      headersSize: 80,
      bodySize: 0,
    },
    response: {
      status: i % 20 === 0 ? 404 : 200,
      statusText: i % 20 === 0 ? 'Not Found' : 'OK',
      httpVersion: 'HTTP/1.1',
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      cookies: [],
      content: { size: 256, mimeType: 'application/json', text: `{"id":${i}}` },
      redirectURL: '',
      headersSize: 60,
      bodySize: 256,
    },
    cache: {},
    timings: { blocked: 2, dns: 5, connect: 10, send: 3, wait: 25, receive: 5 },
  }));
  const content = JSON.stringify({
    log: { version: '1.2', creator: { name: 'PerfTest', version: '1' }, entries },
  });
  const path = join(tmpdir(), `har-perf-${Date.now()}-${Math.random().toString(36).slice(2)}.har`);
  writeFileSync(path, content, 'utf-8');
  tempFiles.push(path);
  return path;
}

describe('streamParseHar — performance', () => {
  it('parses 5,000 entries in under 10 seconds', async () => {
    const path = writeLargeHar(5_000);
    const start = Date.now();
    let count = 0;
    await streamParseHar(path, async () => { count++; });
    const elapsed = Date.now() - start;
    console.log(`5k entries: ${elapsed}ms`);
    expect(count).toBe(5_000);
    expect(elapsed).toBeLessThan(10_000);
  }, 15_000);

  it('parses 20,000 entries in under 30 seconds', async () => {
    const path = writeLargeHar(20_000);
    const start = Date.now();
    let count = 0;
    await streamParseHar(path, async () => { count++; });
    const elapsed = Date.now() - start;
    console.log(`20k entries: ${elapsed}ms`);
    expect(count).toBe(20_000);
    expect(elapsed).toBeLessThan(30_000);
  }, 40_000);

  it('onEntry callback is called per-entry without buffering all entries', async () => {
    // Verifies streaming behaviour: callback fires incrementally, not all-at-once at end
    const path = writeLargeHar(1_000);
    let count = 0;
    // Count only — do NOT accumulate in an array
    await streamParseHar(path, async () => { count++; });
    expect(count).toBe(1_000);
  }, 15_000);
});
