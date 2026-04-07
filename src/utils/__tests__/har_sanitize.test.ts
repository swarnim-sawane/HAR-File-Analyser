import { describe, it, expect } from 'vitest';
import { sanitize, getHarInfo } from '../har_sanitize';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeMinimalHar(entries: any[]): string {
  return JSON.stringify({
    log: { version: '1.2', creator: { name: 'Test', version: '1' }, entries },
  });
}

const baseEntry = {
  startedDateTime: '2024-01-01T00:00:00Z',
  time: 100,
  request: {
    method: 'GET',
    url: 'https://example.com/api',
    httpVersion: 'HTTP/1.1',
    headers: [],
    cookies: [],
    queryString: [],
    headersSize: 40,
    bodySize: 0,
  },
  response: {
    status: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/1.1',
    headers: [],
    cookies: [],
    content: { size: 10, mimeType: 'application/json', text: '{"ok":true}' },
    redirectURL: '',
    headersSize: 30,
    bodySize: 10,
  },
  cache: {},
  timings: { send: 1, wait: 90, receive: 9 },
};

// ── getHarInfo ──────────────────────────────────────────────────────────────

describe('getHarInfo', () => {
  it('extracts header names from request and response', () => {
    const entry = {
      ...baseEntry,
      request: { ...baseEntry.request, headers: [{ name: 'Authorization', value: 'Bearer token' }] },
      response: { ...baseEntry.response, headers: [{ name: 'Content-Type', value: 'application/json' }] },
    };
    const info = getHarInfo(makeMinimalHar([entry]));
    expect(info.headers).toContain('Authorization');
    expect(info.headers).toContain('Content-Type');
  });

  it('extracts cookie names', () => {
    const entry = {
      ...baseEntry,
      request: { ...baseEntry.request, cookies: [{ name: 'session', value: 'abc' }] },
      response: { ...baseEntry.response, cookies: [{ name: 'csrftoken', value: 'xyz' }] },
    };
    const info = getHarInfo(makeMinimalHar([entry]));
    expect(info.cookies).toContain('session');
    expect(info.cookies).toContain('csrftoken');
  });

  it('extracts query arg names', () => {
    const entry = {
      ...baseEntry,
      request: { ...baseEntry.request, queryString: [{ name: 'page', value: '1' }, { name: 'limit', value: '20' }] },
    };
    const info = getHarInfo(makeMinimalHar([entry]));
    expect(info.queryArgs).toContain('page');
    expect(info.queryArgs).toContain('limit');
  });

  it('extracts hostname from request URL', () => {
    const info = getHarInfo(makeMinimalHar([baseEntry]));
    expect(info.domains).toContain('example.com');
  });

  it('extracts multiple domains across entries', () => {
    const e1 = { ...baseEntry, request: { ...baseEntry.request, url: 'https://api.example.com/v1' } };
    const e2 = { ...baseEntry, request: { ...baseEntry.request, url: 'https://cdn.example.com/logo.png' } };
    const info = getHarInfo(makeMinimalHar([e1, e2]));
    expect(info.domains).toContain('api.example.com');
    expect(info.domains).toContain('cdn.example.com');
  });

  it('deduplicates header names across entries', () => {
    const e1 = { ...baseEntry, request: { ...baseEntry.request, headers: [{ name: 'Content-Type', value: 'text/html' }] } };
    const e2 = { ...baseEntry, response: { ...baseEntry.response, headers: [{ name: 'Content-Type', value: 'application/json' }] } };
    const info = getHarInfo(makeMinimalHar([e1, e2]));
    expect(info.headers.filter((h: string) => h === 'Content-Type')).toHaveLength(1);
  });

  it('returns sorted arrays', () => {
    const info = getHarInfo(makeMinimalHar([baseEntry]));
    const sorted = [...info.headers].sort();
    expect(info.headers).toEqual(sorted);
  });
});

// ── sanitize — mime type redaction ──────────────────────────────────────────

