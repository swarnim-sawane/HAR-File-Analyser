// src/utils/requestFlowAnalyzer.ts
import { Entry } from '../types/har';

// ─── Resource type colours ───────────────────────────────────────────────────
export const TYPE_COLOR: Record<string, string> = {
  document:   '#3b82f6',
  script:     '#f59e0b',
  xhr:        '#10b981',
  fetch:      '#10b981',
  stylesheet: '#a78bfa',
  image:      '#ec4899',
  font:       '#14b8a6',
  websocket:  '#f97316',
  other:      '#9ca3af',
};

// ─── Interfaces ───────────────────────────────────────────────────────────────
export interface ZoneRequest {
  index:      number;        // original entry index
  url:        string;
  method:     string;
  status:     number;
  type:       string;
  time:       number;        // ms
  startMs:    number;        // ms from page start
  failed:     boolean;
  isSlow:     boolean;
  size:       number;        // bytes
  ttfb:       number;        // ms
  initiator?: string;        // initiator URL if present
}

export interface DomainZone {
  id:         string;
  domain:     string;
  shortLabel: string;
  product:    string | null; // e.g. "Google Analytics", "Cloudflare CDN"
  requests:   ZoneRequest[];
  stats: {
    total:    number;
    failed:   number;
    avgTime:  number;
    maxTime:  number;
    totalBytes: number;
  };
}

export interface ZoneLink {
  fromZoneId: string;
  toZoneId:   string;
  type:       'redirect' | 'cascade';
  statusCode: number;
  count:      number;
  latencyMs:  number;        // avg latency of requests involved
}

export interface FlowData {
  zones:          DomainZone[];
  links:          ZoneLink[];
  p90:            number;
  maxRequestTime: number;
  totalMs:        number;
}

// ─── Known third-party product detection ─────────────────────────────────────
const KNOWN_PRODUCTS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /google-analytics\.com|googletagmanager\.com/i, label: 'Google Analytics' },
  { pattern: /googleapis\.com/i,                             label: 'Google APIs' },
  { pattern: /googlesyndication\.com|doubleclick\.net/i,     label: 'Google Ads' },
  { pattern: /cloudflare\.com|cdnjs\.cloudflare/i,           label: 'Cloudflare CDN' },
  { pattern: /fastly\.net/i,                                 label: 'Fastly CDN' },
  { pattern: /akamai|akamaized/i,                            label: 'Akamai CDN' },
  { pattern: /facebook\.com|fbcdn\.net/i,                    label: 'Facebook' },
  { pattern: /twitter\.com|twimg\.com/i,                     label: 'Twitter/X' },
  { pattern: /stripe\.com/i,                                 label: 'Stripe' },
  { pattern: /segment\.com|segment\.io/i,                    label: 'Segment' },
  { pattern: /intercom\.com|intercomcdn/i,                   label: 'Intercom' },
  { pattern: /hotjar\.com/i,                                 label: 'Hotjar' },
  { pattern: /sentry\.io/i,                                  label: 'Sentry' },
  { pattern: /datadog/i,                                     label: 'Datadog' },
  { pattern: /mixpanel\.com/i,                               label: 'Mixpanel' },
  { pattern: /amplitude\.com/i,                              label: 'Amplitude' },
  { pattern: /amazonaws\.com|s3\./i,                         label: 'AWS' },
  { pattern: /azure\.|windows\.net/i,                        label: 'Azure' },
  { pattern: /jsdelivr\.net/i,                               label: 'jsDelivr CDN' },
  { pattern: /unpkg\.com/i,                                  label: 'unpkg CDN' },
];

function detectProduct(domain: string): string | null {
  for (const { pattern, label } of KNOWN_PRODUCTS) {
    if (pattern.test(domain)) return label;
  }
  return null;
}

// ─── Resource type heuristic ──────────────────────────────────────────────────
function getResourceType(entry: Entry): string {
  const ext = (entry as any);
  if (ext._resourceType) return ext._resourceType as string;

  const mime = entry.response.content.mimeType?.toLowerCase() || '';
  const url  = entry.request.url.toLowerCase();

  if (mime.includes('html'))                             return 'document';
  if (mime.includes('javascript') || url.endsWith('.js')) return 'script';
  if (mime.includes('css') || url.endsWith('.css'))      return 'stylesheet';
  if (mime.includes('image'))                            return 'image';
  if (mime.includes('font') || url.match(/\.(woff2?|ttf|eot|otf)$/)) return 'font';
  if (mime.includes('json') || mime.includes('xml'))     return 'xhr';
  if (url.match(/\.(png|jpe?g|gif|svg|webp|ico)$/))     return 'image';

  return 'other';
}

