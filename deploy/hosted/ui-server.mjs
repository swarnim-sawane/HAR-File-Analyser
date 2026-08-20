import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  createOpaqueToken,
  createPkceChallenge,
  isSafeReturnTo,
  parseBoundedInteger,
  parseCookies,
  redactAuthError,
  serializeCookie,
  verifyIdToken,
} from './ui-auth-core.mjs';
import {
  ProxyRequestError,
  buildBackendHealthTarget,
  buildBackendTarget,
  deriveBackendInvokeUrl,
  filterRequestHeaders,
  filterResponseHeaders,
  isTrustedBrowserMutation,
  readRequestBody,
  signOciRequest,
} from './ui-proxy-core.mjs';

const require = createRequire(import.meta.url);
const {
  InstancePrincipalsAuthenticationDetailsProviderBuilder,
  ResourcePrincipalAuthenticationDetailsProvider,
} = require('oci-common');

const HOST = '0.0.0.0';
const PORT = 8080;
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || '/app/public');
const BACKEND_INVOKE_URL = process.env.BACKEND_INVOKE_URL || '';
const BACKEND_HEALTH_URL = process.env.BACKEND_HEALTH_URL || '';
const OCI_REGION_FALLBACK = process.env.OCI_REGION_FALLBACK || 'us-phoenix-1';
const OCI_AUTH_MODE = process.env.OCI_AUTH_MODE || 'resource-principal';
const AUTH_MODE = process.env.AUTH_MODE || 'disabled';
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const IDCS_DOMAIN_URL = String(process.env.IDCS_DOMAIN_URL || '').replace(/\/$/, '');
const IDCS_CLIENT_ID = process.env.IDCS_CLIENT_ID || '';
const IDCS_CLIENT_SECRET_VAULT_ID = process.env.IDCS_CLIENT_SECRET_VAULT_ID || '';
const IDCS_SCOPES = process.env.IDCS_SCOPES || 'openid profile email';
const SESSION_TTL_SECONDS = parseBoundedInteger(process.env.SESSION_TTL_SECONDS, {
  name: 'SESSION_TTL_SECONDS', minimum: 60, maximum: 43_200, defaultValue: 28_800,
});
const PROBE_TIMEOUT_MS = 10_000;
const PROXY_TIMEOUT_MS = parseBoundedInteger(process.env.BACKEND_PROXY_TIMEOUT_MS, {
  name: 'BACKEND_PROXY_TIMEOUT_MS', minimum: 1_000, maximum: 1_800_000, defaultValue: 1_800_000,
});
const PROXY_MAX_BODY_BYTES = parseBoundedInteger(process.env.BACKEND_PROXY_MAX_BODY_BYTES, {
  name: 'BACKEND_PROXY_MAX_BODY_BYTES', minimum: 1_024, maximum: 64 * 1024 * 1024, defaultValue: 16 * 1024 * 1024,
});
const MAX_OAUTH_TRANSACTIONS = 1_000;
const MAX_SESSIONS = 10_000;
const MAX_UPSTREAM_BODY_LENGTH = 1_000;
const ENABLE_DIAGNOSTIC_PROBES = process.env.ENABLE_DIAGNOSTIC_PROBES === 'true';
const PROXY_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const SESSION_COOKIE = '__Host-har_session';
const OAUTH_COOKIE = '__Host-har_oauth';
const oauthTransactions = new Map();
const sessions = new Map();
let runtimePrincipalProvider;
let discoveryCache;
let jwksCache;
let idcsClientSecret;

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; connect-src 'self' https: wss:; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const noStoreHeaders = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
};

const send = (response, statusCode, headers, body = '') => {
  response.writeHead(statusCode, { ...securityHeaders, ...headers });
  response.end(body);
};

const getPrincipalEnvironment = () => ({
  authMode: OCI_AUTH_MODE,
  version: Boolean(process.env.OCI_RESOURCE_PRINCIPAL_VERSION),
  privatePem: Boolean(process.env.OCI_RESOURCE_PRINCIPAL_PRIVATE_PEM),
  rpst: Boolean(process.env.OCI_RESOURCE_PRINCIPAL_RPST),
  region: Boolean(process.env.OCI_RESOURCE_PRINCIPAL_REGION),
});

const getBackendInvokeUrl = () => deriveBackendInvokeUrl(BACKEND_INVOKE_URL, BACKEND_HEALTH_URL);

