import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

let require = createRequire(import.meta.url);
try {
  require.resolve('oci-common');
} catch {
  // The local checkout keeps OCI runtime dependencies under backend/node_modules.
  // The Hosted Application image installs them directly under /app/node_modules.
  require = createRequire(new URL('../../backend/package.json', import.meta.url));
}
const httpSignature = require('http-signature');
const { SignerRequest } = require('oci-common/lib/signer');

const OCI_HOST_SUFFIX = '.oci.oraclecloud.com';
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PROXY_PATH_PREFIXES = ['/api/', '/socket.io/'];

const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-type',
  'if-match',
  'if-none-match',
  'range',
  'x-session-id',
]);

const FORWARDED_RESPONSE_HEADERS = new Set([
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-language',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
  'opc-request-id',
  'retry-after',
]);

export class ProxyRequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'ProxyRequestError';
    this.statusCode = statusCode;
  }
}

export function normalizeBackendInvokeUrl(value) {
  if (!value || !value.trim()) {
    throw new ProxyRequestError(503, 'BACKEND_INVOKE_URL is not configured');
  }

  let target;
  try {
    target = new URL(value.trim());
  } catch {
    throw new ProxyRequestError(503, 'BACKEND_INVOKE_URL is invalid');
  }

  if (
    target.protocol !== 'https:'
    || !target.hostname.endsWith(OCI_HOST_SUFFIX)
    || target.username
    || target.password
    || target.search
    || target.hash
  ) {
    throw new ProxyRequestError(503, 'BACKEND_INVOKE_URL must be a credential-free HTTPS OCI endpoint');
  }

  const pathname = target.pathname.replace(/\/+$/, '');
  if (!/^\/\d{8}\/hostedApplicationsIam\/ocid1\.generativeaihostedapplicationiam\.[^/]+\/actions\/invoke$/.test(pathname)) {
    throw new ProxyRequestError(503, 'BACKEND_INVOKE_URL must target an IAM Hosted Application invoke endpoint');
  }

  target.pathname = pathname;
  return target;
}

export function deriveBackendInvokeUrl(invokeUrl, legacyHealthUrl = '') {
  if (invokeUrl && invokeUrl.trim()) return invokeUrl.trim();
  if (!legacyHealthUrl || !legacyHealthUrl.trim()) return '';

  const legacy = new URL(legacyHealthUrl.trim());
  if (!legacy.pathname.endsWith('/health')) {
    throw new ProxyRequestError(503, 'BACKEND_HEALTH_URL must end in /health');
  }
  legacy.pathname = legacy.pathname.slice(0, -'/health'.length);
  return legacy.toString().replace(/\/$/, '');
}

export function buildBackendTarget(backendInvokeUrl, incomingUrl) {
  const base = normalizeBackendInvokeUrl(backendInvokeUrl);
  const incoming = new URL(incomingUrl || '/', 'http://ui.invalid');

  if (!PROXY_PATH_PREFIXES.some((prefix) => incoming.pathname.startsWith(prefix))) {
    throw new ProxyRequestError(404, 'Path is not available through the backend proxy');
  }

  base.pathname = `${base.pathname}${incoming.pathname}`;
  base.search = incoming.search;
  return base;
}

export function buildBackendHealthTarget(backendInvokeUrl) {
  const base = normalizeBackendInvokeUrl(backendInvokeUrl);
  base.pathname = `${base.pathname}/health`;
  return base;
}

export function filterRequestHeaders(headers = {}) {
  const forwarded = new Headers();
  for (const [name, rawValue] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (!FORWARDED_REQUEST_HEADERS.has(lowerName) || rawValue === undefined) continue;
    const value = Array.isArray(rawValue) ? rawValue.join(', ') : String(rawValue);
    forwarded.set(lowerName, value);
  }
  forwarded.set('opc-request-id', randomUUID().replaceAll('-', '').toUpperCase());
  return forwarded;
}

export function filterResponseHeaders(headers) {
  const forwarded = {};
  for (const [name, value] of headers.entries()) {
    const lowerName = name.toLowerCase();
    if (FORWARDED_RESPONSE_HEADERS.has(lowerName)) forwarded[lowerName] = value;
  }
  return forwarded;
}

export function isTrustedBrowserMutation({ method, origin, host, secFetchSite }) {
  if (!MUTATION_METHODS.has(String(method || '').toUpperCase())) return true;
  if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) return false;
  if (!origin && !secFetchSite) return false;
  if (!origin) return true;
  if (!host) return false;

  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.protocol === 'https:' && parsedOrigin.host === host;
  } catch {
    return false;
  }
}

export async function readRequestBody(request, maximumBytes) {
  const method = String(request.method || 'GET').toUpperCase();
  if (!BODY_METHODS.has(method)) return undefined;

  const declaredLength = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ProxyRequestError(413, 'Request body exceeds the proxy limit');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) {
      throw new ProxyRequestError(413, 'Request body exceeds the proxy limit');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

export async function signOciRequest({ provider, method, target, headers, body }) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  headers.set('host', target.host);
  headers.set('x-date', new Date().toUTCString());

  const headersToSign = ['x-date', '(request-target)', 'host'];
  if (BODY_METHODS.has(normalizedMethod)) {
    const payload = body || Buffer.alloc(0);
    if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
    headers.set('content-length', String(payload.length));
    headers.set('x-content-sha256', createHash('sha256').update(payload).digest('base64'));
    headersToSign.push('content-type', 'content-length', 'x-content-sha256');
  }

  const signingRequest = new SignerRequest(normalizedMethod, target.toString(), headers);
  const keyId = await provider.getKeyId();
  const privateKey = provider.getPrivateKey();
  httpSignature.sign(signingRequest, {
    key: privateKey,
    keyId,
    headers: headersToSign,
  });

  const authorization = headers.get('authorization');
  if (!authorization) throw new Error('Unable to sign backend request');
  headers.set('authorization', authorization.replace('Signature ', 'Signature version="1",'));
  return headers;
}
