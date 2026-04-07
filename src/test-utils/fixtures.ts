import type { HarFile, Entry, Timings, Request, Response } from '../types/har';

export function makeTimings(overrides: Partial<Timings> = {}): Timings {
  return {
    blocked: 10,
    dns: 20,
    connect: 30,
    ssl: 0,
    send: 5,
    wait: 170,
    receive: 15,
    ...overrides,
  };
}

export function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    url: 'https://example.com/api/data',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [{ name: 'Accept', value: 'application/json' }],
    queryString: [],
    headersSize: 40,
    bodySize: 0,
    ...overrides,
  };
}

export function makeResponse(overrides: Partial<Response> = {}): Response {
  return {
    status: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [{ name: 'Content-Type', value: 'application/json' }],
    content: { size: 1024, mimeType: 'application/json', text: '{"data":"value"}' },
    redirectURL: '',
    headersSize: 60,
    bodySize: 1024,
    ...overrides,
  };
}

export function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    startedDateTime: '2024-01-15T10:30:00.000Z',
    time: 250,
    request: makeRequest(),
    response: makeResponse(),
    cache: {},
    timings: makeTimings(),
    ...overrides,
  };
}

export function makeHarFile(entries: Entry[] = [makeEntry()]): HarFile {
  return {
    log: {
      version: '1.2',
      creator: { name: 'TestBrowser', version: '1.0' },
      entries,
    },
  };
}

export function makeHarJson(entries: Entry[] = [makeEntry()]): string {
  return JSON.stringify(makeHarFile(entries));
}
