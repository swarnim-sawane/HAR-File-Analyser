// src/hooks/useInsights.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { HarFile } from '../types/har';

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
        let locPath = '';
        try { locPath = new URL(loc).pathname; } catch { locPath = loc; }

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
  const parts = [
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
