import { describe, expect, it } from 'vitest';
import type { Entry } from '../../types/har';
import { analyzeRequestFlowFocus } from '../requestFlowFocus';

const makeEntry = (overrides: Partial<Entry> = {}): Entry => ({
  startedDateTime: '2026-05-25T10:00:00.000Z',
  time: 240,
  request: {
    method: 'GET',
    url: 'https://app.example.com/',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [],
    queryString: [],
    headersSize: 120,
    bodySize: 0,
  },
  response: {
    status: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [],
    content: { size: 1024, mimeType: 'text/html' },
    redirectURL: '',
    headersSize: 140,
    bodySize: 1024,
  },
  cache: {},
  timings: {
    blocked: 0,
    dns: 0,
    connect: 0,
    ssl: 0,
    send: 10,
    wait: 200,
    receive: 30,
  },
  ...overrides,
});

describe('analyzeRequestFlowFocus', () => {
  it('anchors on a terminal 5xx failure and includes the previous related request', () => {
    const entries = [
      makeEntry({ request: { ...makeEntry().request, url: 'https://app.example.com/page' } }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: { ...makeEntry().request, url: 'https://app.example.com/api/checkout' },
        response: { ...makeEntry().response, status: 503, statusText: 'Service Unavailable' },
      }),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus).toMatchObject({
      anchorIndex: 1,
      severity: 'critical',
      confidence: 'high',
      nextInspection: 'response',
    });
    expect(focus?.reasons).toEqual(expect.arrayContaining(['http-5xx', 'terminal-failure']));
    expect(focus?.reasonLabels).toEqual(expect.arrayContaining(['HTTP 503', 'Terminal request']));
    expect(focus?.summary).toContain('HTTP 503');
    expect(focus?.candidates[0]).toMatchObject({
      index: 1,
      confidence: 'high',
    });
    expect(focus?.nodeIndexes).toEqual(expect.arrayContaining([0, 1]));
  });

  it('weights auth failures above static asset failures', () => {
    const entries = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://cdn.example.com/logo.png' },
        response: {
          ...makeEntry().response,
          status: 404,
          statusText: 'Not Found',
          content: { size: 0, mimeType: 'image/png' },
        },
      }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: { ...makeEntry().request, url: 'https://idcs.example.com/oauth2/v1/token' },
        response: { ...makeEntry().response, status: 401, statusText: 'Unauthorized' },
      }),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus?.anchorIndex).toBe(1);
    expect(focus?.confidence).toBe('high');
    expect(focus?.nextInspection).toBe('headers');
    expect(focus?.reasonLabels).toEqual(expect.arrayContaining(['HTTP 401', 'Auth failure']));
    expect(focus?.reasons).toEqual(expect.arrayContaining(['http-4xx', 'auth-failure']));
  });

  it('prefers failed app logout flow over repeated identity favicon auth noise', () => {
    const entries = [
      makeEntry({
        request: { ...makeEntry().request, method: 'POST', url: 'https://app.example.com/cloudgate/v1/oauth2/callback' },
        response: {
          ...makeEntry().response,
          status: 302,
          statusText: 'Found',
          redirectURL: 'https://app.example.com/ic/builder',
          content: { size: 0, mimeType: 'text/html' },
        },
      }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: { ...makeEntry().request, url: 'https://idcs.example.com/favicon.ico' },
        response: {
          ...makeEntry().response,
          status: 401,
          statusText: 'Unauthorized',
          content: { size: 546, mimeType: 'text/html' },
          bodySize: 546,
        },
      }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:10.000Z',
        request: {
          ...makeEntry().request,
          url: 'https://app.example.com/cloudgate/v1/oauth2/logout?X-HOST-IDENTIFIER-NAME=app.example.com',
        },
        response: {
          ...makeEntry().response,
          status: 404,
          statusText: 'Not Found',
          content: { size: 520, mimeType: 'text/html' },
          bodySize: 168,
        },
      }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:10.030Z',
        request: { ...makeEntry().request, method: 'POST', url: 'https://app.example.com/cloudgate/v1/oauth2/logout' },
        response: { ...makeEntry().response, status: 200, statusText: 'OK', content: { size: 0, mimeType: 'text/html' } },
      }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:10.080Z',
        request: { ...makeEntry().request, url: 'https://idcs.example.com/favicon.ico' },
        response: {
          ...makeEntry().response,
          status: 401,
          statusText: 'Unauthorized',
          content: { size: 546, mimeType: 'text/html' },
          bodySize: 546,
        },
      }),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus?.anchorIndex).toBe(2);
    expect(focus?.summary).toContain('/cloudgate/v1/oauth2/logout');
    expect(focus?.reasonLabels).toEqual(expect.arrayContaining(['HTTP 404']));
    expect(focus?.candidates[0]).toMatchObject({ index: 2 });
  });

  it('detects blocked or CORS-like network evidence', () => {
    const entries = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://api.example.com/ords/items' },
        response: { ...makeEntry().response, status: 0, statusText: 'CORS blocked' },
        time: 0,
        _error: 'blocked by CORS policy: No Access-Control-Allow-Origin header',
      } as Partial<Entry>),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus?.anchorIndex).toBe(0);
    expect(focus?.severity).toBe('critical');
    expect(focus?.confidence).toBe('high');
    expect(focus?.nextInspection).toBe('headers');
    expect(focus?.reasonLabels).toEqual(expect.arrayContaining(['CORS / blocked']));
    expect(focus?.reasons).toEqual(expect.arrayContaining(['cors-or-blocked']));
  });

  it('uses slow p90 outliers when there are no failures', () => {
    const entries = [
      makeEntry({ time: 120 }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: { ...makeEntry().request, url: 'https://app.example.com/api/report' },
        response: { ...makeEntry().response, content: { size: 2048, mimeType: 'application/json' } },
        time: 4600,
      }),
      makeEntry({ startedDateTime: '2026-05-25T10:00:02.000Z', time: 180 }),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus?.anchorIndex).toBe(1);
    expect(focus?.severity).toBe('warning');
    expect(focus?.confidence).toBe('medium');
    expect(focus?.nextInspection).toBe('timings');
    expect(focus?.reasonLabels).toEqual(expect.arrayContaining(['Slow outlier', 'Slow >3s']));
    expect(focus?.reasons).toEqual(expect.arrayContaining(['slow-p90', 'slow-absolute']));
  });

  it('includes redirect predecessor before a failed target', () => {
    const entries = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://app.example.com/login' },
        response: {
          ...makeEntry().response,
          status: 302,
          statusText: 'Found',
          redirectURL: 'https://idcs.example.com/login',
        },
      }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: { ...makeEntry().request, url: 'https://idcs.example.com/login' },
        response: { ...makeEntry().response, status: 500, statusText: 'Server Error' },
      }),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus?.anchorIndex).toBe(1);
    expect(focus?.nodeIndexes).toEqual(expect.arrayContaining([0, 1]));
    expect(focus?.reasonLabels).toEqual(expect.arrayContaining(['Redirect before failure']));
    expect(focus?.reasons).toEqual(expect.arrayContaining(['redirect-before-failure']));
  });

  it('detects repeated endpoint failures', () => {
    const entries = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://app.example.com/api/items?page=1' },
        response: { ...makeEntry().response, status: 500, statusText: 'Server Error' },
      }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: { ...makeEntry().request, url: 'https://app.example.com/api/items?page=2' },
        response: { ...makeEntry().response, status: 500, statusText: 'Server Error' },
      }),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus?.reasons).toEqual(expect.arrayContaining(['repeated-endpoint']));
    expect(focus?.confidence).toBe('high');
    expect(focus?.reasonLabels).toEqual(expect.arrayContaining(['Repeated endpoint']));
    expect(focus?.nodeIndexes).toEqual(expect.arrayContaining([0, 1]));
  });

  it('marks noisy static asset failures as low confidence worth-checking candidates', () => {
    const entries = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://cdn.example.com/logo.png' },
        response: {
          ...makeEntry().response,
          status: 404,
          statusText: 'Not Found',
          content: { size: 0, mimeType: 'image/png' },
        },
      }),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus?.anchorIndex).toBe(0);
    expect(focus?.confidence).toBe('low');
    expect(focus?.reasonLabels).toEqual(expect.arrayContaining(['HTTP 404']));
    expect(focus?.summary).toContain('HTTP 404');
  });

  it('returns null for healthy small HARs', () => {
    const focus = analyzeRequestFlowFocus([
      makeEntry({ time: 120 }),
      makeEntry({ startedDateTime: '2026-05-25T10:00:01.000Z', time: 160 }),
    ]);

    expect(focus).toBeNull();
  });
});
