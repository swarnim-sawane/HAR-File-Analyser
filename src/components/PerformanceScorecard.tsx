// src/components/PerformanceScorecard.tsx
import React, { useMemo, useState } from 'react';
import { HarFile } from '../types/har';

interface ScorecardProps {
  harData: HarFile;
}

interface Check {
  id: string;
  label: string;
  what: string;          // one-liner explaining what this check measures
  status: 'good' | 'warn' | 'bad';
  detail: string;
  fix?: string;
  impact: 'high' | 'medium' | 'low';
  pts: number;           // point weight shown in the UI
}

const StatusIcon: React.FC<{ status: 'good' | 'warn' | 'bad' }> = ({ status }) => {
  if (status === 'good') return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" fill="rgba(34,197,94,0.12)" />
      <path d="M5 8.5l2 1.5 4-4" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (status === 'warn') return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2.5L14 13.5H2L8 2.5Z" fill="rgba(245,158,11,0.12)" stroke="#f59e0b" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.5v3" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.8" fill="#f59e0b" />
    </svg>
  );
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" fill="rgba(239,68,68,0.1)" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
};

const PerformanceScorecard: React.FC<ScorecardProps> = ({ harData }) => {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { score, checks, totalPts } = useMemo(() => {
    const entries = harData.log.entries;
    const total = entries.length;
    const checks: Check[] = [];

    // ── 1. Failed Requests ────────────────────────────────────────────────────
    // Threshold is percentage-based so it scales with file size.
    const errors = entries.filter(e => e.response.status >= 400);
    const errorPct = total > 0 ? errors.length / total : 0;
    const clientErrors = errors.filter(e => e.response.status < 500);
    const serverErrors = errors.filter(e => e.response.status >= 500);
    checks.push({
      id: 'errors',
      label: 'Failed Requests',
      what: 'HTTP 4xx/5xx responses that indicate broken or erroring endpoints',
      impact: 'high',
      pts: 20,
      status: errorPct === 0 ? 'good' : errorPct < 0.05 ? 'warn' : 'bad',
      detail: errors.length === 0
        ? `All ${total} requests completed successfully (no 4xx or 5xx responses).`
        : `${errors.length} of ${total} requests failed (${(errorPct * 100).toFixed(1)}%). `
          + (serverErrors.length > 0 ? `${serverErrors.length} server error${serverErrors.length > 1 ? 's' : ''} (5xx) — these are bugs on the server side. ` : '')
          + (clientErrors.length > 0 ? `${clientErrors.length} client error${clientErrors.length > 1 ? 's' : ''} (4xx) — bad URLs, auth issues, or missing resources. ` : '')
          + `Examples: ${errors.slice(0, 3).map(e => {
              try { return `${e.response.status} ${new URL(e.request.url).pathname}`; } catch { return `${e.response.status} ${e.request.url}`; }
            }).join(', ')}${errors.length > 3 ? `… +${errors.length - 3} more` : ''}`,
      fix: serverErrors.length > 0
        ? 'Server errors (5xx) are bugs — check your server logs for stack traces on the failing endpoints.'
        : 'Client errors (4xx) often mean bad request URLs, expired auth tokens, or missing resources. Verify each failing endpoint is reachable and authenticated.',
    });

    // ── 2. Slow Requests ──────────────────────────────────────────────────────
    // Threshold is relative (% of total) so a large HAR isn't unfairly penalised
    // for having a few slow calls among hundreds of fast ones.
    const sorted = [...entries].sort((a, b) => b.time - a.time);
    const slowRequests = entries.filter(e => e.time > 1000);
    const slowPct = total > 0 ? slowRequests.length / total : 0;
    const slowestEntry = sorted[0];
    let slowestPath = '';
    try { slowestPath = new URL(slowestEntry?.request.url).pathname; } catch { slowestPath = slowestEntry?.request.url ?? ''; }
    checks.push({
      id: 'slow',
      label: 'Slow Requests',
      what: 'Requests that took over 1 second end-to-end (includes server wait + transfer)',
      impact: 'high',
      pts: 20,
      // bad if >10% of requests are slow, warn if 1–10%
      status: slowPct === 0 ? 'good' : slowPct < 0.10 ? 'warn' : 'bad',
      detail: slowRequests.length === 0
        ? `All ${total} requests completed in under 1 second. Fastest experience for users.`
        : `${slowRequests.length} of ${total} requests (${(slowPct * 100).toFixed(1)}%) took over 1s. `
          + `Slowest: ${slowestEntry?.time.toFixed(0)}ms on ${slowestPath}. `
          + `Anything over 1s is noticeable to users; over 3s leads to drop-off.`,
      fix: `Check the TTFB (server wait time) on the slowest requests — if TTFB is high, the bottleneck is server-side (slow DB query, missing cache, or expensive computation). If TTFB is fast but total time is slow, it's a large payload — consider pagination or compression.`,
    });

    // ── 3. Response Compression ───────────────────────────────────────────────
    // Only checks text/JSON/JS responses >1 KB. Threshold is relative to the
    // number of compressible responses, not the total request count.
    const compressible = entries.filter(e => {
      const mime = e.response.content.mimeType ?? '';
      const size = e.response.bodySize;
      return size > 1024 && (mime.includes('text') || mime.includes('json') || mime.includes('javascript'));
    });
    const uncompressed = compressible.filter(e => {
      const encoding = e.response.headers.find(h => h.name.toLowerCase() === 'content-encoding');
      return !encoding;
    });
    const uncompPct = compressible.length > 0 ? uncompressed.length / compressible.length : 0;
    checks.push({
      id: 'compression',
      label: 'Response Compression',
      what: 'Whether text, JSON, and JS responses use gzip or brotli to reduce transfer size',
      impact: 'medium',
      pts: 10,
      // bad if >20% of compressible responses are uncompressed, warn if 5–20%
      status: compressible.length === 0 || uncompPct === 0
        ? 'good'
        : uncompPct < 0.20 ? 'warn' : 'bad',
      detail: compressible.length === 0
        ? 'No large text or JSON responses detected in this HAR file.'
        : uncompressed.length === 0
          ? `All ${compressible.length} text/JSON responses are compressed (gzip or brotli). Payloads are as small as possible.`
          : `${uncompressed.length} of ${compressible.length} compressible responses (${(uncompPct * 100).toFixed(0)}%) are sent without compression. `
            + `Enabling gzip typically reduces text payload size by 60–80%, speeding up page load.`,
      fix: `Enable gzip or brotli compression on your server for text/*, application/json, and application/javascript MIME types. `
        + `In Express: use the "compression" middleware. In nginx: add "gzip on; gzip_types text/plain application/json application/javascript text/css;"`,
    });

    // ── 4. Repeated API Calls ─────────────────────────────────────────────────
    // Duplicate detection uses method+URL as the key. Threshold is relative:
    // bad if duplicate URLs make up >10% of total unique URLs.
    const urlCounts = entries.reduce((acc, e) => {
      const key = `${e.request.method}:${e.request.url}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const dupes = Object.entries(urlCounts).filter(([, c]) => c > 1);
    const uniqueUrls = Object.keys(urlCounts).length;
    const dupePct = uniqueUrls > 0 ? dupes.length / uniqueUrls : 0;
    const extraCalls = dupes.reduce((sum, [, c]) => sum + (c - 1), 0);
    checks.push({
      id: 'duplicates',
      label: 'Repeated API Calls',
      what: 'The same URL+method being called more than once (may indicate missing caching or re-render issues)',
      impact: 'medium',
      pts: 10,
      // bad if >10% of unique URLs are duplicated, warn if any duplicates exist
      status: dupes.length === 0 ? 'good' : dupePct < 0.10 ? 'warn' : 'bad',
      detail: dupes.length === 0
        ? `All ${uniqueUrls} unique URLs are called exactly once — no redundant network requests.`
        : `${dupes.length} URL${dupes.length > 1 ? 's' : ''} (${(dupePct * 100).toFixed(0)}% of ${uniqueUrls} unique) were called more than once, adding ${extraCalls} unnecessary request${extraCalls > 1 ? 's' : ''}. `
          + `Top repeats: ${dupes.slice(0, 2).map(([url, c]) => {
              try { return `${new URL(url.split(':').slice(1).join(':')).pathname} ×${c}`; } catch { return `${url} ×${c}`; }
            }).join(', ')}`,
      fix: `Repeated calls often happen when multiple components independently fetch the same data. `
        + `Consider using a shared data-fetching layer (React Query, SWR, or a simple context/store) to deduplicate requests automatically.`,
    });

    // ── 5. Browser Cache Headers ──────────────────────────────────────────────
    // Checks JS, CSS, and image assets for Cache-Control headers.
    // "no-cache" alone is fine (it still caches with revalidation), but
    // "no-store" means the browser won't cache at all.
    const staticAssets = entries.filter(e => {
      const mime = e.response.content.mimeType ?? '';
      return mime.includes('javascript') || mime.includes('css') || mime.includes('image');
    });
    const uncached = staticAssets.filter(e => {
      const cc = e.response.headers.find(h => h.name.toLowerCase() === 'cache-control');
      return !cc || cc.value.includes('no-store');
    });
    const uncachedPct = staticAssets.length > 0 ? uncached.length / staticAssets.length : 0;
    checks.push({
      id: 'caching',
      label: 'Browser Cache Headers',
      what: 'Whether JS, CSS, and image assets have Cache-Control headers so browsers don\'t re-download them on repeat visits',
      impact: 'medium',
      pts: 10,
      // bad if >50% of statics lack cache headers, warn if 1–50%
      status: staticAssets.length === 0 || uncachedPct === 0
        ? 'good'
        : uncachedPct < 0.50 ? 'warn' : 'bad',
      detail: staticAssets.length === 0
        ? 'No static assets (JS/CSS/images) found in this HAR file.'
        : uncached.length === 0
          ? `All ${staticAssets.length} static assets (JS/CSS/images) have Cache-Control headers — browsers will cache them locally.`
          : `${uncached.length} of ${staticAssets.length} static assets (${(uncachedPct * 100).toFixed(0)}%) have no Cache-Control or are set to no-store. `
            + `Without this, browsers re-download these files on every page load even if nothing has changed.`,
      fix: `For versioned/hashed assets (e.g. main.abc123.js), set: Cache-Control: max-age=31536000, immutable`
        + ` — this caches them for 1 year since the hash changes on every build. `
        + `For your HTML entry point, use: Cache-Control: no-cache, must-revalidate`,
    });

    // ── 6. Third-Party Domains ────────────────────────────────────────────────
    // Instead of hardcoding "internal" domain patterns, we auto-detect the
    // primary domain (most frequent hostname in the file) and treat everything
    // else as third-party. This works correctly for any deployment.
    const allDomains = entries.map(e => {
      try { return new URL(e.request.url).hostname; } catch { return null; }
    }).filter(Boolean) as string[];

    const domainFreq = allDomains.reduce((acc, d) => {
      acc[d] = (acc[d] || 0) + 1; return acc;
    }, {} as Record<string, number>);
    const primaryDomain = Object.entries(domainFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const thirdPartyDomains = [...new Set(allDomains.filter(d =>
      d !== primaryDomain &&
      d !== 'localhost' &&
      !d.startsWith('127.') &&
      !d.startsWith('10.') &&
      !d.startsWith('192.168.')
    ))];

    checks.push({
      id: 'external',
      label: 'Third-Party Domains',
      what: `Requests going to domains other than your primary one (${primaryDomain || 'auto-detected'})`,
      impact: 'low',
      pts: 5,
      // low impact — third-party calls aren't always bad, just worth knowing about
      status: thirdPartyDomains.length === 0 ? 'good' : thirdPartyDomains.length <= 5 ? 'warn' : 'bad',
      detail: thirdPartyDomains.length === 0
        ? `All requests go to your primary domain (${primaryDomain}). No third-party dependencies detected.`
        : `${thirdPartyDomains.length} third-party domain${thirdPartyDomains.length > 1 ? 's' : ''} contacted beyond your primary domain (${primaryDomain}): `
          + `${thirdPartyDomains.slice(0, 5).join(', ')}${thirdPartyDomains.length > 5 ? `… +${thirdPartyDomains.length - 5} more` : ''}. `
          + `Third-party calls are normal (analytics, CDNs, auth providers) but each one adds latency and is an external dependency.`,
      fix: `Review the list above and confirm each domain is expected. Unexpected domains may be: tracking/analytics scripts loaded by a library, `
        + `misconfigured API base URLs, or polyfill/font CDNs that could be self-hosted. `
        + `Use a Content Security Policy (CSP) to enforce which domains are allowed.`,
    });

    // ── 7. API Wait Time (TTFB) ───────────────────────────────────────────────
    // TTFB (timings.wait) isolates server processing time from network transfer.
    // A high TTFB means the server is slow, not the network. Threshold is
    // relative to how many API calls exist in the file.
    const apiCalls = entries.filter(e => (e.response.content.mimeType ?? '').includes('json'));
    const slowApi = apiCalls.filter(e => (e.timings?.wait ?? 0) > 500);
    const slowApiPct = apiCalls.length > 0 ? slowApi.length / apiCalls.length : 0;
    const worstTtfb = slowApi.length > 0 ? Math.max(...slowApi.map(e => e.timings?.wait ?? 0)) : 0;
    let worstApiPath = '';
    if (slowApi.length > 0) {
      const worst = slowApi.reduce((a, b) => (a.timings?.wait ?? 0) > (b.timings?.wait ?? 0) ? a : b);
      try { worstApiPath = new URL(worst.request.url).pathname; } catch { worstApiPath = worst.request.url; }
    }
    checks.push({
      id: 'ttfb',
      label: 'API Wait Time (TTFB)',
      what: 'How long the server takes to start responding to JSON API calls (excludes network transfer time)',
      impact: 'high',
      pts: 20,
      // bad if >20% of API calls have slow TTFB, warn if 1–20%
      status: slowApi.length === 0 ? 'good' : slowApiPct < 0.20 ? 'warn' : 'bad',
      detail: apiCalls.length === 0
        ? 'No JSON API calls detected in this HAR file.'
        : slowApi.length === 0
          ? `All ${apiCalls.length} API call${apiCalls.length > 1 ? 's' : ''} respond within 500ms. Server processing is healthy.`
          : `${slowApi.length} of ${apiCalls.length} API calls (${(slowApiPct * 100).toFixed(0)}%) had a server wait time over 500ms. `
            + `Worst: ${worstTtfb.toFixed(0)}ms on ${worstApiPath}. `
            + `TTFB measures only server processing time — high TTFB means the server itself is slow, not the network.`,
      fix: `High TTFB almost always points to: slow database queries (add indexes, check for N+1 queries), `
        + `missing server-side caching (Redis for repeated reads), or heavy computation in the request path. `
        + `Add timing logs around your DB calls to find the bottleneck.`,
    });

    // ── Calculate Score ────────────────────────────────────────────────────────
    // Score = (points earned / total possible points) × 100
    // Each check is worth its .pts value if good, half if warn, zero if bad.
    const statusScore = { good: 1, warn: 0.5, bad: 0 };
    let totalPts = 0, earned = 0;
    checks.forEach(c => {
      totalPts += c.pts;
      earned += c.pts * statusScore[c.status];
    });

    return { score: Math.round((earned / totalPts) * 100), checks, totalPts };
  }, [harData]);

  const scoreColor = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  const scoreLabel = score >= 80 ? 'Good' : score >= 50 ? 'Fair' : 'Poor';
  const scoreDesc  = score >= 80
    ? 'No major issues found.'
    : score >= 50
    ? 'A few areas need attention.'
    : 'Several issues are affecting performance.';

  const good = checks.filter(c => c.status === 'good').length;
  const warn = checks.filter(c => c.status === 'warn').length;
  const bad  = checks.filter(c => c.status === 'bad').length;

  const domainCount = [...new Set(
    harData.log.entries.map(e => { try { return new URL(e.request.url).hostname; } catch { return ''; } })
  )].filter(Boolean).length;

  return (
    <div className="scorecard">
      <div className="scorecard-header">
        {/* Score ring */}
        <div className="score-circle">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill="none" stroke="var(--border-color)" strokeWidth="7" />
            <circle
              cx="50" cy="50" r="44" fill="none"
              stroke={scoreColor} strokeWidth="7"
              strokeDasharray={`${2 * Math.PI * 44}`}
              strokeDashoffset={`${2 * Math.PI * 44 * (1 - score / 100)}`}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dashoffset 1s ease' }}
            />
          </svg>
          <div className="score-value">
            <span className="score-number" style={{ color: scoreColor }}>{score}</span>
            <span className="score-label" style={{ color: scoreColor }}>{scoreLabel}</span>
          </div>
        </div>

        {/* Summary */}
        <div className="score-summary">
          <h2>Performance Scorecard</h2>
          <p className="score-desc">{scoreDesc}</p>
          <p className="score-meta">
            {harData.log.entries.length} requests · {domainCount} domain{domainCount !== 1 ? 's' : ''}
          </p>
          <p className="score-how">
            Score = points earned across {checks.length} checks ({totalPts} pts total).
            Each check is full points if passed, half if warning, zero if critical.
          </p>
          <div className="score-badges">
            <span className="badge badge-good"><span className="badge-dot" />{good} passed</span>
            {warn > 0 && <span className="badge badge-warn"><span className="badge-dot" />{warn} warning{warn !== 1 ? 's' : ''}</span>}
            {bad  > 0 && <span className="badge badge-bad"><span className="badge-dot" />{bad} critical</span>}
          </div>
        </div>
      </div>

      {/* Checks */}
      <div className="scorecard-checks">
        {checks
          .sort((a, b) => ({ bad: 0, warn: 1, good: 2 }[a.status] - { bad: 0, warn: 1, good: 2 }[b.status]))
          .map(check => (
            <div
              key={check.id}
              className={`check-item check-${check.status}`}
              onClick={() => setExpanded(expanded === check.id ? null : check.id)}
            >
              <div className="check-row">
                <span className="check-icon"><StatusIcon status={check.status} /></span>
                <div className="check-label-group">
                  <span className="check-label">{check.label}</span>
                  <span className="check-what">{check.what}</span>
                </div>
                <span className={`check-impact impact-${check.impact}`}>
                  {check.impact.toUpperCase()} · {check.pts}pts
                </span>
                <svg
                  className={`check-chevron${expanded === check.id ? ' expanded' : ''}`}
                  width="12" height="12" viewBox="0 0 12 12" fill="none"
                >
                  <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {expanded === check.id && (
                <div className="check-detail">
                  <p>{check.detail}</p>
                  {check.fix && check.status !== 'good' && (
                    <div className="check-fix">
                      <span className="check-fix-label">How to fix: </span>{check.fix}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
};

export default PerformanceScorecard;