const getRuntimePrincipalProvider = async () => {
  if (runtimePrincipalProvider) return runtimePrincipalProvider;
  if (OCI_AUTH_MODE === 'instance-principal') {
    runtimePrincipalProvider = await new InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
    return runtimePrincipalProvider;
  }
  if (OCI_AUTH_MODE !== 'resource-principal') throw new Error('OCI_AUTH_MODE must be instance-principal or resource-principal');
  if (!process.env.OCI_RESOURCE_PRINCIPAL_REGION) process.env.OCI_RESOURCE_PRINCIPAL_REGION = OCI_REGION_FALLBACK;
  runtimePrincipalProvider = ResourcePrincipalAuthenticationDetailsProvider.builder();
  return runtimePrincipalProvider;
};

const requireHttpsUrl = (value, name) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must be a clean HTTPS URL`);
  }
  return parsed;
};

const getAuthConfiguration = () => {
  if (AUTH_MODE === 'disabled') return null;
  if (AUTH_MODE !== 'idcs') throw new Error('AUTH_MODE must be idcs or disabled');
  const publicBase = requireHttpsUrl(PUBLIC_BASE_URL, 'PUBLIC_BASE_URL');
  const domain = requireHttpsUrl(IDCS_DOMAIN_URL, 'IDCS_DOMAIN_URL');
  if (!IDCS_CLIENT_ID || !IDCS_CLIENT_SECRET_VAULT_ID) throw new Error('IDCS client and Vault configuration is incomplete');
  return {
    publicBase: publicBase.toString().replace(/\/$/, ''),
    domainOrigin: domain.origin,
    redirectUri: `${publicBase.toString().replace(/\/$/, '')}/auth/callback`,
  };
};

const authConfiguration = getAuthConfiguration();

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, { ...options, redirect: 'manual', signal: options.signal || AbortSignal.timeout(10_000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`Upstream request failed (${response.status})`);
  return body;
};

const getDiscovery = async () => {
  if (!discoveryCache || discoveryCache.expiresAt <= Date.now()) {
    const document = await fetchJson(`${authConfiguration.domainOrigin}/.well-known/openid-configuration`);
    for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'issuer']) {
      if (typeof document[field] !== 'string') throw new Error(`IDCS discovery is missing ${field}`);
    }
    for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
      const endpoint = requireHttpsUrl(document[field], `IDCS ${field}`);
      if (endpoint.hostname !== new URL(authConfiguration.domainOrigin).hostname) throw new Error(`IDCS ${field} uses an unexpected host`);
    }
    discoveryCache = { document, expiresAt: Date.now() + 3_600_000 };
  }
  return discoveryCache.document;
};

const getJwks = async (force = false) => {
  if (force || !jwksCache || jwksCache.expiresAt <= Date.now()) {
    const discovery = await getDiscovery();
    jwksCache = { document: await fetchJson(discovery.jwks_uri), expiresAt: Date.now() + 3_600_000 };
  }
  return jwksCache.document;
};

const getIdcsClientSecret = async () => {
  if (idcsClientSecret) return idcsClientSecret;
  const target = new URL(`https://secrets.vaults.${OCI_REGION_FALLBACK}.oci.oraclecloud.com/20190301/secretbundles/${encodeURIComponent(IDCS_CLIENT_SECRET_VAULT_ID)}`);
  const headers = new Headers({ Accept: 'application/json' });
  await signOciRequest({ provider: await getRuntimePrincipalProvider(), method: 'GET', target, headers });
  const bundle = await fetchJson(target.toString(), { method: 'GET', headers });
  const encoded = bundle?.secretBundleContent?.content;
  if (typeof encoded !== 'string' || !encoded) throw new Error('Vault secret bundle did not contain content');
  idcsClientSecret = Buffer.from(encoded, 'base64').toString('utf8');
  if (!idcsClientSecret) throw new Error('Vault secret is empty');
  return idcsClientSecret;
};

const cleanupAuthStores = () => {
  const now = Date.now();
  for (const [key, value] of oauthTransactions) if (value.expiresAt <= now) oauthTransactions.delete(key);
  for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key);
};

const getSession = (request) => {
  cleanupAuthStores();
  const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
  if (!token) return null;
  const session = sessions.get(token);
  return session && session.expiresAt > Date.now() ? { token, ...session } : null;
};

const redirect = (response, location, cookies = []) => send(response, 302, {
  ...noStoreHeaders,
  Location: location,
  ...(cookies.length ? { 'Set-Cookie': cookies } : {}),
});

