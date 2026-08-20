import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserProxyError,
  buildHostedUiBase,
  buildHostedUiTarget,
  filterBrowserRequestHeaders,
  filterHostedResponseHeaders,
  isTrustedLocalRequest,
  validateMethod,
} from './oci-hosted-ui-browser-proxy-core.mjs';

const applicationOcid = 'ocid1.generativeaihostedapplicationiam.oc1.phx.example';

test('buildHostedUiBase only accepts an IAM Hosted Application OCID', () => {
  const base = buildHostedUiBase({ region: 'us-phoenix-1', applicationOcid });
  assert.equal(base.protocol, 'https:');
  assert.equal(base.hostname, 'inference.generativeai.us-phoenix-1.oci.oraclecloud.com');
  assert.match(base.pathname, /hostedApplicationsIam\/ocid1\.generativeaihostedapplicationiam/);
  assert.throws(
    () => buildHostedUiBase({ region: 'us-phoenix-1', applicationOcid: 'https://attacker.invalid' }),
    BrowserProxyError,
  );
});

test('buildHostedUiTarget preserves only the incoming path and query on the fixed OCI origin', () => {
  const base = buildHostedUiBase({ region: 'us-phoenix-1', applicationOcid });
  const target = buildHostedUiTarget(base, '/assets/app.js?v=1');
  assert.equal(target.hostname, base.hostname);
  assert.equal(target.pathname, `${base.pathname}/assets/app.js`);
  assert.equal(target.search, '?v=1');
});

test('validateMethod rejects methods outside the explicit allowlist', () => {
  assert.equal(validateMethod('post'), 'POST');
  assert.throws(() => validateMethod('TRACE'), BrowserProxyError);
});

test('mutation requests require a same-origin browser origin', () => {
  assert.equal(isTrustedLocalRequest({ method: 'GET', origin: 'https://attacker.invalid' }), true);
  assert.equal(isTrustedLocalRequest({
    method: 'POST',
    origin: 'http://127.0.0.1:3120',
    host: '127.0.0.1:3120',
    secFetchSite: 'same-origin',
  }), true);
  assert.equal(isTrustedLocalRequest({
    method: 'POST',
    origin: 'https://attacker.invalid',
    host: '127.0.0.1:3120',
    secFetchSite: 'cross-site',
  }), false);
});

test('request and response header filters do not forward credentials or framing metadata', () => {
  const requestHeaders = filterBrowserRequestHeaders({
    accept: 'application/json',
    authorization: 'Bearer secret',
    cookie: 'secret=value',
    origin: 'http://127.0.0.1:3120',
    'x-session-id': 'demo-session',
  });
  assert.equal(requestHeaders.get('accept'), 'application/json');
  assert.equal(requestHeaders.get('x-session-id'), 'demo-session');
  assert.equal(requestHeaders.has('authorization'), false);
  assert.equal(requestHeaders.has('cookie'), false);
  assert.equal(requestHeaders.has('origin'), false);

  const responseHeaders = filterHostedResponseHeaders(new Headers({
    'content-type': 'text/html',
    'content-length': '100',
    'content-encoding': 'gzip',
    'set-cookie': 'secret=value',
  }));
  assert.equal(responseHeaders['content-type'], 'text/html');
  assert.equal(responseHeaders['content-length'], undefined);
  assert.equal(responseHeaders['content-encoding'], undefined);
  assert.equal(responseHeaders['set-cookie'], undefined);
});
