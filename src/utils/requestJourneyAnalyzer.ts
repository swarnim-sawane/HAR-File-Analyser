import type { Entry } from '../types/har';
import { analyzeFlow, type ZoneRequest } from './requestFlowAnalyzer';

export type JourneyPhaseKind =
  | 'initial'
  | 'auth'
  | 'callback'
  | 'app-boot'
  | 'static'
  | 'consent'
  | 'logout'
  | 'persistent'
  | 'background';

export type JourneyIssueLevel = 'danger' | 'warning' | 'info';
export type JourneyConfidence = 'high' | 'medium' | 'low';

export interface JourneyIssue {
  id: string;
  level: JourneyIssueLevel;
  title: string;
  description: string;
  requestIndex?: number;
}

export interface JourneyRequest {
  index: number;
  url: string;
  method: string;
  status: number;
  type: string;
  time: number;
  startMs: number;
  endMs: number;
  failed: boolean;
  actionableFailure: boolean;
  noise: boolean;
  isSlow: boolean;
  isPersistent: boolean;
  status0Warning: boolean;
  size: number;
  ttfb: number;
  domain: string;
  domainLabel: string;
  productLabel?: string;
  initiator?: string;
  redirectTarget?: string;
  issueLevel?: JourneyIssueLevel;
}

export interface JourneyPhaseStats {
  requestCount: number;
  redirectCount: number;
  errorCount: number;
  status0Count: number;
  slowCount: number;
  bytes: number;
}

export interface JourneyPhase {
  id: string;
  kind: JourneyPhaseKind;
  title: string;
  summary: string;
  confidence: JourneyConfidence;
  startMs: number;
  endMs: number;
  durationMs: number;
  domains: string[];
  requests: JourneyRequest[];
  keyRequests: JourneyRequest[];
  issues: JourneyIssue[];
  stats: JourneyPhaseStats;
}

export interface JourneyData {
  phases: JourneyPhase[];
  totalMs: number;
  domainCount: number;
  requestCount: number;
  errorCount: number;
  slowCount: number;
  status0Count: number;
  bytes: number;
}

type ParsedRequest = {
  parsedUrl: URL | null;
  host: string;
  path: string;
  target: string;
};

const PHASE_TITLE: Record<JourneyPhaseKind, string> = {
  initial: 'Initial app request',
  auth: 'Identity / authentication',
  callback: 'OAuth callback',
  'app-boot': 'App boot',
  static: 'Static dependencies',
  consent: 'Consent / background',
  logout: 'Logout / session end',
  persistent: 'Persistent connection',
  background: 'Background activity',
};

const PHASE_ORDER: JourneyPhaseKind[] = [
  'initial',
  'auth',
  'callback',
  'app-boot',
  'static',
  'consent',
  'persistent',
  'logout',
  'background',
];

const AUTH_PATTERN =
  /(?:\bidcs\b|identity\.oraclecloud\.com|login\.oci\.oraclecloud\.com|\/oauth2\/|\/authorize\b|\/signin\b|\/sso\/|storelogininfo|cloudgate\/v1\/oauth2)/i;
const CALLBACK_PATTERN = /(?:oauth2\/callback|\/callback\b|cloudgate\/v1\/oauth2\/callback)/i;
const LOGOUT_PATTERN = /(?:logout|signout|user\/logout|cloudgate\/logout|oauth2\/logout)/i;
const CONSENT_PATTERN = /(?:consent\.truste\.com|\btruste\b|\/notice\b|cookieconsent)/i;
const STATIC_PATH_PATTERN = /(?:\/cdn\/|\/static\/|\/assets\/|\/resources\/|\.js(?:\?|$)|\.css(?:\?|$)|\.woff2?(?:\?|$)|\.png(?:\?|$)|\.svg(?:\?|$)|\.ico(?:\?|$))/i;
const STATIC_TYPES = new Set(['script', 'stylesheet', 'font', 'image']);
const LARGE_STATIC_BURST_BYTES = 5 * 1024 * 1024;