const beginLogin = async (request, response, url) => {
  cleanupAuthStores();
  if (oauthTransactions.size >= MAX_OAUTH_TRANSACTIONS) throw new Error('Too many authentication requests are pending');
  const returnTo = isSafeReturnTo(url.searchParams.get('return_to')) ? url.searchParams.get('return_to') : '/';
  const state = createOpaqueToken();
  const nonce = createOpaqueToken();
  const verifier = createOpaqueToken(48);
  oauthTransactions.set(state, { nonce, verifier, returnTo, expiresAt: Date.now() + 600_000 });
  const discovery = await getDiscovery();
  const authorize = new URL(discovery.authorization_endpoint);
  authorize.search = new URLSearchParams({
    client_id: IDCS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: authConfiguration.redirectUri,
    scope: IDCS_SCOPES,
    state,
    nonce,
    code_challenge: createPkceChallenge(verifier),
    code_challenge_method: 'S256',
  }).toString();
  redirect(response, authorize.toString(), [serializeCookie(OAUTH_COOKIE, state, { maxAge: 600 })]);
};

const completeLogin = async (request, response, url) => {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const cookieState = parseCookies(request.headers.cookie).get(OAUTH_COOKIE) || '';
  const transaction = oauthTransactions.get(state);
  oauthTransactions.delete(state);
  if (!state || !code || !transaction || state !== cookieState || transaction.expiresAt <= Date.now()) {
    throw new Error('OAuth state is missing or expired');
  }
  const discovery = await getDiscovery();
  const clientSecret = await getIdcsClientSecret();
  const tokenResponse = await fetchJson(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${IDCS_CLIENT_ID}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: authConfiguration.redirectUri,
      code_verifier: transaction.verifier,
    }),
  });
  if (typeof tokenResponse.id_token !== 'string') throw new Error('IDCS did not return an ID token');
  let claims;
  try {
    claims = verifyIdToken({
      token: tokenResponse.id_token,
      jwks: await getJwks(),
      issuer: discovery.issuer,
      audience: IDCS_CLIENT_ID,
      nonce: transaction.nonce,
    });
  } catch (error) {
    if (!/signing key was not found/.test(String(error?.message))) throw error;
    claims = verifyIdToken({
      token: tokenResponse.id_token,
      jwks: await getJwks(true),
      issuer: discovery.issuer,
      audience: IDCS_CLIENT_ID,
      nonce: transaction.nonce,
    });
  }
  const token = createOpaqueToken();
  const ttlSeconds = Math.max(60, Math.min(SESSION_TTL_SECONDS, Number(claims.exp) - Math.floor(Date.now() / 1000)));
  cleanupAuthStores();
  if (sessions.size >= MAX_SESSIONS) throw new Error('The session capacity has been reached');
  sessions.set(token, {
    claims: { sub: claims.sub, name: claims.name, email: claims.email, preferred_username: claims.preferred_username },
    idToken: tokenResponse.id_token,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  redirect(response, `${authConfiguration.publicBase}${transaction.returnTo === '/' ? '/' : transaction.returnTo}`, [
    serializeCookie(SESSION_COOKIE, token, { maxAge: ttlSeconds }),
    serializeCookie(OAUTH_COOKIE, '', { maxAge: 0 }),
  ]);
};

const endSession = async (request, response) => {
  const session = getSession(request);
  if (session) sessions.delete(session.token);
  const discovery = await getDiscovery();
  const localReturn = `${authConfiguration.publicBase}/`;
  if (discovery.end_session_endpoint) {
    const logout = new URL(discovery.end_session_endpoint);
    logout.searchParams.set('post_logout_redirect_uri', localReturn);
    if (session?.idToken) logout.searchParams.set('id_token_hint', session.idToken);
    redirect(response, logout.toString(), [serializeCookie(SESSION_COOKIE, '', { maxAge: 0 })]);
    return;
  }
  redirect(response, localReturn, [serializeCookie(SESSION_COOKIE, '', { maxAge: 0 })]);
};

const requireSession = (request, response, url) => {
  if (!authConfiguration) return true;
  if (getSession(request)) return true;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    send(response, 401, { ...noStoreHeaders, 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'Authentication required' }));
    return false;
  }
  const returnTo = isSafeReturnTo(`${url.pathname}${url.search}`) ? `${url.pathname}${url.search}` : '/';
  redirect(response, `${authConfiguration.publicBase}/auth/login?return_to=${encodeURIComponent(returnTo)}`);
  return false;
};

const getTrustedBrowserHost = (request) => {
  if (authConfiguration) return new URL(authConfiguration.publicBase).host;
  return request.headers.host;
};

