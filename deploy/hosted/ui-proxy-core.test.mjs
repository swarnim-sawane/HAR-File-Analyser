import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import {
  ProxyRequestError,
  buildBackendHealthTarget,
  buildBackendTarget,
  deriveBackendInvokeUrl,
  filterRequestHeaders,
  filterResponseHeaders,
  isTrustedBrowserMutation,
  normalizeBackendInvokeUrl,
  signOciRequest,
} from './ui-proxy-core.mjs';

const backendBase = 'https://inference.generativeai.us-phoenix-1.oci.oraclecloud.com/20251112/hostedApplicationsIam/ocid1.generativeaihostedapplicationiam.oc1.phx.example/actions/invoke';

test('accepts only a fixed IAM Hosted Application invoke endpoint', () => {
  assert.equal(normalizeBackendInvokeUrl(`${backendBase}/`).toString(), backendBase);
  assert.throws(() => normalizeBackendInvokeUrl('http://127.0.0.1:8080/actions/invoke'), ProxyRequestError);
  assert.throws(() => normalizeBackendInvokeUrl('https://example.com/actions/invoke'), ProxyRequestError);
  assert.throws(() => normalizeBackendInvokeUrl(`${backendBase}?redirect=https://example.com`), ProxyRequestError);
});

test('derives the invoke endpoint from the legacy health URL', () => {
  assert.equal(deriveBackendInvokeUrl('', `${backendBase}/health`), backendBase);
  assert.equal(buildBackendHealthTarget(backendBase).toString(), `${backendBase}/health`);
});

test('builds only API and Socket.IO targets and preserves the query', () => {
  assert.equal(
    buildBackendTarget(backendBase, '/api/har/file_1/entries?page=2').toString(),
    `${backendBase}/api/har/file_1/entries?page=2`,
  );
  assert.equal(
    buildBackendTarget(backendBase, '/socket.io/?EIO=4&transport=polling').toString(),
    `${backendBase}/socket.io/?EIO=4&transport=polling`,
  );
  assert.throws(() => buildBackendTarget(backendBase, '/probe/backend-health'), ProxyRequestError);
  assert.throws(() => buildBackendTarget(backendBase, '/api/../health'), ProxyRequestError);
});

test('drops browser credentials and forwarding headers', () => {
  const headers = filterRequestHeaders({
    accept: 'application/json',
    authorization: 'Bearer must-not-forward',
    cookie: 'session=must-not-forward',
    host: 'attacker.invalid',
    origin: 'https://attacker.invalid',
    'x-forwarded-host': 'attacker.invalid',
    'x-session-id': 'session-safe',
  });
  assert.equal(headers.get('accept'), 'application/json');
  assert.equal(headers.get('x-session-id'), 'session-safe');
  assert.equal(headers.has('authorization'), false);
  assert.equal(headers.has('cookie'), false);
  assert.equal(headers.has('origin'), false);
  assert.equal(headers.has('host'), false);
  assert.ok(headers.get('opc-request-id'));
});

test('forwards only safe backend response headers', () => {
  const upstream = new Headers({
    'content-type': 'application/json',
    'set-cookie': 'backend-secret=value',
    'access-control-allow-origin': '*',
    'opc-request-id': 'request-id',
  });
  assert.deepEqual(filterResponseHeaders(upstream), {
    'content-type': 'application/json',
    'opc-request-id': 'request-id',
  });
});

test('rejects cross-site browser mutations', () => {
  assert.equal(isTrustedBrowserMutation({ method: 'GET' }), true);
  assert.equal(isTrustedBrowserMutation({ method: 'POST', host: 'ui.example', origin: 'https://ui.example', secFetchSite: 'same-origin' }), true);
  assert.equal(isTrustedBrowserMutation({ method: 'POST', host: 'ui.example', origin: 'https://attacker.example', secFetchSite: 'cross-site' }), false);
  assert.equal(isTrustedBrowserMutation({ method: 'POST', host: 'public-gateway.example', origin: 'https://public-gateway.example', secFetchSite: 'same-origin' }), true);
  assert.equal(isTrustedBrowserMutation({ method: 'DELETE', host: 'ui.example', origin: 'https://attacker.example', secFetchSite: 'cross-site' }), false);
  assert.equal(isTrustedBrowserMutation({ method: 'DELETE', host: 'ui.example', origin: 'https://ui.example', secFetchSite: 'same-origin' }), true);
  assert.equal(isTrustedBrowserMutation({ method: 'POST', host: 'ui.example' }), false);
});

test('signs byte-exact request payload hashes without leaking caller authorization', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const provider = {
    getKeyId: async () => 'ST$unit-test-token',
    getPrivateKey: () => privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
  const body = Buffer.from([0x00, 0xff, 0x10, 0x80]);
  const headers = new Headers({ 'content-type': 'application/octet-stream' });
  await signOciRequest({
    provider,
    method: 'POST',
    target: new URL(`${backendBase}/api/upload/chunk`),
    headers,
    body,
  });

  assert.equal(headers.get('content-length'), '4');
  assert.equal(headers.get('x-content-sha256'), 'ozuyrtdXvIOYB9ep3qsGiMPPBtNuU8tCjy5TnI3HbFs=');
  assert.match(headers.get('authorization'), /^Signature version="1",/);
  assert.match(headers.get('authorization'), /content-length/);
  assert.match(headers.get('authorization'), /x-content-sha256/);
});