function parseRequestUrl(url: string): ParsedRequest {
  try {
    const parsedUrl = new URL(url);
    const path = `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`;
    return {
      parsedUrl,
      host: parsedUrl.hostname,
      path,
      target: `${parsedUrl.hostname}${path}`,
    };
  } catch {
    return {
      parsedUrl: null,
      host: 'unknown',
      path: url,
      target: url,
    };
  }
}

function resolveAgainst(baseUrl: string, targetUrl: string): string {
  if (!targetUrl) return '';

  try {
    return new URL(targetUrl, baseUrl).toString();
  } catch {
    return targetUrl;
  }
}

function getRedirectTarget(entry: Entry): string {
  const locationHeader = entry.response.headers.find(
    (header) => header.name.toLowerCase() === 'location'
  )?.value;
  const rawTarget = entry.response.redirectURL || locationHeader || '';

  return rawTarget ? resolveAgainst(entry.request.url, rawTarget) : '';
}

function isRedirect(status: number, redirectTarget?: string): boolean {
  return (status >= 300 && status < 400) || Boolean(redirectTarget);
}

function getRawResourceType(entry: Entry): string {
  return ((entry as Entry & { _resourceType?: string })._resourceType || '').trim().toLowerCase();
}

function getInitiatorUrl(entry: Entry): string | undefined {
  return (entry as Entry & { _initiator?: { url?: string } })._initiator?.url;
}

function isPersistentRequest(entry: Entry, request: ZoneRequest, parsed: ParsedRequest): boolean {
  const rawType = getRawResourceType(entry);
  const target = parsed.target.toLowerCase();

  return (
    request.status === 101 ||
    rawType === 'websocket' ||
    target.includes('/event') ||
    (request.time > 30_000 && /(?:event|socket|stream|sse)/i.test(target))
  );
}

function isFaviconAuthNoise(request: ZoneRequest, parsed: ParsedRequest): boolean {
  return (
    request.status >= 400 &&
    parsed.path.toLowerCase().includes('favicon.ico') &&
    AUTH_PATTERN.test(parsed.target)
  );
}

function isStaticDependency(entry: Entry, request: ZoneRequest, parsed: ParsedRequest): boolean {
  const rawType = getRawResourceType(entry);
  const requestType = rawType === 'fetch' ? 'xhr' : rawType || request.type;
  const target = parsed.target.toLowerCase();

  return (
    parsed.host === 'static.oracle.com' ||
    /(?:cdn|static)\.oracle\.com/i.test(parsed.host) ||
    (STATIC_TYPES.has(requestType) && STATIC_PATH_PATTERN.test(target) && !AUTH_PATTERN.test(target))
  );
}

function classifyPhase(
  entry: Entry,
  request: ZoneRequest,
  parsed: ParsedRequest,
  firstAppHost: string,
  firstAuthStartMs: number | null
): JourneyPhaseKind {
  const target = parsed.target;

  if (isPersistentRequest(entry, request, parsed)) return 'persistent';
  if (LOGOUT_PATTERN.test(target)) return 'logout';
  if (CALLBACK_PATTERN.test(target)) return 'callback';
  if (CONSENT_PATTERN.test(target)) return 'consent';

  const redirectTarget = getRedirectTarget(entry);
  const redirectTargetText = redirectTarget ? parseRequestUrl(redirectTarget).target : '';
  const isInitialAppRequest =
    parsed.host === firstAppHost &&
    (request.startMs === 0 || request.type === 'document') &&
    request.startMs <= (firstAuthStartMs ?? Number.POSITIVE_INFINITY) &&
    (request.startMs < 1200 || AUTH_PATTERN.test(redirectTargetText));

  if (isInitialAppRequest) return 'initial';
  if (AUTH_PATTERN.test(target)) return 'auth';
  if (isStaticDependency(entry, request, parsed)) return 'static';
  if (parsed.host === firstAppHost) return 'app-boot';

  return 'background';
}