const parseUpstreamBody = async (upstream) => {
  const upstreamText = (await upstream.text()).slice(0, MAX_UPSTREAM_BODY_LENGTH);
  try {
    return JSON.parse(upstreamText);
  } catch {
    return upstreamText;
  }
};

const safeErrorDetails = (error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: message
      .replace(/Bearer\s+[^\s,]+/gi, 'Bearer [REDACTED]')
      .replace(/Signature\s+[^\r\n]+/gi, 'Signature [REDACTED]')
      .slice(0, 500),
  };
};

const fetchBackendHealth = async ({ signed }) => {
  const target = buildBackendHealthTarget(getBackendInvokeUrl());
  const headers = new Headers({ Accept: 'application/json' });
  let regionSource = 'injected';

  if (signed) {
    if (!process.env.OCI_RESOURCE_PRINCIPAL_REGION) {
      process.env.OCI_RESOURCE_PRINCIPAL_REGION = OCI_REGION_FALLBACK;
      regionSource = 'fixed-fallback';
    }
    await signOciRequest({
      provider: await getRuntimePrincipalProvider(),
      method: 'GET',
      target,
      headers,
    });
  }

  const upstream = await fetch(target.toString(), {
    method: 'GET',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });

  return {
    upstream,
    upstreamBody: await parseUpstreamBody(upstream),
    regionSource,
  };
};