describe('sanitize — mime type redaction', () => {
  it('replaces application/javascript content with placeholder by default', () => {
    const entry = {
      ...baseEntry,
      response: {
        ...baseEntry.response,
        content: { size: 500, mimeType: 'application/javascript', text: 'console.log("secret");' },
      },
    };
    const result = sanitize(makeMinimalHar([entry]));
    expect(result).not.toContain('console.log("secret")');
    expect(result).toContain('[application/javascript redacted]');
  });

  it('does NOT redact application/json content by default', () => {
    const result = sanitize(makeMinimalHar([baseEntry]));
    // sanitize re-serializes with JSON.stringify(..., null, 2), so the embedded
    // JSON text is escaped: {"ok":true} → {\"ok\":true}
    expect(result).toContain('\\"ok\\":true');
  });
});

// ── sanitize — token redaction ───────────────────────────────────────────────

describe('sanitize — token redaction', () => {
  it('redacts value for headers matching the default word list', () => {
    // "token" is in the default word list — validates that matching header
    // name/value pairs are masked without depending on real JWT structure.
    const entry = {
      ...baseEntry,
      request: {
        ...baseEntry.request,
        headers: [{ name: 'token', value: 'mock.jwt.token' }],
      },
    };
    const result = sanitize(makeMinimalHar([entry]));
    expect(result).not.toContain('mock.jwt.token');
    expect(result).toContain('redacted');
  });

  it('redacts Authorization header value entirely (word-list redaction)', () => {
    const entry = {
      ...baseEntry,
      request: {
        ...baseEntry.request,
        headers: [{ name: 'Authorization', value: 'Bearer mock.jwt.token' }],
      },
    };
    const result = sanitize(makeMinimalHar([entry]));
    // The Authorization word-list regex replaces the entire value
    expect(result).toContain('[Authorization redacted]');
    expect(result).not.toContain('mock.jwt.token');
  });
});

// ── sanitize — default word list ─────────────────────────────────────────────

describe('sanitize — default word list', () => {
  it('redacts password query parameter value', () => {
    const har = makeMinimalHar([{
      ...baseEntry,
      request: {
        ...baseEntry.request,
        url: 'https://example.com/login?password=secret123&next=/home',
        queryString: [{ name: 'password', value: 'secret123' }],
      },
    }]);
    // The sanitizer works on raw JSON string — it uses regex on the text
    const result = sanitize(har);
    // The raw JSON will contain "name": "password" with its value — should be redacted
    expect(result).not.toContain('secret123');
  });

  it('redacts token in JSON name/value pairs', () => {
    const har = JSON.stringify({
      log: {
        version: '1.2',
        creator: { name: 'Test', version: '1' },
        entries: [{
          ...baseEntry,
          request: {
            ...baseEntry.request,
            postData: {
              mimeType: 'application/json',
              params: [{ name: 'token', value: 'supersecrettoken123' }],
            },
          },
        }],
      },
    });
    const result = sanitize(har);
    expect(result).not.toContain('supersecrettoken123');
    expect(result).toContain('redacted');
  });
});

// ── sanitize — domain redaction ──────────────────────────────────────────────

describe('sanitize — domain redaction', () => {
  it('replaces domain in request URL', () => {
    const entry = {
      ...baseEntry,
      request: { ...baseEntry.request, url: 'https://internal.company.com/secret/path' },
    };
    const result = sanitize(makeMinimalHar([entry]), { scrubDomains: ['internal.company.com'] });
    expect(result).not.toContain('internal.company.com');
    expect(result).toContain('[domain redacted]');
  });

  it('replaces domain in response Location header', () => {
    const entry = {
      ...baseEntry,
      response: {
        ...baseEntry.response,
        redirectURL: 'https://internal.company.com/home',
        headers: [{ name: 'Location', value: 'https://internal.company.com/home' }],
      },
    };
    const result = sanitize(makeMinimalHar([entry]), { scrubDomains: ['internal.company.com'] });
    expect(result).not.toContain('internal.company.com');
  });

  it('does not replace when scrubDomains is empty', () => {
    const result = sanitize(makeMinimalHar([baseEntry]), { scrubDomains: [] });
    expect(result).toContain('example.com');
  });
});
