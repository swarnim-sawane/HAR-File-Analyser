// src/hooks/useInsights.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { Entry, HarFile, Header } from '../types/har';

export type InsightSeverity = 'critical' | 'high' | 'medium' | 'low';
export type InsightHealth = 'critical' | 'degraded' | 'warning' | 'healthy';

export interface InsightFinding {
  severity: InsightSeverity;
  title: string;
  product?: string;
  component?: string;
  what: string;
  why: string;
  evidence: string;
  fix: string;
  srGuidance?: string;
}

export interface InsightSection {
  type: string;
  title: string;
  findings: InsightFinding[];
}

export interface InsightsResult {
  overallHealth: InsightHealth;
  summary: string;
  sections: InsightSection[];
  detectedProducts?: Array<{ product: string; shortName: string }>;
}

interface UseInsightsReturn {
  insights: InsightsResult | null;
  isGenerating: boolean;
  error: string | null;
  generate: () => void;
  cancel: () => void;
}

const insightsCache = new Map<string, InsightsResult>();

const TRIAGE_CONTEXT_LIMIT = 4000;
const TRIAGE_SNIPPET_LIMIT = 240;
const STATIC_ASSET_PATTERN = /\.(?:avif|bmp|css|gif|ico|jpe?g|js|map|mjs|mp4|otf|png|svg|ttf|webp|woff2?)(?:$|[?#])/i;

function uniqueNonEmpty(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }

  return unique;
}

function getUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function endpointFromUrl(value: string): string {
  const url = getUrl(value);
  if (url) return `${url.hostname}${url.pathname}`;
  return value.split(/[?#]/)[0] || value;
}

function requestKey(entry: Entry): string {
  return `${entry.request.method.toUpperCase()} ${endpointFromUrl(entry.request.url)}`;
}

function startedAt(entry: Entry): number {
  const parsed = new Date(entry.startedDateTime).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getHeader(headers: Header[] | undefined, name: string): string {
  const lower = name.toLowerCase();
  return headers?.find((header) => header.name.toLowerCase() === lower)?.value?.trim() ?? '';
}

function getRequestHeader(entry: Entry, name: string): string {
  return getHeader(entry.request.headers, name);
}

function getResponseHeader(entry: Entry, name: string): string {
  return getHeader(entry.response.headers, name);
}

function presence(value: string): 'present' | 'missing' {
  return value ? 'present' : 'missing';
}

function authorizationPresence(entry: Entry): 'present' | 'missing' {
  return presence(getRequestHeader(entry, 'authorization'));
}

function authorizationScheme(entry: Entry): string {
  const authorization = getRequestHeader(entry, 'authorization');
  if (!authorization) return 'none';
  const [scheme] = authorization.split(/\s+/);
  return /^[a-z][a-z0-9._-]{1,24}$/i.test(scheme) ? scheme : 'present';
}

function cookieNamesFromHeader(value: string): string[] {
  if (!value) return [];

  return uniqueNonEmpty(
    value
      .split(';')
      .map((part) => part.trim().split('=')[0])
  );
}

function requestCookieNames(entry: Entry): string[] {
  return uniqueNonEmpty([
    ...(entry.request.cookies ?? []).map((cookie) => cookie.name),
    ...cookieNamesFromHeader(getRequestHeader(entry, 'cookie')),
  ]);
}

function formatNameList(names: string[]): string {
  return names.length > 0 ? names.join(',') : 'none';
}

function queryParamNames(entry: Entry): string[] {
  const url = getUrl(entry.request.url);
  const urlParams = url ? Array.from(url.searchParams.keys()) : [];
  return uniqueNonEmpty([
    ...(entry.request.queryString ?? []).map((param) => param.name),
    ...urlParams,
  ]);
}

function contentTypeFrom(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

function requestContentType(entry: Entry): string {
  return contentTypeFrom(getRequestHeader(entry, 'content-type') || entry.request.postData?.mimeType || '');
}

function responseContentType(entry: Entry): string {
  return contentTypeFrom(getResponseHeader(entry, 'content-type') || entry.response.content?.mimeType || '');
}

function redactSensitiveText(value: string, limit = TRIAGE_SNIPPET_LIMIT): string {
  let redacted = value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(Bearer\s+)(?!error=)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[redacted]')
    .replace(/("(?:access_token|refresh_token|id_token|password|passwd|secret|api[_-]?key|session|session_id)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replace(/\b((?:access_token|refresh_token|id_token|password|passwd|secret|api[_-]?key|session|sessionid)=)[^&\s,;]+/gi, '$1[redacted]');

  if (redacted.length > limit) {
    redacted = `${redacted.slice(0, limit)}...[truncated]`;
  }

  return redacted;
}

function responseSnippet(entry: Entry): string {
  const text = entry.response.content?.text;
  if (!text || typeof text !== 'string') return '';

  const mime = entry.response.content?.mimeType?.toLowerCase() ?? responseContentType(entry);
  const isTextLike =
    mime.includes('json') ||
    mime.includes('text') ||
    mime.includes('xml') ||
    mime.includes('html') ||
    mime.includes('javascript');

  if (entry.response.content?.encoding === 'base64' && !isTextLike) return '';
  return redactSensitiveText(text);
}

function postBodyFieldNames(entry: Entry): string[] {
  const postData = entry.request.postData;
  if (!postData) return [];

  if (postData.params?.length) {
    return uniqueNonEmpty(postData.params.map((param) => param.name));
  }

  const text = postData.text?.trim();
  if (!text) return [];

  const contentType = requestContentType(entry) || contentTypeFrom(postData.mimeType);
  if (contentType.includes('json')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return uniqueNonEmpty(Object.keys(parsed));
      }
    } catch {
      return [];
    }
  }

  if (contentType.includes('x-www-form-urlencoded')) {
    try {
      return uniqueNonEmpty(Array.from(new URLSearchParams(text).keys()));
    } catch {
      return [];
    }
  }

  return [];
}

function triageEntryLine(entry: Entry): string {
  const wait = entry.timings?.wait ?? 0;
  return `${entry.request.method.toUpperCase()} ${endpointFromUrl(entry.request.url)} status=${entry.response.status} totalms=${entry.time.toFixed(0)} wait=${wait.toFixed(0)}ms`;
}

function isStaticAsset(entry: Entry): boolean {
  const url = getUrl(entry.request.url);
  const path = url?.pathname ?? entry.request.url;
  const mime = entry.response.content?.mimeType?.toLowerCase() ?? '';

  return (
    STATIC_ASSET_PATTERN.test(path) ||
    mime.startsWith('image/') ||
    mime.startsWith('font/') ||
    mime.includes('javascript') ||
    mime.includes('css')
  );
}

function findPriorSuccess(entries: Entry[], failure: Entry): Entry | null {
  const failureKey = requestKey(failure);
  const failureStart = startedAt(failure);

  return [...entries]
    .filter((entry) =>
      requestKey(entry) === failureKey &&
      startedAt(entry) <= failureStart &&
      entry.response.status >= 200 &&
      entry.response.status < 400
    )
    .sort((a, b) => startedAt(b) - startedAt(a))[0] ?? null;
}

function successFailureDelta(success: Entry, failure: Entry): string {
  const deltas: string[] = [];

  const successAuth = authorizationPresence(success);
  const failureAuth = authorizationPresence(failure);
  if (successAuth !== failureAuth) {
    deltas.push(`authorization:${successAuth}->${failureAuth}`);
  }

  const successCookies = formatNameList(requestCookieNames(success));
  const failureCookies = formatNameList(requestCookieNames(failure));
  if (successCookies !== failureCookies) {
    deltas.push(`cookie_names:${successCookies}->${failureCookies}`);
  }

  const successContentType = requestContentType(success) || 'none';
  const failureContentType = requestContentType(failure) || 'none';
  if (successContentType !== failureContentType && (successContentType !== 'none' || failureContentType !== 'none')) {
    deltas.push(`request_content_type:${successContentType}->${failureContentType}`);
  }

  return deltas.join(' ');
}

function safeLocationHeaderValue(value: string): string {
  const trimmed = value.trim();
  const absoluteUrl = getUrl(trimmed);

  if (absoluteUrl) {
    const queryNames = uniqueNonEmpty(Array.from(absoluteUrl.searchParams.keys()));
    return [
      `${absoluteUrl.hostname}${absoluteUrl.pathname}`,
      queryNames.length ? `query_params=${queryNames.join(',')}` : null,
    ].filter(Boolean).join(' ');
  }

  try {
    const relativeUrl = new URL(trimmed, 'https://har.local');
    const queryNames = uniqueNonEmpty(Array.from(relativeUrl.searchParams.keys()));
    const safePath = trimmed.startsWith('/') ? relativeUrl.pathname : trimmed.split(/[?#]/)[0];
    return [
      safePath || '/',
      queryNames.length ? `query_params=${queryNames.join(',')}` : null,
    ].filter(Boolean).join(' ');
  } catch {
    return redactSensitiveText(trimmed.split(/[?#]/)[0], 180);
  }
}

function safeResponseHeaderValue(name: string, value: string): string {
  if (name.toLowerCase() === 'location') return safeLocationHeaderValue(value);
  return redactSensitiveText(value, 180);
}

function responseHeaderEvidence(entry: Entry): string[] {
  return [
    ['WWW-Authenticate', getResponseHeader(entry, 'www-authenticate')],
    ['Content-Type', getResponseHeader(entry, 'content-type')],
    ['Location', getResponseHeader(entry, 'location')],
    ['Access-Control-Allow-Origin', getResponseHeader(entry, 'access-control-allow-origin')],
    ['Access-Control-Allow-Credentials', getResponseHeader(entry, 'access-control-allow-credentials')],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => `${name}=${safeResponseHeaderValue(name, value)}`);
}

function corsEvidence(entry: Entry): string {
  const origin = getRequestHeader(entry, 'origin');
  if (!origin) return '';

  const allowOrigin = getResponseHeader(entry, 'access-control-allow-origin');
  const method = entry.request.method.toUpperCase();
  const status = entry.response.status;
  const allowMethod = getResponseHeader(entry, 'access-control-allow-methods');
  const allowHeaders = getResponseHeader(entry, 'access-control-allow-headers');
  const parts = [
    `origin=${redactSensitiveText(origin, 160)}`,
    `access-control-allow-origin=${allowOrigin ? redactSensitiveText(allowOrigin, 160) : 'missing'}`,
    method === 'OPTIONS' ? 'preflight=true' : null,
    status ? `status=${status}` : null,
    allowMethod ? `access-control-allow-methods=${redactSensitiveText(allowMethod, 160)}` : null,
    allowHeaders ? `access-control-allow-headers=${redactSensitiveText(allowHeaders, 160)}` : null,
  ].filter(Boolean);

  return `CORS_POLICY_EVIDENCE ${parts.join(' ')}`;
}

function badRequestEvidence(entry: Entry): string {
  const queryNames = queryParamNames(entry);
  const fieldNames = postBodyFieldNames(entry);
  const contentType = requestContentType(entry);
  const snippet = responseSnippet(entry);
  const parts = [
    `BAD_REQUEST_EVIDENCE ${triageEntryLine(entry)}`,
    queryNames.length ? `query_params=${queryNames.join(',')}` : null,
    contentType ? `request_content_type=${contentType}` : null,
    fieldNames.length ? `post_body_fields=${fieldNames.join(',')}` : null,
    snippet ? `response_snippet=${snippet}` : null,
  ].filter(Boolean);

  return parts.join(' ');
}

export function buildHarTriageCaseFile(harData: HarFile): string {
  const sortedEntries = [...harData.log.entries].sort((a, b) => startedAt(a) - startedAt(b));
  const errors = sortedEntries.filter((entry) => entry.response.status >= 400);
  if (errors.length === 0) return '';

  const firstDecisiveFailure = errors.find((entry) => !isStaticAsset(entry)) ?? errors[0];
  const priorSuccess = findPriorSuccess(sortedEntries, firstDecisiveFailure);
  const sameEndpointFailures = errors.filter((entry) => requestKey(entry) === requestKey(firstDecisiveFailure));
  const lines = [
    'EXPERT TRIAGE CASE FILE (model priority: identify first decisive failure, separate symptoms, avoid blanket 400/401/500 summaries)',
    `FIRST_DECISIVE_FAILURE ${triageEntryLine(firstDecisiveFailure)}`,
  ];

  const firstResponseHeaders = responseHeaderEvidence(firstDecisiveFailure);
  if (firstResponseHeaders.length > 0) {
    lines.push(`FIRST_FAILURE_RESPONSE_HEADERS ${firstResponseHeaders.join(' ')}`);
  }

  const firstSnippet = responseSnippet(firstDecisiveFailure);
  if (firstSnippet) {
    lines.push(`FIRST_FAILURE_RESPONSE_BODY response_snippet=${firstSnippet}`);
  }

  if (priorSuccess) {
    const delta = successFailureDelta(priorSuccess, firstDecisiveFailure);
    if (delta) {
      lines.push(`SUCCESS_VS_FAILURE_DELTA prior_success=${triageEntryLine(priorSuccess)} failing_request=${triageEntryLine(firstDecisiveFailure)} ${delta}`);
    }
  }

  if (firstDecisiveFailure.response.status === 401 || firstDecisiveFailure.response.status === 403) {
    const wwwAuthenticate = getResponseHeader(firstDecisiveFailure, 'www-authenticate');
    const parts = [
      `authorization=${authorizationPresence(firstDecisiveFailure)}`,
      `authorization_scheme=${authorizationScheme(firstDecisiveFailure)}`,
      `cookie_names=${formatNameList(requestCookieNames(firstDecisiveFailure))}`,
      wwwAuthenticate ? `WWW-Authenticate=${redactSensitiveText(wwwAuthenticate, 180)}` : null,
    ].filter(Boolean);
    lines.push(`AUTH_EVIDENCE ${parts.join(' ')}`);
  }

  const firstCorsEvidence = corsEvidence(firstDecisiveFailure);
  if (firstCorsEvidence) {
    lines.push(firstCorsEvidence);
  }

  const badRequests = errors.filter((entry) => entry.response.status === 400).slice(0, 3);
  for (const entry of badRequests) {
    lines.push(badRequestEvidence(entry));
  }

  if (sameEndpointFailures.length > 1) {
    const statuses = uniqueNonEmpty(sameEndpointFailures.map((entry) => String(entry.response.status))).join(',');
    lines.push(
      `DOWNSTREAM_SYMPTOMS same_endpoint=${requestKey(firstDecisiveFailure)} repeated_failures=${sameEndpointFailures.length} after_first=${sameEndpointFailures.length - 1} statuses=${statuses}`
    );
  }

  const raw = lines.join('\n');
  return raw.length > TRIAGE_CONTEXT_LIMIT ? `${raw.slice(0, TRIAGE_CONTEXT_LIMIT)}\n[TRIAGE_CONTEXT_TRUNCATED]` : raw;
}

export function buildHarContext(harData: HarFile): string {
  const entries = harData.log.entries;
  const errors = entries.filter((e) => e.response.status >= 400);
  // Split errors by HTTP severity tier for priority-ordered analysis
  const serverErrors = errors.filter((e) => e.response.status >= 500);          // 5xx
  const clientErrors = errors.filter((e) => e.response.status >= 400 && e.response.status < 500); // 4xx
  const totalMs = entries.reduce((s, e) => s + e.time, 0);
  const domains = [
    ...new Set(
      entries.map((e) => {
        try { return new URL(e.request.url).hostname; } catch { return 'unknown'; }
      })
    ),
  ];

  // ── Session-level metrics ──────────────────────────────────────────────────
  // Compute wall-clock session duration (first request start → last request end)
  let sessionMs = 0;
  try {
    const starts = entries.map((e) => new Date(e.startedDateTime).getTime());
    const ends = entries.map((e, i) => starts[i] + e.time);
    sessionMs = Math.max(...ends) - Math.min(...starts);
  } catch { sessionMs = totalMs; }

  // Identify the final non-static destination (what the user actually landed on)
  const sortedByStart = [...entries].sort((a, b) =>
    new Date(a.startedDateTime).getTime() - new Date(b.startedDateTime).getTime()
  );
  const finalEntry = [...sortedByStart].reverse().find((e) => {
    const mime = e.response.content?.mimeType ?? '';
    return mime.includes('html') || mime.includes('json') || e.response.status >= 400;
  }) ?? sortedByStart[sortedByStart.length - 1];
  let finalUrl = '';
  try { finalUrl = new URL(finalEntry?.request.url ?? '').pathname; } catch { finalUrl = finalEntry?.request.url ?? ''; }
  const finalStatus = finalEntry?.response.status ?? 0;

  // Known error page path patterns — used to flag chains ending on error pages
  const ERROR_PATH_PATTERNS = /servererror|errorpage|error\.jsp|\/error\b|\/oops|\/unavailable|\/fault/i;
  const endsOnErrorPage = ERROR_PATH_PATTERNS.test(finalUrl) || finalStatus >= 400;

  // ── Redirect chain detection ───────────────────────────────────────────────
  // Group sequential redirects into chains so the AI sees the compounding flow.
  // A redirect chain is a run of 3xx responses followed by a terminal response.
  // Declared here (before summary) so 3xx count is available in the summary line.
  const redirects = sortedByStart.filter((e) => e.response.status >= 300 && e.response.status < 400);

  const summary = [
    `requests:${entries.length}`,
    serverErrors.length > 0 ? `5xx:${serverErrors.length}` : null,
    clientErrors.length > 0 ? `4xx:${clientErrors.length}` : null,
    redirects.length > 0 ? `3xx:${redirects.length}` : null,
    `domains:${domains.length}`,
    `total_session:${sessionMs.toFixed(0)}ms`,
    `final_url:${finalUrl}`,
    `final_status:${finalStatus}`,
    endsOnErrorPage ? `ENDS_ON_ERROR_PAGE:true` : null,
  ].filter(Boolean).join(' ');
  let redirectChainSection = '';
  if (redirects.length > 0) {
    const chainLines = sortedByStart
      .filter((e) => {
        const mime = e.response.content?.mimeType ?? '';
        return (
          (e.response.status >= 300 && e.response.status < 400) ||
          (e.response.status < 300 && (mime.includes('html') || mime.includes('json')))
        );
      })
      .map((e, i) => {
        const t = e.timings ?? {};
        const dns     = (t.dns     ?? -1) >= 0 ? `dns=${(t.dns     ?? 0).toFixed(0)}ms ` : '';
        const connect = (t.connect ?? -1) >= 0 ? `connect=${(t.connect ?? 0).toFixed(0)}ms ` : '';
        const ssl     = (t.ssl     ?? -1) >= 0 ? `ssl=${(t.ssl     ?? 0).toFixed(0)}ms ` : '';
        const wait    = (t.wait    ?? 0).toFixed(0);
        const isNewConn = (t.dns ?? -1) >= 0 && (t.connect ?? -1) >= 0;
        const connType = isNewConn ? '[NEW-CONN]' : '[KEEPALIVE]';

        let path = '';
        try { path = new URL(e.request.url).hostname + new URL(e.request.url).pathname; } catch { path = e.request.url; }

        const loc = e.response.headers?.find((h) => h.name.toLowerCase() === 'location')?.value ?? '';
        const locPath = loc ? safeLocationHeaderValue(loc) : '';

        const isError = ERROR_PATH_PATTERNS.test(path) || e.response.status >= 400;
        const errorFlag = isError ? ' ⚠ ERROR_DEST' : '';
        const redirectArrow = locPath ? ` → ${locPath}` : '';

        return `${i + 1}. ${e.request.method} ${path} → ${e.response.status} ${e.time.toFixed(0)}ms ${connType} ${dns}${connect}${ssl}wait=${wait}ms${redirectArrow}${errorFlag}`;
      });
    redirectChainSection = `REDIRECT CHAIN (sequential user-perceived ${sessionMs.toFixed(0)}ms):\n${chainLines.join('\n')}`;
  }

  // ── Per-request detail for top slow ───────────────────────────────────────
  // Now includes full timing breakdown so AI can distinguish connection overhead
  // from server processing time (TTFB), and network transfer time.
  const topSlow = [...entries]
    .sort((a, b) => b.time - a.time)
    .slice(0, 20)
    .map((e) => {
      let path = e.request.url;
      try {
        const u = new URL(e.request.url);
        path = u.hostname + u.pathname;
      } catch { /* keep raw url */ }

      const t = e.timings ?? {};
      const dns     = (t.dns     ?? -1) >= 0 ? ` dns=${(t.dns     ?? 0).toFixed(0)}ms` : '';
      const connect = (t.connect ?? -1) >= 0 ? ` connect=${(t.connect ?? 0).toFixed(0)}ms` : '';
      const ssl     = (t.ssl     ?? -1) >= 0 ? ` ssl=${(t.ssl     ?? 0).toFixed(0)}ms` : '';
      const wait    = ` wait=${(t.wait ?? 0).toFixed(0)}ms`;
      const recv    = (t.receive ?? -1) >= 0 ? ` recv=${(t.receive ?? 0).toFixed(0)}ms` : '';
      const waitRatio = e.time > 0 ? ` wait_ratio=${((t.wait ?? 0) / e.time * 100).toFixed(0)}%` : '';
      const mime    = e.response.content?.mimeType ? ` mime:${e.response.content.mimeType.split(';')[0]}` : '';
      const isNewConn = (t.dns ?? -1) >= 0 && (t.connect ?? -1) >= 0;
      const connType = isNewConn ? ' [NEW-CONN]' : '';

      return `${e.request.method} ${path} status:${e.response.status} totalms:${e.time.toFixed(0)}${dns}${connect}${ssl}${wait}${recv}${waitRatio}${mime}${connType}`;
    });

  // ── 5xx Server Errors (highest priority — must be analysed first) ──────────
  const serverErrorLines = serverErrors.slice(0, 10).map((e) => {
    let path = e.request.url;
    try { const u = new URL(e.request.url); path = u.hostname + u.pathname; } catch { /* keep raw */ }
    const t = e.timings ?? {};
    const wait = ` wait=${(t.wait ?? 0).toFixed(0)}ms`;
    const isNewConn = (t.dns ?? -1) >= 0 && (t.connect ?? -1) >= 0;
    const connType = isNewConn ? ' [NEW-CONN]' : '';
    return `${e.request.method} ${path} status:${e.response.status} totalms:${e.time.toFixed(0)}ms${wait}${connType}`;
  });

  // ── 4xx Client Errors (second priority) ────────────────────────────────────
  const clientErrorLines = clientErrors.slice(0, 10).map((e) => {
    let path = e.request.url;
    try { const u = new URL(e.request.url); path = u.hostname + u.pathname; } catch { /* keep raw */ }
    return `${e.request.method} ${path} status:${e.response.status} totalms:${e.time.toFixed(0)}ms`;
  });

  // ── Error Clusters: same endpoint failing repeatedly ────────────────────────
  const errorClusterMap = new Map<string, { count: number; statuses: number[] }>();
  for (const e of errors) {
    let path = e.request.url;
    try { const u = new URL(e.request.url); path = u.hostname + u.pathname; } catch { /* keep raw */ }
    const key = `${e.request.method} ${path}`;
    const existing = errorClusterMap.get(key);
    if (existing) { existing.count++; existing.statuses.push(e.response.status); }
    else { errorClusterMap.set(key, { count: 1, statuses: [e.response.status] }); }
  }
  const errorClusterLines = Array.from(errorClusterMap.entries())
    .filter(([, v]) => v.count > 1)
    .sort(([, a], [, b]) => {
      // Sort by highest status tier first, then by frequency
      const aMax = Math.max(...a.statuses);
      const bMax = Math.max(...b.statuses);
      if (bMax !== aMax) return bMax - aMax;
      return b.count - a.count;
    })
    .slice(0, 6)
    .map(([path, v]) => {
      const has5xx = v.statuses.some((s) => s >= 500);
      const statusSummary = [...new Set(v.statuses)].sort().join(',');
      return `${path} → x${v.count} failures [${statusSummary}]${has5xx ? ' ⚠ 5XX' : ''}`;
    });

  // ── Assemble context: error tiers first, then performance ─────────────────
  const triageCaseFile = buildHarTriageCaseFile(harData);
  const parts = [
    ...(triageCaseFile ? [triageCaseFile] : []),
    `HAR SUMMARY: ${summary}`,
    ...(redirectChainSection ? [redirectChainSection] : []),
    // 5xx is highest priority — placed before slow-request analysis
    ...(serverErrorLines.length
      ? [`5XX SERVER ERRORS (${serverErrors.length} total — analyse first, highest severity):\n${serverErrorLines.join('\n')}`]
      : []),
    // 4xx second
    ...(clientErrorLines.length
      ? [`4XX CLIENT ERRORS (${clientErrors.length} total):\n${clientErrorLines.join('\n')}`]
      : []),
    // Repeated failures on same endpoint
    ...(errorClusterLines.length
      ? [`ERROR CLUSTERS (same endpoint failing repeatedly — look for cascades):\n${errorClusterLines.join('\n')}`]
      : []),
    // Performance slow-path last (2xx timing analysis)
    `TOP SLOW:\n${topSlow.join('\n')}`,
  ];

  const raw = parts.join('\n\n');
  return raw.length > 12000 ? `${raw.slice(0, 12000)}\n[TRUNCATED]` : raw;
}

export function useInsights(harData: HarFile, backendUrl: string): UseInsightsReturn {
  const harKey = `${harData.log.entries.length}-${harData.log.entries[0]?.startedDateTime ?? ''}`;

  const [insights, setInsights] = useState<InsightsResult | null>(
    () => insightsCache.get(harKey) ?? null
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const harDataRef = useRef(harData);
  const backendUrlRef = useRef(backendUrl);
  const controllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const firedKeyRef = useRef('');

  harDataRef.current = harData;
  backendUrlRef.current = backendUrl;

  const cancel = useCallback(() => {
    controllerRef.current?.abort('user-cancel');
    controllerRef.current = null;
    if (isMountedRef.current) setIsGenerating(false);
  }, []);

  const generate = useCallback(async () => {
    controllerRef.current?.abort('superseded');
    const controller = new AbortController();
    controllerRef.current = controller;

    if (!isMountedRef.current) return;
    setInsights(null);
    setError(null);
    setIsGenerating(true);

    try {
      const context = buildHarContext(harDataRef.current);

      const res = await fetch(`${backendUrlRef.current}/api/ai/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
        signal: controller.signal,
      });

      const data = await res.json();

      if (!isMountedRef.current) return;

      if (!res.ok || data.error) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      if (data.result) {
        insightsCache.set(harKey, data.result);
        setInsights(data.result);
      } else {
        setError('No insights returned from model.');
      }
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') return;
      if (isMountedRef.current) {
        setError(e.message || 'Failed to generate insights');
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        if (isMountedRef.current) setIsGenerating(false);
      }
    }
  }, [harKey]);

  useEffect(() => {
    if (firedKeyRef.current === harKey) return;
    if (insightsCache.has(harKey)) return;
    firedKeyRef.current = harKey;
    void generate();
  }, [harKey, generate]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      controllerRef.current?.abort('unmount');
    };
  }, []);

  return { insights, isGenerating, error, generate, cancel };
}
