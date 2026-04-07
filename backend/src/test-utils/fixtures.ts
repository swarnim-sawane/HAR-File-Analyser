import type { ParsedHarEntry } from '../services/streamingParser';

export function makeParsedEntry(overrides: Partial<ParsedHarEntry> = {}): ParsedHarEntry {
  return {
    index: 0,
    startedDateTime: '2024-01-15T10:30:00.000Z',
    time: 250,
    request: {
      method: 'GET',
      url: 'https://example.com/api/data',
      headers: [{ name: 'Accept', value: 'application/json' }],
      cookies: [],
      queryString: [],
      headersSize: 40,
      bodySize: 0,
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      cookies: [],
      content: { size: 1024, mimeType: 'application/json' },
      redirectURL: '',
      headersSize: 60,
      bodySize: 1024,
    },
    cache: {},
    timings: { send: 5, wait: 170, receive: 15 },
    ...overrides,
  };
}

export function makeHarJsonString(count = 1): string {
  const entries = Array.from({ length: count }, (_, i) => ({
    startedDateTime: '2024-01-15T10:30:00.000Z',
    time: 100 + i,
    request: {
      method: 'GET',
      url: `https://example.com/api/item${i}`,
      headers: [],
      cookies: [],
      queryString: [],
      headersSize: 40,
      bodySize: 0,
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [],
      cookies: [],
      content: { size: 512, mimeType: 'application/json' },
      redirectURL: '',
      headersSize: 60,
      bodySize: 512,
    },
    cache: {},
    timings: { send: 5, wait: 80, receive: 15 },
  }));
  return JSON.stringify({ log: { version: '1.2', creator: { name: 'Test', version: '1' }, entries } });
}