function summarizePhase(kind: JourneyPhaseKind, stats: JourneyPhaseStats, domains: string[]): string {
  switch (kind) {
    case 'initial':
      return stats.redirectCount > 0
        ? 'The browser opened the app and immediately followed a navigation handoff.'
        : 'The browser opened the app and established the first page request.';
    case 'auth':
      return 'The browser moved through identity and login endpoints as one authentication step.';
    case 'callback':
      return 'The OAuth callback returned control from identity back to the application.';
    case 'app-boot':
      return 'The app shell resumed and booted the client-side runtime.';
    case 'static':
      return `The client loaded shared static dependencies from ${domains.length} domain${domains.length === 1 ? '' : 's'}.`;
    case 'consent':
      return 'Consent, login asset, or other background browser activity ran outside the main app path.';
    case 'logout':
      return 'The session moved through logout endpoints and identity cleanup.';
    case 'persistent':
      return 'A long-lived event or websocket-style request stayed open after the app booted.';
    case 'background':
      return 'Additional requests ran outside the primary navigation chain.';
    default:
      return 'Requests were grouped by timing and URL behavior.';
  }
}

function getConfidence(kind: JourneyPhaseKind): JourneyConfidence {
  if (kind === 'background') return 'low';
  if (kind === 'static' || kind === 'consent') return 'medium';
  return 'high';
}

function buildPhaseIssues(kind: JourneyPhaseKind, requests: JourneyRequest[], stats: JourneyPhaseStats): JourneyIssue[] {
  const issues: JourneyIssue[] = [];
  const issueId = (suffix: string) => `${kind}-${suffix}`;
  const logout404 = requests.find((request) => request.status === 404 && LOGOUT_PATTERN.test(request.url));

  if (logout404) {
    issues.push({
      id: issueId('logout-404'),
      level: 'danger',
      title: 'Logout endpoint returned 404',
      description: 'The logout flow reached an application endpoint that was not found.',
      requestIndex: logout404.index,
    });
  }

  const actionableFailures = requests.filter((request) => request.actionableFailure && request.index !== logout404?.index);
  if (actionableFailures.length > 0) {
    const firstFailure = actionableFailures[0];
    issues.push({
      id: issueId('http-failures'),
      level: 'danger',
      title: `${actionableFailures.length} server/client failure${actionableFailures.length === 1 ? '' : 's'}`,
      description: 'At least one request returned an actionable 4xx or 5xx response.',
      requestIndex: firstFailure.index,
    });
  }

  if (kind === 'static' && (stats.requestCount >= 2 || stats.bytes >= LARGE_STATIC_BURST_BYTES)) {
    issues.push({
      id: issueId('static-burst'),
      level: stats.bytes >= LARGE_STATIC_BURST_BYTES ? 'warning' : 'info',
      title: 'Static dependency burst',
      description: 'The app downloaded a concentrated set of scripts, styles, images, or fonts.',
      requestIndex: requests[0]?.index,
    });
  }

  if (stats.status0Count > 0) {
    issues.push({
      id: issueId('status-0'),
      level: 'warning',
      title: 'Cancelled or blocked background requests',
      description: 'Status 0 usually means the browser cancelled, blocked, or did not receive a normal server response.',
      requestIndex: requests.find((request) => request.status === 0)?.index,
    });
  }

  if (kind === 'initial' && stats.redirectCount > 0) {
    issues.push({
      id: issueId('initial-redirect'),
      level: 'info',
      title: 'App redirected to identity provider',
      description: 'The first app request handed the browser to an identity or login domain.',
      requestIndex: requests.find((request) => isRedirect(request.status, request.redirectTarget))?.index,
    });
  }

  if (kind === 'auth' && stats.redirectCount > 0) {
    issues.push({
      id: issueId('auth-redirects'),
      level: 'info',
      title: 'Authentication redirect chain',
      description: 'Identity and login endpoints participated in the same sign-in sequence.',
      requestIndex: requests.find((request) => isRedirect(request.status, request.redirectTarget))?.index,
    });
  }

  if (kind === 'callback') {
    issues.push({
      id: issueId('callback-return'),
      level: 'info',
      title: 'OAuth callback returned to app',
      description: 'The browser completed the identity callback and returned to the application domain.',
      requestIndex: requests[0]?.index,
    });
  }

  if (kind === 'persistent') {
    issues.push({
      id: issueId('long-lived'),
      level: 'info',
      title: 'Long-lived event connection kept open',
      description: 'This request is expected to stay open and is not treated as a normal slow request.',
      requestIndex: requests[0]?.index,
    });
  }

  if (stats.slowCount > 0) {
    const firstSlow = requests.find((request) => request.isSlow);
    issues.push({
      id: issueId('slow'),
      level: 'warning',
      title: `${stats.slowCount} delayed request${stats.slowCount === 1 ? '' : 's'}`,
      description: 'One or more requests took long enough to affect the visible journey.',
      requestIndex: firstSlow?.index,
    });
  }

  return issues;
}