const proxyBackendRequest = async (request, response) => {
  const method = String(request.method || 'GET').toUpperCase();
  if (!PROXY_METHODS.has(method)) {
    send(response, 405, {
      Allow: Array.from(PROXY_METHODS).join(', '),
      'Content-Type': 'application/json; charset=utf-8',
    }, JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  if (!isTrustedBrowserMutation({
    method,
    origin: request.headers.origin,
    host: getTrustedBrowserHost(request),
    secFetchSite: request.headers['sec-fetch-site'],
  })) {
    console.warn(JSON.stringify({
      event: 'backend_proxy_rejected',
      reason: 'untrusted_browser_mutation',
      method,
      path: new URL(request.url || '/', 'http://ui.invalid').pathname,
      originPresent: Boolean(request.headers.origin),
      secFetchSite: request.headers['sec-fetch-site'] || undefined,
      trustedHost: getTrustedBrowserHost(request),
    }));
    send(response, 403, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({
      error: 'Cross-site mutation requests are not allowed',
    }));
    return;
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Backend request timed out')), PROXY_TIMEOUT_MS);
  timeout.unref();
  request.once('aborted', () => controller.abort(new Error('Client aborted request')));
  response.once('close', () => {
    if (!response.writableEnded) controller.abort(new Error('Client connection closed'));
  });

  try {
    const target = buildBackendTarget(getBackendInvokeUrl(), request.url);
    const body = await readRequestBody(request, PROXY_MAX_BODY_BYTES);
    const headers = filterRequestHeaders(request.headers);
    await signOciRequest({
      provider: await getRuntimePrincipalProvider(),
      method,
      target,
      headers,
      body,
    });

    const upstream = await fetch(target.toString(), {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: controller.signal,
    });

    const responseHeaders = filterResponseHeaders(upstream.headers);
    response.writeHead(upstream.status, { ...securityHeaders, ...responseHeaders });
    console.log(JSON.stringify({
      event: 'backend_proxy',
      method,
      path: new URL(request.url || '/', 'http://ui.invalid').pathname,
      status: upstream.status,
      latencyMs: Date.now() - startedAt,
      opcRequestId: upstream.headers.get('opc-request-id') || undefined,
    }));

    if (method === 'HEAD' || !upstream.body) {
      response.end();
      clearTimeout(timeout);
      return;
    }

    Readable.fromWeb(upstream.body)
      .once('error', (error) => {
        console.error('Backend response stream failed:', safeErrorDetails(error));
        response.destroy();
      })
      .once('end', () => clearTimeout(timeout))
      .pipe(response);
  } catch (error) {
    clearTimeout(timeout);
    const statusCode = error instanceof ProxyRequestError ? error.statusCode : 502;
    console.error('Backend proxy request failed:', safeErrorDetails(error));
    if (!response.headersSent) {
      send(response, statusCode, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({
        error: statusCode === 502 ? 'Backend request failed' : error.message,
      }));
    } else {
      response.destroy();
    }
  }
};

const resolveStaticPath = (pathname) => {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const candidate = path.resolve(STATIC_DIR, `.${decoded}`);
  if (candidate !== STATIC_DIR && !candidate.startsWith(`${STATIC_DIR}${path.sep}`)) {
    return null;
  }
  return candidate;
};

const existingFile = async (candidate) => {
  try {
    const details = await stat(candidate);
    return details.isFile() ? candidate : null;
  } catch {
    return null;
  }
};

const serveFile = async (request, response, filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  const cacheControl = extension === '.html'
    ? 'no-cache'
    : 'public, max-age=31536000, immutable';
  const headers = {
    'Cache-Control': cacheControl,
    'Content-Type': contentTypes.get(extension) || 'application/octet-stream',
  };

  if (request.method === 'HEAD') {
    send(response, 200, headers);
    return;
  }

  response.writeHead(200, { ...securityHeaders, ...headers });
  createReadStream(filePath)
    .on('error', () => {
      if (!response.headersSent) send(response, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Internal Server Error');
      else response.destroy();
    })
    .pipe(response);
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');

  try {
    if (url.pathname === '/auth/login' && request.method === 'GET') {
      if (!authConfiguration) throw new Error('Authentication is disabled');
      await beginLogin(request, response, url);
      return;
    }
    if (url.pathname === '/auth/callback' && request.method === 'GET') {
      if (!authConfiguration) throw new Error('Authentication is disabled');
      await completeLogin(request, response, url);
      return;
    }
    if (url.pathname === '/auth/logout' && (request.method === 'GET' || request.method === 'POST')) {
      if (!authConfiguration) throw new Error('Authentication is disabled');
      await endSession(request, response);
      return;
    }
    if (url.pathname === '/auth/me' && request.method === 'GET') {
      const session = getSession(request);
      send(response, session ? 200 : 401, { ...noStoreHeaders, 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({
        authenticated: Boolean(session),
        user: session?.claims,
      }));
      return;
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'authentication_error', error: redactAuthError(error) }));
    send(response, 502, { ...noStoreHeaders, 'Content-Type': 'text/plain; charset=utf-8' }, 'Authentication could not be completed. Please try again.');
    return;
  }

  if (url.pathname !== '/health' && !requireSession(request, response, url)) return;

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    await proxyBackendRequest(request, response);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
    return;
  }

  if (url.pathname === '/health') {
    send(response, 200, { ...noStoreHeaders, 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({
      status: 'ok',
      role: 'ui',
    }));
    return;
  }

  if (url.pathname === '/probe/backend-health' || url.pathname === '/probe/backend-health-signed') {
    if (!ENABLE_DIAGNOSTIC_PROBES) {
      send(response, 404, { ...noStoreHeaders, 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
      return;
    }
    if (!BACKEND_INVOKE_URL && !BACKEND_HEALTH_URL) {
      send(response, 503, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({
        status: 'configuration-missing',
        backendInvokeUrlConfigured: false,
      }));
      return;
    }

    const signed = url.pathname.endsWith('-signed');
    const principalEnvironment = getPrincipalEnvironment();

    try {
      const { upstream, upstreamBody, regionSource } = await fetchBackendHealth({ signed });

      send(response, 200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({
        status: upstream.ok ? 'upstream-ok' : 'upstream-rejected',
        networkReachable: true,
        requestSigned: signed,
        upstreamStatus: upstream.status,
        upstreamStatusText: upstream.statusText,
        principalEnvironment,
        regionSource: signed ? regionSource : 'not-used',
        upstreamBody,
      }));
    } catch (error) {
      send(response, 200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({
        status: signed ? 'signed-request-failed' : 'network-error',
        networkReachable: signed ? null : false,
        requestSigned: signed,
        error: safeErrorDetails(error),
        principalEnvironment,
      }));
    }
    return;
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = resolveStaticPath(requestedPath);
  if (!safePath) {
    send(response, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request');
    return;
  }

  const filePath = await existingFile(safePath);
  if (filePath) {
    await serveFile(request, response, filePath);
    return;
  }

  if (!path.extname(requestedPath)) {
    await serveFile(request, response, path.join(STATIC_DIR, 'index.html'));
    return;
  }

  send(response, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`HAR Analyzer UI listening on http://${HOST}:${PORT}`);
  console.log(`Signed backend proxy configured: ${Boolean(BACKEND_INVOKE_URL || BACKEND_HEALTH_URL)}`);
  console.log(`Browser authentication mode: ${AUTH_MODE}`);
  console.log(`OCI authentication mode: ${OCI_AUTH_MODE}`);
  if (authConfiguration) {
    void getIdcsClientSecret()
      .then(() => console.log('IDCS client secret loaded from OCI Vault'))
      .catch((error) => console.error(JSON.stringify({ event: 'vault_secret_preload_failed', error: redactAuthError(error) })));
  }
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
