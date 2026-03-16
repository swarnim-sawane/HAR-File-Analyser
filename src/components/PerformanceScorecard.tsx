// src/components/PerformanceScorecard.tsx
import React, { useMemo, useState } from 'react';
import { HarFile } from '../types/har';

interface ScorecardProps {
  harData: HarFile;
}

interface Check {
  id: string;
  label: string;
  status: 'good' | 'warn' | 'bad';
  detail: string;
  fix?: string;
  impact: 'high' | 'medium' | 'low';
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

  const { score, checks } = useMemo(() => {
    const entries = harData.log.entries;
    const checks: Check[] = [];

    // ── 1. Error Rate ──────────────────────────────────────
    const errors = entries.filter(e => e.response.status >= 400);
    const errorRate = errors.length / entries.length;
    checks.push({
      id: 'errors',
      label: 'Error Rate',
      impact: 'high',
      status: errorRate === 0 ? 'good' : errorRate < 0.05 ? 'warn' : 'bad',
      detail: errors.length === 0
        ? 'No failed requests detected.'
        : `${errors.length} failed request${errors.length > 1 ? 's' : ''} (${(errorRate * 100).toFixed(1)}%): ${errors.slice(0, 3).map(e => `${e.response.status} ${new URL(e.request.url).pathname}`).join(', ')}${errors.length > 3 ? '…' : ''}`,
      fix: errors.length > 0 ? 'Investigate failed endpoints — these block user flows and should be resolved before deployment.' : undefined,
    });

    // ── 2. Slow Requests (p90) ─────────────────────────────
    const sorted = [...entries].sort((a, b) => b.time - a.time);
    const slowCount = entries.filter(e => e.time > 1000).length;
    checks.push({
      id: 'slow',
      label: 'Slow Requests (>1s)',
      impact: 'high',
      status: slowCount === 0 ? 'good' : slowCount <= 3 ? 'warn' : 'bad',
      detail: slowCount === 0
        ? 'All requests complete under 1 second.'
        : `${slowCount} slow requests. Slowest: ${sorted[0]?.time.toFixed(0)}ms — ${new URL(sorted[0]?.request.url).pathname}`,
      fix: 'Check TTFB on slow requests — high wait time typically indicates a server-side bottleneck.',
    });

    // ── 3. Uncompressed Responses ──────────────────────────
    const uncompressed = entries.filter(e => {
      const encoding = e.response.headers.find(h => h.name.toLowerCase() === 'content-encoding');
      const size = e.response.bodySize;
      const mime = e.response.content.mimeType;
      return !encoding && size > 1024 && (mime.includes('text') || mime.includes('json') || mime.includes('javascript'));
    });
    checks.push({
      id: 'compression',
      label: 'Response Compression',
      impact: 'medium',
      status: uncompressed.length === 0 ? 'good' : uncompressed.length <= 5 ? 'warn' : 'bad',
      detail: uncompressed.length === 0
        ? 'All compressible responses use gzip or brotli.'
        : `${uncompressed.length} text/JSON response${uncompressed.length > 1 ? 's' : ''} sent without compression.`,
      fix: 'Enable gzip or brotli on your server for text, JSON, and JS responses.',
    });

    // ── 4. Duplicate Requests ──────────────────────────────
    const urlCounts = entries.reduce((acc, e) => {
      const key = `${e.request.method}:${e.request.url}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const dupes = Object.entries(urlCounts).filter(([, c]) => c > 1);
    checks.push({
      id: 'duplicates',
      label: 'Duplicate Requests',
      impact: 'medium',
      status: dupes.length === 0 ? 'good' : dupes.length <= 3 ? 'warn' : 'bad',
      detail: dupes.length === 0
        ? 'No duplicate requests detected.'
        : `${dupes.length} URL${dupes.length > 1 ? 's' : ''} called multiple times: ${dupes.slice(0, 2).map(([url, c]) => `${new URL(url.split(':').slice(1).join(':')).pathname} ×${c}`).join(', ')}`,
      fix: 'Consider caching or deduplicating repeated API calls at the component or service level.',
    });

    // ── 5. Cache Headers ───────────────────────────────────
    const staticAssets = entries.filter(e => {
      const mime = e.response.content.mimeType;
      return mime.includes('javascript') || mime.includes('css') || mime.includes('image');
    });
    const uncached = staticAssets.filter(e => {
      const cc = e.response.headers.find(h => h.name.toLowerCase() === 'cache-control');
      return !cc || cc.value.includes('no-store') || cc.value.includes('no-cache');
    });
    checks.push({
      id: 'caching',
      label: 'Static Asset Caching',
      impact: 'medium',
      status: staticAssets.length === 0 ? 'good' : uncached.length === 0 ? 'good' : uncached.length <= 5 ? 'warn' : 'bad',
      detail: staticAssets.length === 0
        ? 'No static assets detected.'
        : uncached.length === 0
          ? `All ${staticAssets.length} static assets have cache headers.`
          : `${uncached.length} of ${staticAssets.length} static assets missing cache-control headers.`,
      fix: 'Add Cache-Control: max-age=31536000 to versioned static assets.',
    });

    // ── 6. External Domains ────────────────────────────────
    const allDomains = [...new Set(entries.map(e => {
      try { return new URL(e.request.url).hostname; } catch { return null; }
    }).filter(Boolean))] as string[];

    const internalPatterns = ['oracle.com', 'oraclecloud.com', 'oraclecorp.com', 'localhost', '127.0.0.1', '10.', '192.168.'];
    const externalDomains = allDomains.filter(d => !internalPatterns.some(p => d.includes(p)));
    checks.push({
      id: 'external',
      label: 'External Domain Calls',
      impact: 'high',
      status: externalDomains.length === 0 ? 'good' : externalDomains.length <= 3 ? 'warn' : 'bad',
      detail: externalDomains.length === 0
        ? 'All requests stay within internal domains.'
        : `${externalDomains.length} external domain${externalDomains.length > 1 ? 's' : ''} contacted: ${externalDomains.slice(0, 4).join(', ')}${externalDomains.length > 4 ? '…' : ''}`,
      fix: 'Review external calls — potential data leakage or third-party dependency risk.',
    });

    // ── 7. TTFB on API calls ───────────────────────────────
    const apiCalls = entries.filter(e => e.response.content.mimeType.includes('json'));
    const slowApi = apiCalls.filter(e => e.timings.wait > 500);
    checks.push({
      id: 'ttfb',
      label: 'API Response Time (TTFB)',
      impact: 'high',
      status: slowApi.length === 0 ? 'good' : slowApi.length <= 2 ? 'warn' : 'bad',
      detail: slowApi.length === 0
        ? `All ${apiCalls.length} API calls respond under 500ms.`
        : `${slowApi.length} API call${slowApi.length > 1 ? 's' : ''} with TTFB > 500ms. Worst: ${Math.max(...slowApi.map(e => e.timings.wait)).toFixed(0)}ms.`,
      fix: 'High TTFB indicates slow server processing — check DB queries or backend business logic.',
    });

    // ── Calculate Score ────────────────────────────────────
    const weights = { high: 20, medium: 10, low: 5 };
    const statusScore = { good: 1, warn: 0.5, bad: 0 };
    let total = 0, earned = 0;
    checks.forEach(c => {
      total += weights[c.impact];
      earned += weights[c.impact] * statusScore[c.status];
    });

    return { score: Math.round((earned / total) * 100), checks };
  }, [harData]);

  const scoreColor = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  const scoreLabel = score >= 80 ? 'Good' : score >= 50 ? 'Fair' : 'Poor';

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
          <p>{harData.log.entries.length} requests · {domainCount} domain{domainCount !== 1 ? 's' : ''}</p>
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
                <span className="check-label">{check.label}</span>
                <span className={`check-impact impact-${check.impact}`}>{check.impact}</span>
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
                    <div className="check-fix">{check.fix}</div>
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