function buildKeyRequests(requests: JourneyRequest[]): JourneyRequest[] {
  const keyByIndex = new Map<number, JourneyRequest>();

  requests
    .filter(
      (request) =>
        request.actionableFailure ||
        request.status0Warning ||
        request.isSlow ||
        request.isPersistent ||
        isRedirect(request.status, request.redirectTarget)
    )
    .forEach((request) => keyByIndex.set(request.index, request));

  requests.slice(0, 3).forEach((request) => keyByIndex.set(request.index, request));

  return Array.from(keyByIndex.values())
    .sort((left, right) => left.startMs - right.startMs)
    .slice(0, 6);
}

function buildPhase(kind: JourneyPhaseKind, requests: JourneyRequest[], phaseIndex: number): JourneyPhase {
  const startMs = Math.min(...requests.map((request) => request.startMs));
  const endMs = Math.max(...requests.map((request) => request.endMs));
  const domains = Array.from(new Set(requests.map((request) => request.domain))).filter(Boolean);
  const stats: JourneyPhaseStats = {
    requestCount: requests.length,
    redirectCount: requests.filter((request) => isRedirect(request.status, request.redirectTarget)).length,
    errorCount: requests.filter((request) => request.actionableFailure).length,
    status0Count: requests.filter((request) => request.status === 0).length,
    slowCount: requests.filter((request) => request.isSlow).length,
    bytes: requests.reduce((total, request) => total + request.size, 0),
  };

  return {
    id: `journey-phase-${phaseIndex}-${kind}`,
    kind,
    title: PHASE_TITLE[kind],
    summary: summarizePhase(kind, stats, domains),
    confidence: getConfidence(kind),
    startMs,
    endMs,
    durationMs: Math.max(0, endMs - startMs),
    domains,
    requests,
    keyRequests: buildKeyRequests(requests),
    issues: buildPhaseIssues(kind, requests, stats),
    stats,
  };
}

