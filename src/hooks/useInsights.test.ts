import { describe, expect, it } from 'vitest';
import { buildHarContext } from './useInsights';
import { makeEntry, makeHarFile, makeRequest, makeResponse } from '../test-utils/fixtures';

describe('buildHarContext expert triage evidence', () => {
  it('adds a forensic case file that separates root auth failure from repeated 401 symptoms', () => {
    const success = makeEntry({
      startedDateTime: '2026-04-29T10:00:00.000Z',
      request: makeRequest({
        method: 'GET',
        url: 'https://example.oraclecloud.com/ords/hr/employees',
        headers: [
          { name: 'Authorization', value: 'Bearer secret-token' },
          { name: 'Cookie', value: 'JSESSIONID=secret-cookie; ORA_FND_SESSION=secret-session' },
        ],
      }),
      response: makeResponse({ status: 200 }),
    });

    const firstFailure = makeEntry({
      startedDateTime: '2026-04-29T10:00:05.000Z',
      request: makeRequest({
        method: 'GET',
        url: 'https://example.oraclecloud.com/ords/hr/employees',
        headers: [{ name: 'Accept', value: 'application/json' }],
      }),
      response: makeResponse({
        status: 401,
        headers: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'WWW-Authenticate', value: 'Bearer error="invalid_token"' },
        ],
        content: {
          size: 41,
          mimeType: 'application/json',
          text: '{"error":"invalid_token","detail":"expired"}',
        },
      }),
    });

    const repeatedFailure = makeEntry({
      startedDateTime: '2026-04-29T10:00:06.000Z',
      request: makeRequest({
        method: 'GET',
        url: 'https://example.oraclecloud.com/ords/hr/employees',
      }),
      response: makeResponse({ status: 401 }),
    });

    const context = buildHarContext(makeHarFile([success, firstFailure, repeatedFailure]));

    expect(context).toContain('EXPERT TRIAGE CASE FILE');
    expect(context).toContain('FIRST_DECISIVE_FAILURE');
    expect(context).toContain('GET example.oraclecloud.com/ords/hr/employees status=401');
    expect(context).toContain('SUCCESS_VS_FAILURE_DELTA');
    expect(context).toContain('authorization:present->missing');
    expect(context).toContain('cookie_names:JSESSIONID,ORA_FND_SESSION->none');
    expect(context).toContain('WWW-Authenticate=Bearer error="invalid_token"');
    expect(context).toContain('response_snippet={"error":"invalid_token","detail":"expired"}');
    expect(context).toContain('DOWNSTREAM_SYMPTOMS');
    expect(context).not.toContain('secret-token');
    expect(context).not.toContain('secret-cookie');
    expect(context).not.toContain('secret-session');
  });

  it('adds 400 request payload and response body clues without exposing full sensitive values', () => {
    const badRequest = makeEntry({
      startedDateTime: '2026-04-29T10:01:00.000Z',
      request: makeRequest({
        method: 'POST',
        url: 'https://example.oraclecloud.com/fscmRestApi/resources/latest/invoices?invoiceId=bad-value&locale=en',
        headers: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Authorization', value: 'Bearer another-secret' },
        ],
        postData: {
          mimeType: 'application/json',
          text: '{"invoiceId":"bad-value","amount":"NaN"}',
        },
      }),
      response: makeResponse({
        status: 400,
        headers: [{ name: 'Content-Type', value: 'application/json' }],
        content: {
          size: 60,
          mimeType: 'application/json',
          text: '{"title":"Invalid invoice id","detail":"invoiceId is required"}',
        },
      }),
    });

    const context = buildHarContext(makeHarFile([badRequest]));

    expect(context).toContain('BAD_REQUEST_EVIDENCE');
    expect(context).toContain('POST example.oraclecloud.com/fscmRestApi/resources/latest/invoices status=400');
    expect(context).toContain('query_params=invoiceId,locale');
    expect(context).toContain('request_content_type=application/json');
    expect(context).toContain('post_body_fields=invoiceId,amount');
    expect(context).toContain('response_snippet={"title":"Invalid invoice id","detail":"invoiceId is required"}');
    expect(context).not.toContain('another-secret');
    expect(context).not.toContain('bad-value&locale=en');
  });

  it('strips raw query values from Location response headers in triage evidence', () => {
    const redirectFailure = makeEntry({
      request: makeRequest({
        url: 'https://example.oraclecloud.com/ords/hr/employees',
      }),
      response: makeResponse({
        status: 401,
        headers: [
          {
            name: 'Location',
            value:
              'https://example.oraclecloud.com/login?request_id=secret-request&redirect_uri=https%3A%2F%2Fexample.oraclecloud.com%2Fords%2Fhr%2Femployees',
          },
        ],
      }),
    });

    const context = buildHarContext(makeHarFile([redirectFailure]));

    expect(context).toContain('Location=example.oraclecloud.com/login query_params=request_id,redirect_uri');
    expect(context).not.toContain('secret-request');
    expect(context).not.toContain('redirect_uri=https%3A%2F%2Fexample.oraclecloud.com');
  });

  it('strips raw query values from redirect chain Location values', () => {
    const redirect = makeEntry({
      request: makeRequest({
        url: 'https://example.oraclecloud.com/start',
      }),
      response: makeResponse({
        status: 302,
        headers: [
          {
            name: 'Location',
            value:
              '/login?request_id=secret-request&redirect_uri=https%3A%2F%2Fexample.oraclecloud.com%2Fhome',
          },
        ],
      }),
    });
    const terminal = makeEntry({
      request: makeRequest({
        url: 'https://example.oraclecloud.com/login',
      }),
      response: makeResponse({ status: 200 }),
    });

    const context = buildHarContext(makeHarFile([redirect, terminal]));

    expect(context).toContain('/login query_params=request_id,redirect_uri');
    expect(context).not.toContain('secret-request');
    expect(context).not.toContain('redirect_uri=https%3A%2F%2Fexample.oraclecloud.com');
  });

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
        headers: [
          {
            name: 'Referer',
            value: 'https://vb.example.oraclecloud.com/',
          },
        ],
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
          {
            name: 'Origin',
            value: 'https://vb.example.oraclecloud.com',
          },
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

    expect(context).toContain('FIRST_DECISIVE_FAILURE CORS_PREFLIGHT');
    expect(context).toContain('CORS_PREFLIGHT_EVIDENCE');
    expect(context).toContain('OPTIONS ords.consolenergy.com/ords/pdbttest/mpr/mpr_module/ceix_mine_location_lov status=200');
    expect(context).toContain('origin=https://vb.example.oraclecloud.com');
    expect(context).toContain('requested_method=GET');
    expect(context).toContain('requested_headers=authorization');
    expect(context).toContain('access-control-allow-origin=missing');
    expect(context).toContain('paired_request=GET ords.consolenergy.com/ords/pdbttest/mpr/mpr_module/ceix_mine_location_lov status=0');
    expect(context).toContain('STATIC_ASSET_FAILURES');
    expect(context).not.toContain('FIRST_DECISIVE_FAILURE GET vb.example.oraclecloud.com/favicon.ico');
    expect(context.indexOf('CORS_PREFLIGHT_EVIDENCE')).toBeLessThan(context.indexOf('STATIC_ASSET_FAILURES'));
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
    expect(context).toContain('STATIC_ASSET_FAILURES');
    expect(context).not.toContain('FIRST_DECISIVE_FAILURE');
    expect(context).not.toContain('4XX CLIENT ERRORS');
    expect(context).not.toContain('ENDS_ON_ERROR_PAGE:true');
  });
});
