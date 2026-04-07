import { describe, it, expect } from 'vitest';
import { sanitize, getHarInfo } from '../har_sanitize';

function makeMinimalHar(entries: any[]): string {
  return JSON.stringify({ log: { version: '1.2', creator: { name: 'Test', version: '1' }, entries } });
}

const minEntry = {
  startedDateTime: '2024-01-01T00:00:00Z', time: 10,
  request: { method: 'GET', url: 'https://example.com/', httpVersion: 'HTTP/1.1', headers: [], cookies: [], queryString: [], headersSize: 0, bodySize: 0 },
  response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: [], cookies: [], content: { size: 0, mimeType: 'text/plain' }, redirectURL: '', headersSize: 0, bodySize: 0 },
  cache: {}, timings: { send: 1, wait: 5, receive: 4 },
};

describe('sanitize — edge cases', () => {
  it('handles HAR with zero entries without throwing', () => {
    expect(() => sanitize(makeMinimalHar([]))).not.toThrow();
  });

  it('handles entry with malformed URL gracefully when scrubDomains is set', () => {
    const entry = { ...minEntry, request: { ...minEntry.request, url: 'not-a-valid-url' } };
    expect(() => sanitize(makeMinimalHar([entry]), { scrubDomains: ['example.com'] })).not.toThrow();
  });

  it('allMimeTypes: true redacts content for every mime type found', () => {
    const entry = {
      ...minEntry,
      response: { ...minEntry.response, content: { size: 100, mimeType: 'application/octet-stream', text: 'binarydata123' } },
    };
    const result = sanitize(makeMinimalHar([entry]), { allMimeTypes: true });
    expect(result).not.toContain('binarydata123');
  });

  it('allCookies: true scrubs all cookie values found in HAR', () => {
    const entry = {
      ...minEntry,
      request: {
        ...minEntry.request,
        cookies: [{ name: 'supersecret', value: 'cookieval123' }],
        // Put cookie name in a header value too so the word-regex can match it
        headers: [{ name: 'Cookie', value: 'supersecret=cookieval123; Path=/' }],
      },
    };
    // allCookies: true scrubs cookie names as words — "supersecret" should be redacted
    const result = sanitize(makeMinimalHar([entry]), { allCookies: true });
    expect(result).not.toContain('cookieval123');
  });

  it('large response body: sanitize completes in under 3 seconds', () => {
    const longBody = 'x'.repeat(200_000);
    const entry = {
      ...minEntry,
      response: { ...minEntry.response, content: { size: longBody.length, mimeType: 'text/plain', text: longBody } },
    };
    const start = Date.now();
    sanitize(makeMinimalHar([entry]));
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it('multiple domains are all replaced', () => {
    const e1 = { ...minEntry, request: { ...minEntry.request, url: 'https://secret1.internal/path' } };
    const e2 = { ...minEntry, request: { ...minEntry.request, url: 'https://secret2.internal/path' } };
    const result = sanitize(makeMinimalHar([e1, e2]), { scrubDomains: ['secret1.internal', 'secret2.internal'] });
    expect(result).not.toContain('secret1.internal');
    expect(result).not.toContain('secret2.internal');
    expect(result.match(/\[domain redacted\]/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('getHarInfo — edge cases', () => {
  it('handles entry with no postData without throwing', () => {
    expect(() => getHarInfo(makeMinimalHar([minEntry]))).not.toThrow();
  });

  it('ignores malformed URLs when extracting domains', () => {
    const entry = { ...minEntry, request: { ...minEntry.request, url: 'ht tp://invalid url' } };
    expect(() => getHarInfo(makeMinimalHar([entry]))).not.toThrow();
  });

  it('handles zero entries without throwing', () => {
    expect(() => getHarInfo(makeMinimalHar([]))).not.toThrow();
    const info = getHarInfo(makeMinimalHar([]));
    expect(info.headers).toHaveLength(0);
    expect(info.domains).toHaveLength(0);
  });
});