export function analyzeJourney(entries: Entry[]): JourneyData {
  if (entries.length === 0) {
    return {
      phases: [],
      totalMs: 0,
      domainCount: 0,
      requestCount: 0,
      errorCount: 0,
      slowCount: 0,
      status0Count: 0,
      bytes: 0,
    };
  }

  const flowData = analyzeFlow(entries);
  const requestByIndex = new Map<number, ZoneRequest>();
  const domainMetaByIndex = new Map<number, { domain: string; domainLabel: string; productLabel?: string }>();

  flowData.zones.forEach((zone) => {
    zone.requests.forEach((request) => {
      requestByIndex.set(request.index, request);
      domainMetaByIndex.set(request.index, {
        domain: zone.domain,
        domainLabel: zone.shortLabel || zone.domain,
        productLabel: zone.product || undefined,
      });
    });
  });

  const sortedEntries = entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        new Date(left.entry.startedDateTime).getTime() -
        new Date(right.entry.startedDateTime).getTime()
    );
  const pageStart = new Date(sortedEntries[0].entry.startedDateTime).getTime();
  const firstAppHost = parseRequestUrl(sortedEntries[0].entry.request.url).host;
  const firstAuthStartMs =
    sortedEntries
      .map(({ entry }) => {
        const parsed = parseRequestUrl(entry.request.url);
        return AUTH_PATTERN.test(parsed.target)
          ? new Date(entry.startedDateTime).getTime() - pageStart
          : null;
      })
      .find((startMs): startMs is number => startMs !== null) ?? null;
  const slowThreshold = Math.max(1000, Math.min(flowData.p90 || 1000, 5000));
  const requestsByPhase = new Map<JourneyPhaseKind, JourneyRequest[]>();

  sortedEntries.forEach(({ entry, index }) => {
    const fallbackStartMs = new Date(entry.startedDateTime).getTime() - pageStart;
    const flowRequest = requestByIndex.get(index) ?? {
      index,
      url: entry.request.url,
      method: entry.request.method,
      status: entry.response.status,
      type: 'other',
      time: entry.time || 0,
      startMs: fallbackStartMs,
      failed: entry.response.status >= 400,
      isSlow: (entry.time || 0) > 1000,
      size: entry.response.content.size || entry.response.bodySize || 0,
      ttfb: Math.max(0, entry.timings.wait || 0),
      initiator: getInitiatorUrl(entry),
    };
    const parsed = parseRequestUrl(flowRequest.url);
    const redirectTarget = getRedirectTarget(entry);
    const persistent = isPersistentRequest(entry, flowRequest, parsed);
    const noise = isFaviconAuthNoise(flowRequest, parsed);
    const actionableFailure = flowRequest.status >= 400 && !noise && !persistent;
    const status0Warning = flowRequest.status === 0;
    const isSlow = !persistent && (flowRequest.time || 0) >= slowThreshold;
    const phaseKind = classifyPhase(entry, flowRequest, parsed, firstAppHost, firstAuthStartMs);
    const meta = domainMetaByIndex.get(index);
    const journeyRequest: JourneyRequest = {
      index,
      url: flowRequest.url,
      method: flowRequest.method,
      status: flowRequest.status,
      type: flowRequest.type,
      time: flowRequest.time,
      startMs: flowRequest.startMs,
      endMs: flowRequest.startMs + flowRequest.time,
      failed: actionableFailure,
      actionableFailure,
      noise,
      isSlow,
      isPersistent: persistent,
      status0Warning,
      size: flowRequest.size,
      ttfb: flowRequest.ttfb,
      domain: meta?.domain || parsed.host,
      domainLabel: meta?.domainLabel || parsed.host,
      productLabel: meta?.productLabel,
      initiator: flowRequest.initiator || getInitiatorUrl(entry),
      redirectTarget,
      issueLevel: actionableFailure
        ? 'danger'
        : status0Warning || isSlow
          ? 'warning'
          : persistent
            ? 'info'
            : undefined,
    };

    const phaseRequests = requestsByPhase.get(phaseKind) ?? [];
    phaseRequests.push(journeyRequest);
    requestsByPhase.set(phaseKind, phaseRequests);
  });

  const phases = Array.from(requestsByPhase.entries())
    .map(([kind, requests], phaseIndex) => buildPhase(kind, requests, phaseIndex))
    .sort((left, right) => {
      if (left.startMs !== right.startMs) return left.startMs - right.startMs;
      return PHASE_ORDER.indexOf(left.kind) - PHASE_ORDER.indexOf(right.kind);
    });

  const allRequests = phases.flatMap((phase) => phase.requests);

  return {
    phases,
    totalMs: flowData.totalMs,
    domainCount: flowData.zones.length,
    requestCount: entries.length,
    errorCount: allRequests.filter((request) => request.actionableFailure).length,
    slowCount: allRequests.filter((request) => request.isSlow).length,
    status0Count: allRequests.filter((request) => request.status === 0).length,
    bytes: allRequests.reduce((total, request) => total + request.size, 0),
  };
}
