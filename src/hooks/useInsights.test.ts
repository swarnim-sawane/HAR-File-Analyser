import { describe, expect, it } from 'vitest';
import { makeEntry, makeHarFile, makeRequest, makeResponse } from '../test-utils/fixtures';
import { buildHarContext } from './useInsights';

describe('buildHarContext CORS status-zero prioritization', () => {
  it('prioritizes CORS preflight evidence over static favicon authentication failures', () => {
    const faviconFailure = makeEntry({
      startedDateTime: '2026-04-29T10:02:00.000Z',
      request: makeRequest({
        url: 'https://vb.example.oraclecloud.com/favicon.ico',
      }),
      response: makeResponse({
        status: 401,
        headers: [{ name: 'WWW-Authenticate', value: 'Bearer error="invalid_session"' }],
        content: { size: 120, mimeType: 'text/html', text: '<h1>401 Authorization Required</h1>' },
      }),
    });
    const blockedGet = makeEntry({
      startedDateTime: '2026-04-29T10:02:03.000Z',
      request: makeRequest({
        method: 'GET',
        url: 'https://ords.consolenergy.com/ords/pdbttest/mpr/mpr_module/ceix_mine_location_lov',
        headers: [{ name: 'Referer', value: 'https://vb.example.oraclecloud.com/' }],
      }),
      response: makeResponse({
        status: 0,
        statusText: '',
        headers: [],
        content: { size: 0, mimeType: 'x-unknown' },
      }),
    });
    const preflight = makeEntry({
      startedDateTime: '2026-04-29T10:02:03.010Z',
      request: makeRequest({
        method: 'OPTIONS',
        url: 'https://ords.consolenergy.com/ords/pdbttest/mpr/mpr_module/ceix_mine_location_lov',
        headers: [
          { name: 'Origin', value: 'https://vb.example.oraclecloud.com' },
          { name: 'Access-Control-Request-Method', value: 'GET' },
          { name: 'Access-Control-Request-Headers', value: 'authorization' },
        ],
      }),
      response: makeResponse({
        status: 200,
        headers: [],
        content: { size: 0, mimeType: 'x-unknown' },
      }),
    });

    const context = buildHarContext(makeHarFile([faviconFailure, blockedGet, preflight]));

    expect(context).toContain('CORS_PREFLIGHT_EVIDENCE');
    expect(context).toContain('OPTIONS ords.consolenergy.com/ords/pdbttest/mpr/mpr_module/ceix_mine_location_lov status=200');
    expect(context).toContain('origin=https://vb.example.oraclecloud.com');
    expect(context).toContain('requested_method=GET');
    expect(context).toContain('requested_headers=authorization');
    expect(context).toContain('access-control-allow-origin=missing');
    expect(context).toContain('paired_request=GET ords.consolenergy.com/ords/pdbttest/mpr/mpr_module/ceix_mine_location_lov status=0');
    expect(context).toContain('NETWORK FAILURES / STATUS 0');
    expect(context).toContain('LOW-PRIORITY STATIC ASSET ERRORS');
    expect(context).not.toContain('4XX CLIENT ERRORS');
    expect(context.indexOf('CORS_PREFLIGHT_EVIDENCE')).toBeLessThan(
      context.indexOf('LOW-PRIORITY STATIC ASSET ERRORS')
    );
  });

  it('does not promote static-only favicon failures as decisive application failures', () => {
    const faviconFailure = makeEntry({
      request: makeRequest({
        url: 'https://vb.example.oraclecloud.com/favicon.ico',
      }),
      response: makeResponse({
        status: 401,
        headers: [{ name: 'WWW-Authenticate', value: 'Bearer error="invalid_session"' }],
        content: { size: 120, mimeType: 'text/html', text: '<h1>401 Authorization Required</h1>' },
      }),
    });

    const context = buildHarContext(makeHarFile([faviconFailure]));

    expect(context).toContain('NO_DECISIVE_APPLICATION_FAILURE');
    expect(context).toContain('LOW-PRIORITY STATIC ASSET ERRORS');
    expect(context).not.toContain('4XX CLIENT ERRORS');
    expect(context).not.toContain('ENDS_ON_ERROR_PAGE:true');
  });
});