// ─── Main analyser ────────────────────────────────────────────────────────────
export function analyzeFlow(entries: Entry[]): FlowData {
  if (!entries.length) {
    return { zones: [], links: [], p90: 0, maxRequestTime: 0, totalMs: 0 };
  }

  // Sort by start time
  const sorted = [...entries]
    .map((e, i) => ({ e, i }))
    .sort((a, b) =>
      new Date(a.e.startedDateTime).getTime() -
      new Date(b.e.startedDateTime).getTime()
    );

  const pageStart = new Date(sorted[0].e.startedDateTime).getTime();

  // p90 of timings
  const times = sorted.map(({ e }) => e.time || 0).sort((a, b) => a - b);
  const p90   = times[Math.floor(times.length * 0.9)] || 0;
  const maxRequestTime = times[times.length - 1] || 0;

  // Total page duration
  const lastEntry = sorted[sorted.length - 1];
  const lastStart = new Date(lastEntry.e.startedDateTime).getTime() - pageStart;
  const totalMs   = lastStart + (lastEntry.e.time || 0);

  // Group entries into domain zones (preserving first-seen order)
  const zoneOrder:   string[]                     = [];
  const zoneMap:     Map<string, ZoneRequest[]>   = new Map();

  for (const { e, i } of sorted) {
    let domain = 'unknown';
    try { domain = new URL(e.request.url).hostname; } catch { /* ignore */ }

    if (!zoneMap.has(domain)) {
      zoneMap.set(domain, []);
      zoneOrder.push(domain);
    }

    const timings = e.timings || {};
    const ttfb = (timings.blocked || 0) + (timings.dns || 0) +
                 (timings.connect || 0) + (timings.ssl || 0) +
                 (timings.send || 0) + (timings.wait || 0);

    const req: ZoneRequest = {
      index:     i,
      url:       e.request.url,
      method:    e.request.method,
      status:    e.response.status,
      type:      getResourceType(e),
      time:      e.time || 0,
      startMs:   new Date(e.startedDateTime).getTime() - pageStart,
      failed:    e.response.status >= 400,
      isSlow:    (e.time || 0) >= p90,
      size:      e.response.content.size || e.response.bodySize || 0,
      ttfb:      Math.max(0, ttfb),
      initiator: (e as any)._initiator?.url,
    };

    zoneMap.get(domain)!.push(req);
  }

  // Build DomainZone objects
  const zones: DomainZone[] = zoneOrder.map((domain, idx) => {
    const reqs = zoneMap.get(domain)!;
    const failed = reqs.filter(r => r.failed).length;
    const avgTime = reqs.reduce((s, r) => s + r.time, 0) / reqs.length;
    const maxTime = Math.max(...reqs.map(r => r.time));
    const totalBytes = reqs.reduce((s, r) => s + r.size, 0);

    // Short label: extract a meaningful identifier from the subdomain
    // e.g. "idcs-3a86147ab7a44b9198.identity.oraclecloud.com" → "idcs.oraclecloud.com"
    // e.g. "login-nof-dev5.saas.oraclecloud.com" → "login-nof.oraclecloud.com"
    const parts = domain.split('.');
    let shortLabel: string;
    if (parts.length <= 2) {
      shortLabel = domain;
    } else {
      const baseDomain = parts.slice(-2).join('.');
      const firstSub = parts[0];
      // Strip hash-like suffixes (8+ hex chars preceded by dash) → "idcs-3a86..." → "idcs"
      const stripped = firstSub.replace(/-[0-9a-f]{8}[0-9a-f]*/gi, '').replace(/-+$/, '');
      // Keep only first two hyphen-segments for readability → "login-nof-dev5-x" → "login-nof"
      const hyphenParts = (stripped || firstSub).split('-');
      const prefix = hyphenParts.slice(0, 2).join('-');
      shortLabel = `${prefix}.${baseDomain}`;
    }

    return {
      id:         `zone-${idx}`,
      domain,
      shortLabel,
      product:    detectProduct(domain),
      requests:   reqs,
      stats: { total: reqs.length, failed, avgTime, maxTime, totalBytes },
    };
  });

  // Build cross-domain links
  const zoneIdByDomain = new Map(zones.map(z => [z.domain, z.id]));

  // Collect candidate links from initiator chains + redirect chains
  const linkMap: Map<string, ZoneLink> = new Map();

  for (const { e } of sorted) {
    const initiatorUrl: string | undefined = (e as any)._initiator?.url;
    if (!initiatorUrl) continue;

    let fromDomain = '';
    let toDomain   = '';
    try {
      fromDomain = new URL(initiatorUrl).hostname;
      toDomain   = new URL(e.request.url).hostname;
    } catch { continue; }

    if (fromDomain === toDomain) continue;

    const fromId = zoneIdByDomain.get(fromDomain);
    const toId   = zoneIdByDomain.get(toDomain);
    if (!fromId || !toId) continue;

    const key = `${fromId}→${toId}`;
    if (linkMap.has(key)) {
      const l = linkMap.get(key)!;
      l.count++;
      l.latencyMs = (l.latencyMs * (l.count - 1) + (e.time || 0)) / l.count;
    } else {
      linkMap.set(key, {
        fromZoneId: fromId,
        toZoneId:   toId,
        type:       e.response.status >= 300 && e.response.status < 400
                      ? 'redirect' : 'cascade',
        statusCode: e.response.status,
        count:      1,
        latencyMs:  e.time || 0,
      });
    }
  }

  // Also connect adjacent zones that have no initiator data (sequential cascade)
  if (linkMap.size === 0 && zones.length > 1) {
    for (let i = 0; i < zones.length - 1; i++) {
      const fromZ = zones[i];
      const toZ   = zones[i + 1];
      const key   = `${fromZ.id}→${toZ.id}`;
      if (!linkMap.has(key)) {
        const avgLat = (fromZ.stats.avgTime + toZ.stats.avgTime) / 2;
        linkMap.set(key, {
          fromZoneId: fromZ.id,
          toZoneId:   toZ.id,
          type:       'cascade',
          statusCode: 200,
          count:      1,
          latencyMs:  avgLat,
        });
      }
    }
  }

  return {
    zones,
    links: Array.from(linkMap.values()),
    p90,
    maxRequestTime,
    totalMs,
  };
}
