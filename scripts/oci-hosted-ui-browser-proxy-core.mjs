import { randomUUID } from 'node:crypto';

const UI_OCID_PATTERN = /^ocid1\.generativeaihostedapplicationiam\.[a-z0-9.-]+$/;
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

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
  'location',
  'opc-request-id',
  'retry-after',
]);

export class BrowserProxyError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'BrowserProxyError';
    this.statusCode = statusCode;
  }
}

export function buildHostedUiBase({ region, applicationOcid }) {
  const normalizedRegion = String(region || '').trim().toLowerCase();
  const normalizedOcid = String(applicationOcid || '').trim();

  if (!/^[a-z0-9-]+$/.test(normalizedRegion)) {
    throw new BrowserProxyError(500, 'OCI region is invalid');
  }
  if (!UI_OCID_PATTERN.test(normalizedOcid)) {
    throw new BrowserProxyError(500, 'OCI UI application OCID is invalid');
  }

  return new URL(
    `https://inference.generativeai.${normalizedRegion}.oci.oraclecloud.com/20251112/hostedApplicationsIam/${normalizedOcid}/actions/invoke`,
  );
}

export function buildHostedUiTarget(base, incomingUrl) {
  const incoming = new URL(incomingUrl || '/', 'http://browser-proxy.invalid');
  if (!incoming.pathname.startsWith('/')) {
    throw new BrowserProxyError(400, 'Request path is invalid');
  }

  const target = new URL(base.toString());
  target.pathname = `${target.pathname.replace(/\/+$/, '')}${incoming.pathname}`;
  target.search = incoming.search;
  return target;
}

export function validateMethod(method) {
  const normalized = String(method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(normalized)) {
    throw new BrowserProxyError(405, 'Method not allowed');
  }
  return normalized;
}

export function isTrustedLocalRequest({ method, origin, host, secFetchSite }) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (!BODY_METHODS.has(normalizedMethod)) return true;
  if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) return false;
  if (!origin) return true;
  if (!host) return false;

  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === host;
  } catch {
    return false;
  }
}

export function filterBrowserRequestHeaders(headers = {}) {
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

export function filterHostedResponseHeaders(headers) {
  const forwarded = {};
  for (const [name, value] of headers.entries()) {
    const lowerName = name.toLowerCase();
    if (FORWARDED_RESPONSE_HEADERS.has(lowerName)) forwarded[lowerName] = value;
  }
  return forwarded;
}

export async function readBoundedBody(request, maximumBytes) {
  const method = String(request.method || 'GET').toUpperCase();
  if (!BODY_METHODS.has(method)) return undefined;

  const declaredLength = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new BrowserProxyError(413, 'Request body exceeds the browser proxy limit');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) {
      throw new BrowserProxyError(413, 'Request body exceeds the browser proxy limit');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}
