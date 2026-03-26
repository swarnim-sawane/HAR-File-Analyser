// src/components/PerformanceScorecard.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Entry, HarFile } from '../types/har';
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  DatabaseIcon,
  DownloadIcon,
  FlameIcon,
  GlobeIcon,
  ImageIcon,
  InfoIcon,
  NetworkIcon,
  RefreshIcon,
  RouteIcon,
  ServerIcon,
  ShieldIcon,
  SparklesIcon,
} from './Icons';

interface ScorecardProps {
  harData: HarFile;
}

type Level = 'err' | 'warn' | 'ok' | 'info';
type ScorecardIconName =
  | 'gateway'
  | 'auth'
  | 'server'
  | 'client'
  | 'security'
  | 'latency'
  | 'ttfb'
  | 'compression'
  | 'cache'
  | 'image'
  | 'mixed'
  | 'duplicate'
  | 'dns'
  | 'redirect'
  | 'ssl'
  | 'pass'
  | 'network';

interface Finding {
  level: Level;
  icon: ScorecardIconName;
  title: string;
  desc: string;
  meta?: string[];
}

interface ScoreRule {
  id: string;
  label: string;
  summary: string;
  points: number;
  active: boolean;
  tone: 'danger' | 'warning' | 'success';
}

function fmtT(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtB(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${bytes} B`;
}

function fhost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function getPathLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const label = parsed.pathname.split('/').pop() || parsed.pathname || parsed.hostname;
    return label.length > 52 ? `${label.slice(0, 49)}...` : label;
  } catch {
    return url.length > 52 ? `${url.slice(0, 49)}...` : url;
  }
}

function getTransferSize(entry: Entry): number {
  const bodySize = entry.response.bodySize ?? 0;
  const contentSize = entry.response.content?.size ?? 0;
  return Math.max(bodySize, contentSize, 0);
}

function getType(e: Entry): string {
  const mime = e.response.content?.mimeType ?? '';
  if (mime.includes('html')) return 'document';
  if (mime.includes('javascript') || mime.includes('ecmascript')) return 'script';
  if (mime.includes('css')) return 'stylesheet';
  if (mime.includes('image/')) return 'image';
  if (mime.includes('font')) return 'font';
  if (mime.includes('json') || mime.includes('xml')) return 'xhr';
  return 'other';
}

function hasCache(e: Entry): boolean {
  const cc = e.response.headers.find((h) => h.name.toLowerCase() === 'cache-control')?.value ?? '';
  const exp = e.response.headers.find((h) => h.name.toLowerCase() === 'expires')?.value ?? '';
  return !!cc.match(/max-age=[1-9]|public|immutable/) || (!!exp && exp !== '-1' && exp !== '0');
}

function hasCompression(e: Entry): boolean {
  const ce = e.response.headers.find((h) => h.name.toLowerCase() === 'content-encoding')?.value ?? '';
  return /gzip|br|deflate/.test(ce);
}

function scoreColor(score: number): string {
  if (score >= 90) return '#16a34a';
  if (score >= 70) return '#ca8a04';
  if (score >= 50) return '#ea580c';
  return '#dc2626';
}

function scoreLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 70) return 'Needs Work';
  if (score >= 50) return 'Poor';
  return 'Critical';
}

function scoreSummary(score: number, data: ReturnType<typeof analyse>): string {
  if (score >= 90) {
    return `Healthy session with ${data.errs.length === 0 ? 'no HTTP failures' : 'limited instability'} and strong response times across the request set.`;
  }
  if (score >= 70) {
    return 'The session is broadly functional, but several latency, caching, or reliability issues are still pulling the experience down.';
  }
  if (score >= 50) {
    return 'Performance issues are visible in the session. Prioritize error recovery, backend latency, and oversized or inefficient assets.';
  }
  return 'This HAR shows critical reliability or latency problems that will materially affect user experience and should be addressed first.';
}

function scoreHeadline(score: number): string {
  if (score >= 90) return 'Fast, stable delivery with minimal operational risk.';
  if (score >= 70) return 'Healthy session overall, with a few clear opportunities to reduce friction.';
  if (score >= 50) return 'Visible performance and reliability issues are affecting session quality.';
  return 'High-impact issues are materially reducing reliability and delivery quality.';
}

function analyse(entries: Entry[]) {
  const total = entries.length;
  const errs = entries.filter((e) => e.response.status >= 400);
  const gw = entries.filter((e) => [502, 503, 504].includes(e.response.status));
  const auth = entries.filter((e) => [401, 403].includes(e.response.status));
  const errs5xx = entries.filter((e) => e.response.status >= 500 && !gw.includes(e));
  const errs4xx = entries.filter((e) => e.response.status >= 400 && e.response.status < 500 && !auth.includes(e));
  const times = entries.map((e) => e.time ?? 0).filter((t) => t > 0);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const max = times.length ? Math.max(...times) : 0;
  const totalBytes = entries.reduce((a, e) => a + getTransferSize(e), 0);
  const verySlow = entries.filter((e) => (e.time ?? 0) > 5000);
  const slow = entries.filter((e) => (e.time ?? 0) > 2000 && (e.time ?? 0) <= 5000);
  const ttfbs = entries.map((e) => e.timings.wait ?? 0).filter((t) => t > 0);
  const avgTTFB = ttfbs.length ? ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length : 0;
  const highTTFB = entries.filter((e) => (e.timings.wait ?? 0) > 600);
  const textTypes = new Set(['script', 'stylesheet', 'xhr', 'document']);
  const uncompressed = entries.filter((e) => {
    const type = getType(e);
    const size = getTransferSize(e);
    return textTypes.has(type) && size > 50000 && !hasCompression(e);
  });
  const staticTypes = new Set(['script', 'stylesheet', 'image', 'font']);
  const noCacheStatic = entries.filter((e) => staticTypes.has(getType(e)) && !hasCache(e));
  const bigImg = entries.filter((e) => getType(e) === 'image' && getTransferSize(e) > 204800);
  const mixed = entries.filter((e) => e.request.url.startsWith('http://'));
  const sensitive = /token|password|passwd|secret|api[_-]?key|auth|credential|access_token|id_token/i;
  const leakyUrls = entries.filter((e) => {
    try {
      return [...new URL(e.request.url).searchParams.keys()].some((k) => sensitive.test(k));
    } catch {
      return false;
    }
  });
  const highDNS = entries.filter((e) => (e.timings.dns ?? 0) > 100);
  const highSSL = entries.filter((e) => (e.timings.ssl ?? 0) > 200);
  const redirChains = entries.filter((e) => e.response.status >= 300 && e.response.status < 400);
  const urlKey = (e: Entry) => `${e.request.method}|${e.request.url.split('?')[0]}`;
  const urlCounts = new Map<string, number>();
  entries.forEach((e) => urlCounts.set(urlKey(e), (urlCounts.get(urlKey(e)) ?? 0) + 1));
  const dupes = [...urlCounts.entries()].filter(([, count]) => count > 1);
  const uniqueHosts = new Set(entries.map((e) => fhost(e.request.url)).filter(Boolean));

  return {
    total,
    errs,
    gw,
    auth,
    errs5xx,
    errs4xx,
    times,
    avg,
    max,
    totalBytes,
    verySlow,
    slow,
    avgTTFB,
    highTTFB,
    uncompressed,
    noCacheStatic,
    bigImg,
    mixed,
    leakyUrls,
    highDNS,
    highSSL,
    redirChains,
    dupes,
    uniqueHosts,
  };
}

function buildScoreRules(d: ReturnType<typeof analyse>): ScoreRule[] {
  const errRate = d.errs.length / Math.max(1, d.total);
  return [
    {
      id: 'errors',
      label: 'HTTP errors present',
      summary: d.errs.length > 0 ? `${d.errs.length} failing requests affected this session` : 'No 4xx/5xx requests observed',
      points: errRate > 0 ? Math.round(errRate * 30) : 0,
      active: errRate > 0,
      tone: 'danger',
    },
    {
      id: 'avg-latency',
      label: 'Average response time',
      summary: `Average response is ${fmtT(d.avg)}`,
      points: d.avg > 3000 ? 15 : d.avg > 1500 ? 10 : d.avg > 800 ? 5 : 0,
      active: d.avg > 800,
      tone: d.avg > 3000 ? 'danger' : 'warning',
    },
    {
      id: 'max-latency',
      label: 'Slowest request outlier',
      summary: `Slowest request peaks at ${fmtT(d.max)}`,
      points: d.max > 10000 ? 10 : d.max > 5000 ? 6 : d.max > 2000 ? 3 : 0,
      active: d.max > 2000,
      tone: d.max > 10000 ? 'danger' : 'warning',
    },
    {
      id: 'compression',
      label: 'Missing compression',
      summary: d.uncompressed.length > 0 ? `${d.uncompressed.length} large text assets are uncompressed` : 'Compression coverage looks healthy',
      points: d.uncompressed.length > 3 ? 8 : d.uncompressed.length > 0 ? 4 : 0,
      active: d.uncompressed.length > 0,
      tone: 'warning',
    },
    {
      id: 'cache',
      label: 'Missing cache headers',
      summary: d.noCacheStatic.length > 0 ? `${d.noCacheStatic.length} static assets miss usable cache control` : 'Static cache headers are present',
      points: d.noCacheStatic.length > 5 ? 6 : d.noCacheStatic.length > 0 ? 3 : 0,
      active: d.noCacheStatic.length > 0,
      tone: 'warning',
    },
    {
      id: 'mixed',
      label: 'Insecure HTTP traffic',
      summary: d.mixed.length > 0 ? `${d.mixed.length} requests still use plaintext HTTP` : 'All requests use HTTPS',
      points: d.mixed.length > 0 ? 5 : 0,
      active: d.mixed.length > 0,
      tone: 'danger',
    },
    {
      id: 'images',
      label: 'Oversized images',
      summary: d.bigImg.length > 0 ? `${d.bigImg.length} images exceed 200kB` : 'Image payload sizes are within target',
      points: d.bigImg.length > 2 ? 5 : d.bigImg.length > 0 ? 2 : 0,
      active: d.bigImg.length > 0,
      tone: 'warning',
    },
    {
      id: 'ttfb',
      label: 'High TTFB',
      summary: `Average TTFB is ${fmtT(d.avgTTFB)}`,
      points: d.avgTTFB > 800 ? 8 : d.avgTTFB > 400 ? 4 : 0,
      active: d.avgTTFB > 400,
      tone: 'warning',
    },
    {
      id: 'sensitive',
      label: 'Sensitive query parameters',
      summary: d.leakyUrls.length > 0 ? `${d.leakyUrls.length} URLs expose potentially sensitive params` : 'No credentials or tokens were found in URLs',
      points: d.leakyUrls.length > 0 ? 8 : 0,
      active: d.leakyUrls.length > 0,
      tone: 'danger',
    },
    {
      id: 'duplicates',
      label: 'Duplicate request patterns',
      summary: d.dupes.length > 0 ? `${d.dupes.length} duplicate request signatures were detected` : 'No duplicate request patterns detected',
      points: d.dupes.length > 3 ? 4 : d.dupes.length > 0 ? 2 : 0,
      active: d.dupes.length > 0,
      tone: 'warning',
    },
  ];
}

function calcScore(d: ReturnType<typeof analyse>): number {
  let s = 100;
  const errRate = d.errs.length / Math.max(1, d.total);
  s -= Math.round(errRate * 30);
  if (d.avg > 3000) s -= 15;
  else if (d.avg > 1500) s -= 10;
  else if (d.avg > 800) s -= 5;
  if (d.max > 10000) s -= 10;
  else if (d.max > 5000) s -= 6;
  else if (d.max > 2000) s -= 3;
  if (d.uncompressed.length > 3) s -= 8;
  else if (d.uncompressed.length > 0) s -= 4;
  if (d.noCacheStatic.length > 5) s -= 6;
  else if (d.noCacheStatic.length > 0) s -= 3;
  if (d.mixed.length > 0) s -= 5;
  if (d.bigImg.length > 2) s -= 5;
  else if (d.bigImg.length > 0) s -= 2;
  if (d.avgTTFB > 800) s -= 8;
  else if (d.avgTTFB > 400) s -= 4;
  if (d.leakyUrls.length > 0) s -= 8;
  if (d.dupes.length > 3) s -= 4;
  else if (d.dupes.length > 0) s -= 2;
  return Math.max(0, Math.min(100, s));
}

function calcScoreFromRules(rules: ScoreRule[]): number {
  return Math.max(0, Math.min(100, 100 - rules.reduce((sum, rule) => sum + rule.points, 0)));
}

function buildFindings(d: ReturnType<typeof analyse>): Finding[] {
  const findings: Finding[] = [];

  if (d.gw.length) {
    findings.push({
      level: 'err',
      icon: 'gateway',
      title: `${d.gw.length} gateway error${d.gw.length > 1 ? 's' : ''} detected`,
      desc: 'The edge tier cannot reliably reach the upstream service. Check deployment health, reverse proxy routing, and backend availability.',
      meta: d.gw.slice(0, 3).map((e) => `${e.request.method} ${e.request.url}`),
    });
  }

  if (d.auth.length) {
    findings.push({
      level: 'err',
      icon: 'auth',
      title: `${d.auth.length} authentication failure${d.auth.length > 1 ? 's' : ''}`,
      desc: 'Requests are being rejected for authorization reasons. Validate session expiry, token formatting, CORS, and header propagation.',
      meta: d.auth.slice(0, 3).map((e) => `HTTP ${e.response.status} ${e.request.url}`),
    });
  }

  if (d.errs5xx.length && !d.gw.length) {
    findings.push({
      level: 'err',
      icon: 'server',
      title: `${d.errs5xx.length} upstream server error${d.errs5xx.length > 1 ? 's' : ''}`,
      desc: 'Application-level server failures are present. Inspect service logs, dependency health, and database connectivity.',
      meta: d.errs5xx.slice(0, 3).map((e) => `HTTP ${e.response.status} ${e.request.url}`),
    });
  }

  if (d.errs4xx.length && !d.auth.length) {
    findings.push({
      level: 'err',
      icon: 'client',
      title: `${d.errs4xx.length} client error${d.errs4xx.length > 1 ? 's' : ''}`,
      desc: 'Some resources are missing or requested incorrectly. Verify endpoint paths, payload shape, and expected query parameters.',
      meta: d.errs4xx.slice(0, 3).map((e) => `HTTP ${e.response.status} ${e.request.url}`),
    });
  }

  if (d.leakyUrls.length) {
    findings.push({
      level: 'err',
      icon: 'security',
      title: `${d.leakyUrls.length} URL${d.leakyUrls.length > 1 ? 's' : ''} expose sensitive parameters`,
      desc: 'Secrets in query strings can leak into logs, history, and referer headers. Move sensitive values into headers or the request body.',
      meta: d.leakyUrls.slice(0, 3).map((e) => e.request.url),
    });
  }

  if (d.verySlow.length) {
    findings.push({
      level: 'warn',
      icon: 'latency',
      title: `${d.verySlow.length} request${d.verySlow.length > 1 ? 's' : ''} exceed 5 seconds`,
      desc: 'Very slow responses usually point to blocking backend work, missing database indexes, or heavy server-side computation.',
      meta: [...d.verySlow].sort((a, b) => b.time - a.time).slice(0, 3).map((e) => `${fmtT(e.time)} ${e.request.url}`),
    });
  } else if (d.slow.length) {
    findings.push({
      level: 'warn',
      icon: 'latency',
      title: `${d.slow.length} slow request${d.slow.length > 1 ? 's' : ''} over 2 seconds`,
      desc: 'Multiple requests are breaching a comfortable latency budget. Split backend time from payload cost to isolate the real bottleneck.',
      meta: [...d.slow].sort((a, b) => b.time - a.time).slice(0, 4).map((e) => `${fmtT(e.time)} ${e.request.url}`),
    });
  }

  if (d.highTTFB.length > 2) {
    findings.push({
      level: 'warn',
      icon: 'ttfb',
      title: `High TTFB on ${d.highTTFB.length} requests`,
      desc: 'Slow first-byte times suggest backend processing overhead before the response starts streaming. Look at database caching and expensive upstream calls.',
      meta: d.highTTFB.slice(0, 3).map((e) => `TTFB ${fmtT(e.timings.wait ?? 0)} ${e.request.url}`),
    });
  }

  if (d.uncompressed.length) {
    findings.push({
      level: 'warn',
      icon: 'compression',
      title: `${d.uncompressed.length} large uncompressed text asset${d.uncompressed.length > 1 ? 's' : ''}`,
      desc: `Enable gzip or Brotli for scripts, stylesheets, documents, and API payloads. Estimated transfer savings are about ${fmtB(d.uncompressed.reduce((a, e) => a + getTransferSize(e) * 0.7, 0))}.`,
      meta: [...d.uncompressed].sort((a, b) => getTransferSize(b) - getTransferSize(a)).slice(0, 3).map((e) => `${fmtB(getTransferSize(e))} ${e.request.url}`),
    });
  }

  if (d.noCacheStatic.length) {
    findings.push({
      level: 'warn',
      icon: 'cache',
      title: `${d.noCacheStatic.length} static resource${d.noCacheStatic.length > 1 ? 's' : ''} missing cache headers`,
      desc: 'Immutable static assets should advertise long-lived caching to avoid unnecessary re-downloads on repeat visits.',
      meta: d.noCacheStatic.slice(0, 3).map((e) => `${getType(e)} ${e.request.url}`),
    });
  }

  if (d.bigImg.length) {
    findings.push({
      level: 'warn',
      icon: 'image',
      title: `${d.bigImg.length} oversized image${d.bigImg.length > 1 ? 's' : ''}`,
      desc: 'Large images increase layout time and network cost. Prefer AVIF or WebP, responsive sizes, and more aggressive compression.',
      meta: [...d.bigImg].sort((a, b) => getTransferSize(b) - getTransferSize(a)).slice(0, 3).map((e) => `${fmtB(getTransferSize(e))} ${e.request.url}`),
    });
  }

  if (d.mixed.length) {
    findings.push({
      level: 'warn',
      icon: 'mixed',
      title: `${d.mixed.length} insecure HTTP request${d.mixed.length > 1 ? 's' : ''}`,
      desc: 'Plaintext requests weaken transport security. Move all traffic to HTTPS and consider HSTS to eliminate protocol downgrade hops.',
      meta: d.mixed.slice(0, 3).map((e) => e.request.url),
    });
  }

  if (d.dupes.length) {
    findings.push({
      level: 'warn',
      icon: 'duplicate',
      title: `${d.dupes.length} duplicate request pattern${d.dupes.length > 1 ? 's' : ''}`,
      desc: 'Repeated identical requests waste bandwidth and backend work. Add client-side deduplication or short-lived caching where appropriate.',
      meta: d.dupes.slice(0, 4).map(([key, count]) => {
        const [method, url] = key.split('|');
        return `x${count} ${method} ${url}`;
      }),
    });
  }

  if (d.highDNS.length > 2) {
    findings.push({
      level: 'info',
      icon: 'dns',
      title: `${d.highDNS.length} slow DNS lookups across ${d.uniqueHosts.size} hosts`,
      desc: 'A broad host spread adds connection setup latency. Preconnect or reduce third-party host count for critical paths.',
      meta: [`Hosts: ${[...d.uniqueHosts].slice(0, 6).join(', ')}`],
    });
  }

  if (d.redirChains.length > 2) {
    findings.push({
      level: 'info',
      icon: 'redirect',
      title: `${d.redirChains.length} redirects detected`,
      desc: 'Redirects add extra round trips before useful content arrives. Point clients directly to the final destination whenever possible.',
      meta: d.redirChains.slice(0, 3).map((e) => `HTTP ${e.response.status} ${e.request.url}`),
    });
  }

  if (d.highSSL.length > 2) {
    findings.push({
      level: 'info',
      icon: 'ssl',
      title: `${d.highSSL.length} slow TLS handshakes`,
      desc: 'TLS overhead may be improved through session resumption, OCSP stapling, and modern protocol support such as TLS 1.3.',
    });
  }

  if (d.errs.length === 0) {
    findings.push({
      level: 'ok',
      icon: 'pass',
      title: 'No HTTP errors detected',
      desc: `All ${d.total} requests completed without 4xx or 5xx failures.`,
    });
  }

  if (d.avg < 300 && d.total > 3) {
    findings.push({
      level: 'ok',
      icon: 'latency',
      title: `Fast average response at ${fmtT(d.avg)}`,
      desc: 'Response times are comfortably inside a healthy interactive range for a web session.',
    });
  }

  if (d.mixed.length === 0 && d.total > 5) {
    findings.push({
      level: 'ok',
      icon: 'security',
      title: 'All requests use HTTPS',
      desc: 'No plaintext HTTP traffic was observed in this HAR capture.',
    });
  }

  if (d.leakyUrls.length === 0) {
    findings.push({
      level: 'ok',
      icon: 'pass',
      title: 'No credentials exposed in URLs',
      desc: 'Sensitive values were not detected in query parameters across the request set.',
    });
  }

  return findings;
}

function getFindingIcon(icon: ScorecardIconName): React.ReactNode {
  switch (icon) {
    case 'gateway':
      return <ServerIcon />;
    case 'auth':
      return <ShieldIcon />;
    case 'server':
      return <DatabaseIcon />;
    case 'client':
      return <AlertIcon />;
    case 'security':
      return <ShieldIcon />;
    case 'latency':
      return <FlameIcon />;
    case 'ttfb':
      return <ClockIcon />;
    case 'compression':
      return <DownloadIcon />;
    case 'cache':
      return <RefreshIcon />;
    case 'image':
      return <ImageIcon />;
    case 'mixed':
      return <GlobeIcon />;
    case 'duplicate':
      return <RefreshIcon />;
    case 'dns':
      return <NetworkIcon />;
    case 'redirect':
      return <RouteIcon />;
    case 'ssl':
      return <ShieldIcon />;
    case 'network':
      return <NetworkIcon />;
    case 'pass':
    default:
      return <CheckIcon />;
  }
}

const KpiCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}> = ({ icon, label, value, note, tone = 'neutral' }) => (
  <article className={`scorecard-kpi-card tone-${tone}`}>
    <span className="scorecard-kpi-icon" aria-hidden="true">{icon}</span>
    <div className="scorecard-kpi-copy">
      <span className="scorecard-kpi-label">{label}</span>
      <strong className="scorecard-kpi-value">{value}</strong>
      <span className="scorecard-kpi-note">{note}</span>
    </div>
  </article>
);

const FindingCard: React.FC<{ finding: Finding }> = ({ finding }) => (
  <article className={`scorecard-finding-card tone-${finding.level}`}>
    <span className="scorecard-finding-icon" aria-hidden="true">{getFindingIcon(finding.icon)}</span>
    <div className="scorecard-finding-copy">
      <div className="scorecard-finding-head">
        <strong>{finding.title}</strong>
      </div>
      <p>{finding.desc}</p>
      {finding.meta && finding.meta.length > 0 && (
        <ul className="scorecard-finding-meta">
          {finding.meta.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  </article>
);

const PerformanceScorecard: React.FC<ScorecardProps> = ({ harData }) => {
  const { score, data, findings, scoreRules } = useMemo(() => {
    const entries = harData.log.entries;
    if (entries.length === 0) {
      return {
        score: 100,
        data: null,
        findings: [] as Finding[],
        scoreRules: [] as ScoreRule[],
      };
    }

    const analysis = analyse(entries);
    const nextRules = buildScoreRules(analysis);
    return {
      score: calcScoreFromRules(nextRules),
      data: analysis,
      findings: buildFindings(analysis),
      scoreRules: nextRules,
    };
  }, [harData]);

  const [showExplainer, setShowExplainer] = useState(false);
  const [showInactiveRules, setShowInactiveRules] = useState(false);
  const [hoverCapable, setHoverCapable] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const explainerRegionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setHoverCapable(mediaQuery.matches);
    sync();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync);
      return () => mediaQuery.removeEventListener('change', sync);
    }

    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  useEffect(() => {
    if (!showExplainer) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setShowExplainer(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowExplainer(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showExplainer]);

  function openExplainer() {
    setShowExplainer(true);
  }

  function closeExplainer() {
    setShowExplainer(false);
  }

  if (!data) {
    return (
      <section className="scorecard-dashboard is-empty">
        <div className="scorecard-empty-state">
          <span className="scorecard-empty-icon" aria-hidden="true"><SparklesIcon /></span>
          <strong>No data yet</strong>
          <span>Load a HAR file to generate the executive scorecard.</span>
        </div>
      </section>
    );
  }

  const color = scoreColor(score);
  const label = scoreLabel(score);
  const errRate = Math.round((data.errs.length / Math.max(1, data.total)) * 100);
  const totalTransferred = data.totalBytes > 0 ? fmtB(data.totalBytes) : '0 B';
  const activeRules = scoreRules.filter((rule) => rule.active);
  const inactiveRules = scoreRules.filter((rule) => !rule.active);
  const totalDeductions = activeRules.reduce((sum, rule) => sum + rule.points, 0);
  const critical = findings.filter((f) => f.level === 'err');
  const warnings = findings.filter((f) => f.level === 'warn');
  const insights = findings.filter((f) => f.level === 'info');
  const passed = findings.filter((f) => f.level === 'ok');
  const slowTop = [...harData.log.entries].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 5);
  const maxTime = Math.max(slowTop[0]?.time ?? 1, 1);

  const domainMap = new Map<string, { count: number; bytes: number; time: number; errs: number }>();
  harData.log.entries.forEach((entry) => {
    const host = fhost(entry.request.url);
    if (!host) return;
    const current = domainMap.get(host) ?? { count: 0, bytes: 0, time: 0, errs: 0 };
    current.count += 1;
    current.bytes += getTransferSize(entry);
    current.time += entry.time ?? 0;
    if (entry.response.status >= 400) current.errs += 1;
    domainMap.set(host, current);
  });

  const domains = [...domainMap.entries()]
    .map(([host, value]) => ({ host, ...value, avg: value.time / Math.max(value.count, 1) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const maxDomainTime = Math.max(...domains.map((domain) => domain.time), 1);
  const scoreRadius = 76;
  const scoreCircumference = 2 * Math.PI * scoreRadius;
  const scoreOffset = scoreCircumference - (score / 100) * scoreCircumference;

  return (
    <section className="scorecard-dashboard">
      <div className="scorecard-hero-card">
        <div className="scorecard-hero-grid">
          <div className="scorecard-hero-copy">
            <span className="scorecard-hero-kicker">
              <SparklesIcon />
              <span>Performance Scorecard</span>
            </span>
            <h2>Executive snapshot for this HAR session</h2>
            <p>{scoreHeadline(score)}</p>
            <div className="scorecard-hero-tags">
              <span className="scorecard-pill">{data.total} requests</span>
              <span className="scorecard-pill">{data.uniqueHosts.size} hosts</span>
              <span className="scorecard-pill">Avg TTFB {fmtT(data.avgTTFB)}</span>
            </div>
          </div>

          <div className="scorecard-score-card">
            <div className="scorecard-score-ring" style={{ ['--score-accent' as string]: color } as React.CSSProperties}>
              <svg viewBox="0 0 200 200" aria-hidden="true">
                <circle className="scorecard-score-track" cx="100" cy="100" r={scoreRadius} />
                <circle
                  className="scorecard-score-progress"
                  cx="100"
                  cy="100"
                  r={scoreRadius}
                  strokeDasharray={scoreCircumference}
                  strokeDashoffset={scoreOffset}
                />
              </svg>
              <div className="scorecard-score-copy">
                <strong>{score}</strong>
                <span>{label}</span>
              </div>
            </div>
            <p className="scorecard-score-description">
              Score is penalty-based across latency, reliability, caching, compression, and security indicators.
            </p>
            <div
              ref={explainerRegionRef}
              className="scorecard-score-actions"
              onMouseEnter={() => {
                if (hoverCapable) openExplainer();
              }}
              onMouseLeave={() => {
                if (hoverCapable) closeExplainer();
              }}
              onFocusCapture={() => openExplainer()}
              onBlurCapture={(event) => {
                const nextTarget = event.relatedTarget as Node | null;
                if (!nextTarget || !explainerRegionRef.current?.contains(nextTarget)) {
                  closeExplainer();
                }
              }}
            >
              <button
                ref={triggerRef}
                type="button"
                className={`scorecard-score-button ${showExplainer ? 'is-open' : ''}`}
                aria-expanded={showExplainer}
                onClick={() => {
                  if (!hoverCapable) {
                    setShowExplainer((current) => !current);
                  } else {
                    openExplainer();
                  }
                }}
              >
                <InfoIcon />
                <span>How this score is calculated</span>
              </button>

              {showExplainer && (
                <div ref={popoverRef} className="scorecard-score-popover">
                  <div className="scorecard-popover-head">
                    <div className="scorecard-popover-title">
                      <span className="scorecard-popover-icon" aria-hidden="true"><SparklesIcon /></span>
                      <div>
                        <strong>How this score is calculated</strong>
                        <p>Starts at 100 and subtracts penalties based on this HAR.</p>
                      </div>
                    </div>
                    <div className="scorecard-popover-base">
                      <span>Base</span>
                      <strong>100</strong>
                    </div>
                  </div>

                  <div className="scorecard-popover-rule-summary">
                    <span>Active deductions</span>
                    <strong>{activeRules.length} rule{activeRules.length !== 1 ? 's' : ''} affected this score</strong>
                  </div>

                  <div className="scorecard-popover-rule-list">
                    {activeRules.length === 0 ? (
                      <div className="scorecard-popover-rule tone-success">
                        <span className="scorecard-popover-rule-icon" aria-hidden="true"><CheckIcon /></span>
                        <div className="scorecard-popover-rule-copy">
                          <strong>No deductions applied</strong>
                          <span>This HAR session did not trigger any score penalties.</span>
                        </div>
                        <span className="scorecard-popover-points">0</span>
                      </div>
                    ) : (
                      activeRules.map((rule) => (
                        <div key={rule.id} className={`scorecard-popover-rule tone-${rule.tone}`}>
                          <span className="scorecard-popover-rule-icon" aria-hidden="true">
                            {rule.tone === 'danger' ? <AlertIcon /> : <RefreshIcon />}
                          </span>
                          <div className="scorecard-popover-rule-copy">
                            <strong>{rule.label}</strong>
                            <span>{rule.summary}</span>
                          </div>
                          <span className="scorecard-popover-points">-{rule.points}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <button
                    type="button"
                    className={`scorecard-popover-toggle ${showInactiveRules ? 'is-open' : ''}`}
                    onClick={() => setShowInactiveRules((current) => !current)}
                  >
                    <ChevronDownIcon />
                    <span>{showInactiveRules ? 'Hide' : 'Show'} {inactiveRules.length} rules with no deduction</span>
                  </button>

                  {showInactiveRules && (
                    <div className="scorecard-popover-pass-list">
                      {inactiveRules.map((rule) => (
                        <div key={rule.id} className="scorecard-popover-pass-item">
                          <strong>{rule.label}</strong>
                          <span>{rule.summary}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="scorecard-popover-footer">
                    <div className="scorecard-popover-metric">
                      <span>Base</span>
                      <strong>100</strong>
                    </div>
                    <div className="scorecard-popover-metric">
                      <span>Deductions</span>
                      <strong>-{totalDeductions}</strong>
                    </div>
                    <div className="scorecard-popover-metric is-final">
                      <span>Final</span>
                      <strong>{score}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="scorecard-kpi-grid">
          <KpiCard
            icon={<ClockIcon />}
            label="Avg Response"
            value={fmtT(data.avg)}
            note={data.avg > 1500 ? 'Needs improvement' : data.avg > 800 ? 'Moderate latency' : 'Healthy latency'}
            tone={data.avg > 1500 ? 'danger' : data.avg > 800 ? 'warning' : 'success'}
          />
          <KpiCard
            icon={<AlertIcon />}
            label="Error Rate"
            value={`${errRate}%`}
            note={`${data.errs.length} of ${data.total} requests`}
            tone={data.errs.length > 0 ? 'danger' : 'success'}
          />
          <KpiCard
            icon={<DownloadIcon />}
            label="Transferred"
            value={totalTransferred}
            note={`${data.uniqueHosts.size} hosts involved`}
            tone="neutral"
          />
          <KpiCard
            icon={<ClockIcon />}
            label="Slowest Request"
            value={fmtT(data.max)}
            note={data.max > 5000 ? 'Critical outlier' : data.max > 2000 ? 'Within watch range' : 'Within target'}
            tone={data.max > 5000 ? 'danger' : data.max > 2000 ? 'warning' : 'success'}
          />
      </div>

      <section className="scorecard-section-card">
        <header className="scorecard-section-header is-reference">
          <div>
            <h3>Critical Issues</h3>
            <p>Highest-risk failures and blockers surfaced from the HAR trace.</p>
          </div>
          <span className={`scorecard-header-pill ${critical.length === 0 ? 'tone-success' : 'tone-danger'}`}>
            {critical.length === 0 ? 'None' : `${critical.length} critical`}
          </span>
        </header>
        <div className="scorecard-section-divider" />
        <div className="scorecard-section-stack">
          {critical.length > 0 ? critical.map((item) => (
            <FindingCard key={item.title} finding={item} />
          )) : (
            <FindingCard
              finding={{
                level: 'ok',
                icon: 'pass',
                title: 'No critical issues found',
                desc: 'This capture completed without any severe failures or production-blocking network issues.',
              }}
            />
          )}
        </div>
      </section>

      <section className="scorecard-section-card">
        <header className="scorecard-section-header is-reference">
          <div>
            <h3>Warnings & Optimizations</h3>
            <p>Signals that may not be critical yet, but still affect efficiency, latency, or delivery quality.</p>
          </div>
          <div className="scorecard-header-pill-group">
            {warnings.length > 0 && <span className="scorecard-header-pill tone-warning">{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</span>}
            {insights.length > 0 && <span className="scorecard-header-pill tone-info">{insights.length} insight{insights.length !== 1 ? 's' : ''}</span>}
            {warnings.length === 0 && insights.length === 0 && <span className="scorecard-header-pill tone-success">Clear</span>}
          </div>
        </header>
        <div className="scorecard-section-divider" />
        <div className="scorecard-section-stack">
          {[...warnings, ...insights].map((item) => (
            <FindingCard key={`${item.level}-${item.title}`} finding={item} />
          ))}
          {warnings.length === 0 && insights.length === 0 && (
            <FindingCard
              finding={{
                level: 'ok',
                icon: 'pass',
                title: 'No material optimization flags',
                desc: 'This HAR does not surface additional warning-level or insight-level optimization issues.',
              }}
            />
          )}
        </div>
      </section>

      <section className="scorecard-section-card">
        <header className="scorecard-section-header is-reference">
          <div>
            <h3>Passed Checks</h3>
            <p>Positive signals that reinforce the overall health of this session.</p>
          </div>
          <span className="scorecard-header-pill tone-success">{passed.length} passed</span>
        </header>
        <div className="scorecard-section-divider" />
        <div className="scorecard-section-stack">
          {passed.map((item) => (
            <FindingCard key={item.title} finding={item} />
          ))}
        </div>
      </section>

      <div className="scorecard-analytics-grid is-reference">
        <section className="scorecard-panel-card">
          <header className="scorecard-panel-header">
            <div>
              <h3>Top slow requests</h3>
              <p>The most time-consuming calls in this session, ranked by duration.</p>
            </div>
          </header>
          <div className="scorecard-section-divider" />

          <div className="scorecard-panel-list">
            {slowTop.map((entry) => {
              const time = entry.time ?? 0;
              const badgeLabel = entry.response.status >= 400 ? 'Error' : entry.response.status >= 300 ? 'Redirect' : 'Observed';
              const badgeTone = entry.response.status >= 400 ? 'danger' : 'info';
              const barWidth = `${Math.max(10, Math.round((time / maxTime) * 100))}%`;

              return (
                <article key={`${entry.request.method}-${entry.request.url}-${entry.startedDateTime}`} className="scorecard-traffic-card">
                  <div className="scorecard-traffic-head">
                    <strong title={entry.request.url}>{getPathLabel(entry.request.url)}</strong>
                    <div className="scorecard-traffic-metrics">
                      <span className="scorecard-traffic-time">{fmtT(time)}</span>
                      <span className={`scorecard-inline-pill tone-${badgeTone}`}>{badgeLabel}</span>
                    </div>
                  </div>
                  <span className="scorecard-traffic-subtitle">{fhost(entry.request.url)}</span>
                  <div className="scorecard-traffic-bar">
                    <div
                      className={`scorecard-traffic-bar-fill tone-${time > 1400 ? 'warning' : 'info'}`}
                      style={{ width: barWidth } as React.CSSProperties}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="scorecard-panel-card">
          <header className="scorecard-panel-header">
            <div>
              <h3>Domain Analysis</h3>
              <p>Where traffic volume and latency are concentrated across hosts.</p>
            </div>
            <span className="scorecard-header-pill tone-info">{domains.length} hosts</span>
          </header>
          <div className="scorecard-section-divider" />

          <div className="scorecard-panel-list">
            {domains.map((domain) => (
              <article key={domain.host} className="scorecard-domain-card">
                <div className="scorecard-domain-card-head">
                  <strong title={domain.host}>{domain.host}</strong>
                  <span>{domain.count} req</span>
                </div>
                <span className="scorecard-domain-subtitle">{fmtB(domain.bytes)} transferred</span>
                <div className="scorecard-traffic-bar">
                  <div
                    className="scorecard-traffic-bar-fill tone-info"
                    style={{ width: `${Math.max(10, Math.round((domain.time / maxDomainTime) * 100))}%` } as React.CSSProperties}
                  />
                </div>
                <div className="scorecard-domain-grid">
                  <div>
                    <span>AVG</span>
                    <strong>{fmtT(domain.avg)}</strong>
                  </div>
                  <div>
                    <span>ERRORS</span>
                    <strong>{domain.errs}</strong>
                  </div>
                  <div>
                    <span>TOTAL TIME</span>
                    <strong>{fmtT(domain.time)}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
};

export default PerformanceScorecard;
