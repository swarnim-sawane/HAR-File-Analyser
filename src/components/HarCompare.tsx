// src/components/HarCompare.tsx
import React, { useCallback, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Entry, HarFile } from '../types/har';

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL ||
  (import.meta as any).env?.VITE_API_URL ||
  'http://localhost:4000';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function deltaColor(delta: number, lowerIsBetter = true): string {
  if (delta === 0) return 'var(--text-secondary)';
  const worse = lowerIsBetter ? delta > 0 : delta < 0;
  return worse ? '#ef4444' : '#10b981';
}

function deltaSign(delta: number): string {
  return delta > 0 ? `+${fmtMs(delta)}` : delta < 0 ? `-${fmtMs(Math.abs(delta))}` : '±0';
}

function urlKey(entry: Entry): string {
  try {
    const u = new URL(entry.request.url);
    return `${entry.request.method}:${u.pathname}`;
  } catch {
    return `${entry.request.method}:${entry.request.url}`;
  }
}

function shortPath(url: string, maxLen = 60): string {
  try {
    const u = new URL(url);
    const p = u.pathname + (u.search ? u.search.slice(0, 20) + (u.search.length > 20 ? '…' : '') : '');
    return p.length > maxLen ? '…' + p.slice(-maxLen) : p;
  } catch {
    return url.length > maxLen ? '…' + url.slice(-maxLen) : url;
  }
}

function normalizeCompareMarkdown(text: string): string {
  if (!text) return '';

  let normalized = text.replace(/\r\n/g, '\n');

  // Convert "#N -/— ..." patterns into markdown numbered list items.
  normalized = normalized.replace(
    /^[ \t]*[\u2022\u25CF\u25AA\u25B8\u25B9]?\s*#(\d+)\s*[\u2014\u2013\u2012\u2015-]\s+/gm,
    '$1. ',
  );

  // Normalize unicode bullets into markdown list markers.
  normalized = normalized.replace(/^[ \t]*[\u2022\u25CF\u25AA\u25B8\u25B9]\s+/gm, '- ');
  normalized = normalized.replace(/^[ \t]*[\u25E6\u25AB\u2023]\s+/gm, '  - ');

  // Remove trailing spaces and excessive blank lines.
  normalized = normalized.replace(/[ \t]+\n/g, '\n');
  normalized = normalized.replace(/\n{3,}/g, '\n\n');

  // Collapse blank lines between consecutive list items.
  let previous = '';
  while (previous !== normalized) {
    previous = normalized;
    normalized = normalized.replace(
      /(\n[ \t]*(?:\d+\.|-|\*|\+)\s.+)\n\n([ \t]*(?:\d+\.|-|\*|\+)\s)/g,
      '$1\n$2',
    );
  }

  return normalized.trim();
}

interface Metrics {
  totalRequests: number;
  errors: number;
  errorRate: number;
  avgTime: number;
  p95: number;
  p99: number;
  totalSize: number;
  totalTime: number;
}

function computeMetrics(entries: Entry[]): Metrics {
  const sorted = [...entries].map(e => e.time).sort((a, b) => a - b);
  const errors = entries.filter(e => e.response.status >= 400).length;
  const totalSize = entries.reduce((s, e) => s + Math.max(0, e.response.bodySize), 0);
  const totalTime = entries.reduce((s, e) => s + e.time, 0);
  return {
    totalRequests: entries.length,
    errors,
    errorRate: entries.length > 0 ? errors / entries.length : 0,
    avgTime: entries.length > 0 ? totalTime / entries.length : 0,
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    totalSize,
    totalTime,
  };
}

interface DiffRow {
  key: string;
  url: string;
  method: string;
  timeA: number | null;
  timeB: number | null;
  statusA: number | null;
  statusB: number | null;
  kind: 'both' | 'only-a' | 'only-b';
}

function buildDiff(entriesA: Entry[], entriesB: Entry[]): DiffRow[] {
  const mapA = new Map<string, Entry[]>();
  const mapB = new Map<string, Entry[]>();

  for (const e of entriesA) {
    const k = urlKey(e);
    if (!mapA.has(k)) mapA.set(k, []);
    mapA.get(k)!.push(e);
  }
  for (const e of entriesB) {
    const k = urlKey(e);
    if (!mapB.has(k)) mapB.set(k, []);
    mapB.get(k)!.push(e);
  }

  const rows: DiffRow[] = [];
  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

  for (const key of allKeys) {
    const as = mapA.get(key);
    const bs = mapB.get(key);
    const sample = (as ?? bs)![0];
    const avgTime = (arr?: Entry[]) =>
      arr ? arr.reduce((s, e) => s + e.time, 0) / arr.length : null;

    rows.push({
      key,
      url: sample.request.url,
      method: sample.request.method,
      timeA: avgTime(as),
      timeB: avgTime(bs),
      statusA: as ? as[0].response.status : null,
      statusB: bs ? bs[0].response.status : null,
      kind: as && bs ? 'both' : as ? 'only-a' : 'only-b',
    });
  }

  // Sort: biggest regression first, then only-a, then only-b
  return rows.sort((a, b) => {
    if (a.kind === 'both' && b.kind === 'both') {
      const da = (a.timeB ?? 0) - (a.timeA ?? 0);
      const db = (b.timeB ?? 0) - (b.timeA ?? 0);
      return db - da;
    }
    const order = { both: 0, 'only-a': 1, 'only-b': 2 };
    return order[a.kind] - order[b.kind];
  });
}

interface WaterfallEntry {
  url: string;
  method: string;
  status: number;
  relStart: number; // ms from session start
  duration: number; // ms
  file: 'A' | 'B';
}

function buildWaterfall(
  entriesA: Entry[],
  entriesB: Entry[],
  maxRows = 40,
): { rows: WaterfallEntry[]; maxMs: number } {
  const toMs = (dt: string) => new Date(dt).getTime();

  const baseA = entriesA.length
    ? Math.min(...entriesA.map(e => toMs(e.startedDateTime)))
    : 0;
  const baseB = entriesB.length
    ? Math.min(...entriesB.map(e => toMs(e.startedDateTime)))
    : 0;

  const rowsA: WaterfallEntry[] = entriesA
    .slice(0, maxRows)
    .map(e => ({
      url: e.request.url,
      method: e.request.method,
      status: e.response.status,
      relStart: toMs(e.startedDateTime) - baseA,
      duration: e.time,
      file: 'A' as const,
    }));

  const rowsB: WaterfallEntry[] = entriesB
    .slice(0, maxRows)
    .map(e => ({
      url: e.request.url,
      method: e.request.method,
      status: e.response.status,
      relStart: toMs(e.startedDateTime) - baseB,
      duration: e.time,
      file: 'B' as const,
    }));

  const maxMs = Math.max(
    ...rowsA.map(r => r.relStart + r.duration),
    ...rowsB.map(r => r.relStart + r.duration),
    1,
  );

  return { rows: [...rowsA, ...rowsB], maxMs };
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

interface DropZoneProps {
  label: string;
  fileName: string | null;
  loading: boolean;
  progress: number;
  error: string | null;
  onFile: (file: File) => void;
  accentColor: string;
}

const DropZone: React.FC<DropZoneProps> = ({
  label, fileName, loading, progress, error, onFile, accentColor,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      className={`cmp-dropzone${dragging ? ' cmp-dropzone--drag' : ''}${fileName ? ' cmp-dropzone--loaded' : ''}`}
      style={{ '--dz-accent': accentColor } as React.CSSProperties}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !loading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".har"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />

      {loading ? (
        <div className="cmp-dz-loading">
          <div className="cmp-dz-spinner" style={{ borderTopColor: accentColor }} />
          <span className="cmp-dz-label">Loading… {progress > 0 ? `${Math.round(progress)}%` : ''}</span>
          {progress > 0 && (
            <div className="cmp-dz-bar">
              <div className="cmp-dz-bar-fill" style={{ width: `${progress}%`, background: accentColor }} />
            </div>
          )}
        </div>
      ) : fileName ? (
        <div className="cmp-dz-loaded">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="cmp-dz-filename" title={fileName}>{fileName}</span>
          <span className="cmp-dz-change">Click to change</span>
        </div>
      ) : (
        <div className="cmp-dz-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="1.5" opacity="0.7">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="cmp-dz-label">{label}</span>
          <span className="cmp-dz-hint">Drop a .har file or click to browse</span>
        </div>
      )}

      {error && <div className="cmp-dz-error">{error}</div>}
    </div>
  );
};

// ─── Stats Panel ──────────────────────────────────────────────────────────────

interface StatRowProps {
  label: string;
  valA: string;
  valB: string;
  delta?: number;
  lowerIsBetter?: boolean;
}

const StatRow: React.FC<StatRowProps> = ({ label, valA, valB, delta, lowerIsBetter = true }) => (
  <div className="cmp-stat-row">
    <span className="cmp-stat-label">{label}</span>
    <span className="cmp-stat-a">{valA}</span>
    <span className="cmp-stat-b">{valB}</span>
    {delta !== undefined ? (
      <span className="cmp-stat-delta" style={{ color: deltaColor(delta, lowerIsBetter) }}>
        {delta === 0 ? '—' : deltaSign(delta)}
      </span>
    ) : <span className="cmp-stat-delta" />}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

type CompareTab = 'stats' | 'requests' | 'waterfall' | 'ai';

const HarCompare: React.FC = () => {
  const [harA, setHarA] = useState<HarFile | null>(null);
  const [harB, setHarB] = useState<HarFile | null>(null);
  const [nameA, setNameA] = useState<string | null>(null);
  const [nameB, setNameB] = useState<string | null>(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [progressA, setProgressA] = useState(0);
  const [progressB, setProgressB] = useState(0);
  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CompareTab>('stats');
  const [aiText, setAiText] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [diffFilter, setDiffFilter] = useState<'all' | 'regressions' | 'improvements' | 'new' | 'fixed'>('all');
  const aiAbortRef = useRef<AbortController | null>(null);

  const readHar = useCallback((file: File): Promise<HarFile> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const raw = JSON.parse(e.target?.result as string);
          if (!raw?.log?.entries) throw new Error('Not a valid HAR file — missing log.entries');
          resolve(raw as HarFile);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }, []);

  const loadFile = useCallback(
    async (file: File, side: 'A' | 'B') => {
      const setLoading = side === 'A' ? setLoadingA : setLoadingB;
      const setProgress = side === 'A' ? setProgressA : setProgressB;
      const setError = side === 'A' ? setErrorA : setErrorB;
      const setName = side === 'A' ? setNameA : setNameB;
      const setHar = side === 'A' ? setHarA : setHarB;

      setLoading(true);
      setError(null);
      setProgress(0);

      // Simulate progress while reading
      const ticker = setInterval(() => setProgress(p => Math.min(p + 15, 85)), 80);
      try {
        const data = await readHar(file);
        setHar(data);
        setName(file.name);
        setProgress(100);
        // Reset compare state when either file changes
        setAiText('');
        setAiError(null);
      } catch (err: any) {
        setError(err.message ?? 'Failed to parse HAR file');
      } finally {
        clearInterval(ticker);
        setLoading(false);
      }
    },
    [readHar],
  );

  // ── AI diff ──────────────────────────────────────────────────────────────────

  const runAiDiff = useCallback(async () => {
    if (!harA || !harB) return;
    if (aiAbortRef.current) aiAbortRef.current.abort();
    aiAbortRef.current = new AbortController();

    setAiLoading(true);
    setAiText('');
    setAiError(null);

    const mA = computeMetrics(harA.log.entries);
    const mB = computeMetrics(harB.log.entries);

    // ── Build rich per-file evidence for the AI ───────────────────────────────

    const buildFileEvidence = (entries: Entry[], label: string) => {
      // All failed requests with full detail
      const failed = entries
        .filter(e => e.response.status >= 400)
        .map(e => `  ${e.request.method} ${shortPath(e.request.url, 80)} → ${e.response.status} (${fmtMs(e.time)})`);

      // Slow requests (>1 s), sorted worst first
      const slow = entries
        .filter(e => e.time > 1000)
        .sort((a, b) => b.time - a.time)
        .slice(0, 8)
        .map(e => `  ${e.request.method} ${shortPath(e.request.url, 80)} — ${fmtMs(e.time)} (wait: ${fmtMs(e.timings.wait)})`);

      // Auth / identity flow requests (OAuth, SSO, login, token, callback)
      const authPattern = /oauth|sso|login|token|callback|cloudgate|identity|idcs|saml|auth/i;
      const authFlows = entries
        .filter(e => authPattern.test(e.request.url))
        .map(e => `  ${e.request.method} ${shortPath(e.request.url, 80)} → ${e.response.status} (${fmtMs(e.time)})`);

      // Domain breakdown — which Oracle services were hit
      const domainCounts: Record<string, number> = {};
      entries.forEach(e => {
        try { const h = new URL(e.request.url).hostname; domainCounts[h] = (domainCounts[h] || 0) + 1; } catch { /* */ }
      });
      const topDomains = Object.entries(domainCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([d, c]) => `  ${d} (${c} requests)`);

      // What completed successfully — top endpoints by count
      const successMap: Record<string, number> = {};
      entries
        .filter(e => e.response.status >= 200 && e.response.status < 400)
        .forEach(e => {
          try { const p = new URL(e.request.url).pathname.replace(/\/[0-9a-f-]{8,}/gi, '/{id}'); successMap[p] = (successMap[p] || 0) + 1; } catch { /* */ }
        });
      const topSuccess = Object.entries(successMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([p, c]) => `  ${p} ×${c}`);

      return [
        `=== ${label} ===`,
        `Summary: ${entries.length} requests | ${failed.length} errors | avg ${fmtMs(mA.avgTime)} | p95 ${fmtMs(mA.p95)} | ${fmtBytes(mA.totalSize)} transferred`,
        '',
        failed.length
          ? `FAILED REQUESTS (${failed.length}):\n${failed.join('\n')}`
          : 'FAILED REQUESTS: none',
        '',
        slow.length
          ? `SLOW REQUESTS >1s (${slow.length}):\n${slow.join('\n')}`
          : 'SLOW REQUESTS: none',
        '',
        authFlows.length
          ? `AUTH/SSO FLOW:\n${authFlows.join('\n')}`
          : 'AUTH/SSO FLOW: no auth requests detected',
        '',
        `TOP DOMAINS:\n${topDomains.join('\n')}`,
        '',
        topSuccess.length
          ? `SUCCESSFUL ENDPOINTS (sample):\n${topSuccess.join('\n')}`
          : '',
      ].join('\n');
    };

    const evidenceA = buildFileEvidence(harA.log.entries, `File A: ${nameA ?? 'File A'}`);

    // For file B, use mB stats in the summary line
    const buildFileBEvidence = (entries: Entry[], label: string) => {
      const failed = entries
        .filter(e => e.response.status >= 400)
        .map(e => `  ${e.request.method} ${shortPath(e.request.url, 80)} → ${e.response.status} (${fmtMs(e.time)})`);

      const slow = entries
        .filter(e => e.time > 1000)
        .sort((a, b) => b.time - a.time)
        .slice(0, 8)
        .map(e => `  ${e.request.method} ${shortPath(e.request.url, 80)} — ${fmtMs(e.time)} (wait: ${fmtMs(e.timings.wait)})`);

      const authPattern = /oauth|sso|login|token|callback|cloudgate|identity|idcs|saml|auth/i;
      const authFlows = entries
        .filter(e => authPattern.test(e.request.url))
        .map(e => `  ${e.request.method} ${shortPath(e.request.url, 80)} → ${e.response.status} (${fmtMs(e.time)})`);

      const domainCounts: Record<string, number> = {};
      entries.forEach(e => {
        try { const h = new URL(e.request.url).hostname; domainCounts[h] = (domainCounts[h] || 0) + 1; } catch { /* */ }
      });
      const topDomains = Object.entries(domainCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([d, c]) => `  ${d} (${c} requests)`);

      const successMap: Record<string, number> = {};
      entries
        .filter(e => e.response.status >= 200 && e.response.status < 400)
        .forEach(e => {
          try { const p = new URL(e.request.url).pathname.replace(/\/[0-9a-f-]{8,}/gi, '/{id}'); successMap[p] = (successMap[p] || 0) + 1; } catch { /* */ }
        });
      const topSuccess = Object.entries(successMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([p, c]) => `  ${p} ×${c}`);

      return [
        `=== ${label} ===`,
        `Summary: ${entries.length} requests | ${failed.length} errors | avg ${fmtMs(mB.avgTime)} | p95 ${fmtMs(mB.p95)} | ${fmtBytes(mB.totalSize)} transferred`,
        '',
        failed.length
          ? `FAILED REQUESTS (${failed.length}):\n${failed.join('\n')}`
          : 'FAILED REQUESTS: none',
        '',
        slow.length
          ? `SLOW REQUESTS >1s (${slow.length}):\n${slow.join('\n')}`
          : 'SLOW REQUESTS: none',
        '',
        authFlows.length
          ? `AUTH/SSO FLOW:\n${authFlows.join('\n')}`
          : 'AUTH/SSO FLOW: no auth requests detected',
        '',
        `TOP DOMAINS:\n${topDomains.join('\n')}`,
        '',
        topSuccess.length
          ? `SUCCESSFUL ENDPOINTS (sample):\n${topSuccess.join('\n')}`
          : '',
      ].join('\n');
    };

    const evidenceB = buildFileBEvidence(harB.log.entries, `File B: ${nameB ?? 'File B'}`);

    const context = `${evidenceA}\n\n${evidenceB}`;

    const systemPrompt =
      `You are an Oracle L2 Support engineer triaging a customer issue using two HAR captures.
Your job is NOT to compare numbers — it is to tell the engineer exactly what was broken, what was working, and what to check at the customer's end.

Respond using strict GitHub markdown with this exact structure:

## ❌ What was broken
List every failing/slow request by name, status, and what Oracle product/component it belongs to. State clearly what the failure means (e.g. "auth callback failed → user could not log in", "ORDS query timed out → page data did not load").

## ✅ What was working
List the Oracle services/flows that completed successfully in both files. These can be ruled out as the source of the problem.

## 🔄 What changed between A and B
Only include this section if there is a meaningful difference. State whether the issue is fixed, regressed, or new.

## 🔧 What to troubleshoot at the customer's end
Give specific, actionable steps the engineer should ask the customer to check or collect — log file paths, admin console locations, SQL queries, config keys, diagnostic levels. Name the Oracle product and exact location for each step. No vague advice.

Formatting rules:
- Use only "-" bullets and optional nested "   - " sub-bullets.
- Use **bold** for component/product names and \`code\` for endpoint paths, status codes, config keys.
- Do not use unicode bullets or emoji in bullet text.
- Max 350 words.`;

    try {
      const resp = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          messages: [{ role: 'user', content: context }],
        }),
        signal: aiAbortRef.current.signal,
      });

      if (!resp.ok) throw new Error(`AI request failed (${resp.status})`);

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content ?? '';
            if (delta) setAiText(prev => prev + delta);
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setAiError(err.message ?? 'AI analysis failed');
      }
    } finally {
      setAiLoading(false);
    }
  }, [harA, harB, nameA, nameB]);

  // ── Derived data ─────────────────────────────────────────────────────────────

  const ready = !!harA && !!harB;
  const mA = harA ? computeMetrics(harA.log.entries) : null;
  const mB = harB ? computeMetrics(harB.log.entries) : null;
  const diff = ready ? buildDiff(harA!.log.entries, harB!.log.entries) : [];

  const filteredDiff = diff.filter(row => {
    switch (diffFilter) {
      case 'regressions': return row.kind === 'both' && (row.timeB ?? 0) > (row.timeA ?? 0);
      case 'improvements': return row.kind === 'both' && (row.timeB ?? 0) < (row.timeA ?? 0);
      case 'new': return row.kind === 'only-b';
      case 'fixed': return row.kind === 'only-a';
      default: return true;
    }
  });

  const waterfall = ready ? buildWaterfall(harA!.log.entries, harB!.log.entries) : null;
  const waterfallA = waterfall?.rows.filter(r => r.file === 'A') ?? [];
  const waterfallB = waterfall?.rows.filter(r => r.file === 'B') ?? [];
  const maxMs = waterfall?.maxMs ?? 1;
  const normalizedAiText = normalizeCompareMarkdown(aiText);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="cmp-root">

      {/* Upload row */}
      <div className="cmp-upload-row">
        <DropZone
          label="File A (Baseline)"
          fileName={nameA}
          loading={loadingA}
          progress={progressA}
          error={errorA}
          onFile={f => loadFile(f, 'A')}
          accentColor="#2563eb"
        />
        <div className="cmp-vs-badge">VS</div>
        <DropZone
          label="File B (Comparison)"
          fileName={nameB}
          loading={loadingB}
          progress={progressB}
          error={errorB}
          onFile={f => loadFile(f, 'B')}
          accentColor="#d97706"
        />
      </div>

      {/* Only show tabs + content when both files are loaded */}
      {ready && (
        <>
          <div className="main-tabs cmp-tabs">
            {(['stats', 'requests', 'waterfall', 'ai'] as CompareTab[]).map(tab => (
              <button
                key={tab}
                className={`main-tab${activeTab === tab ? ' active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'stats' ? 'Stats' :
                 tab === 'requests' ? 'Request Diff' :
                 tab === 'waterfall' ? 'Waterfall' :
                 'AI Summary'}
              </button>
            ))}
          </div>

          {/* ── Stats ── */}
          {activeTab === 'stats' && mA && mB && (
            <div className="cmp-stats-panel">
              <div className="cmp-stat-header">
                <span />
                <span className="cmp-col-a">
                  <span className="cmp-dot cmp-dot-a" />
                  {nameA}
                </span>
                <span className="cmp-col-b">
                  <span className="cmp-dot cmp-dot-b" />
                  {nameB}
                </span>
                <span className="cmp-col-delta">Delta (B−A)</span>
              </div>
              <StatRow
                label="Total requests"
                valA={String(mA.totalRequests)}
                valB={String(mB.totalRequests)}
                delta={mB.totalRequests - mA.totalRequests}
                lowerIsBetter={false}
              />
              <StatRow
                label="Errors (4xx/5xx)"
                valA={`${mA.errors} (${(mA.errorRate * 100).toFixed(1)}%)`}
                valB={`${mB.errors} (${(mB.errorRate * 100).toFixed(1)}%)`}
                delta={mB.errors - mA.errors}
              />
              <StatRow
                label="Avg response time"
                valA={fmtMs(mA.avgTime)}
                valB={fmtMs(mB.avgTime)}
                delta={mB.avgTime - mA.avgTime}
              />
              <StatRow
                label="p95 latency"
                valA={fmtMs(mA.p95)}
                valB={fmtMs(mB.p95)}
                delta={mB.p95 - mA.p95}
              />
              <StatRow
                label="p99 latency"
                valA={fmtMs(mA.p99)}
                valB={fmtMs(mB.p99)}
                delta={mB.p99 - mA.p99}
              />
              <StatRow
                label="Total transfer size"
                valA={fmtBytes(mA.totalSize)}
                valB={fmtBytes(mB.totalSize)}
              />

              {/* Quick callout boxes */}
              <div className="cmp-callouts">
                {mB.errors > mA.errors && (
                  <div className="cmp-callout cmp-callout-bad">
                    <strong>⚠ More errors in B</strong>
                    <p>{mB.errors - mA.errors} additional error{mB.errors - mA.errors > 1 ? 's' : ''} compared to A. Check the Request Diff tab for details.</p>
                  </div>
                )}
                {mB.p95 > mA.p95 * 1.25 && (
                  <div className="cmp-callout cmp-callout-bad">
                    <strong>⚠ p95 latency increased {Math.round(((mB.p95 - mA.p95) / mA.p95) * 100)}%</strong>
                    <p>File B's 95th percentile latency is significantly higher. Check the Waterfall for sequential blocking chains.</p>
                  </div>
                )}
                {mB.errors < mA.errors && (
                  <div className="cmp-callout cmp-callout-good">
                    <strong>✓ Fewer errors in B</strong>
                    <p>{mA.errors - mB.errors} error{mA.errors - mB.errors > 1 ? 's' : ''} resolved compared to A.</p>
                  </div>
                )}
                {mB.p95 < mA.p95 * 0.8 && (
                  <div className="cmp-callout cmp-callout-good">
                    <strong>✓ p95 latency improved {Math.round(((mA.p95 - mB.p95) / mA.p95) * 100)}%</strong>
                    <p>File B shows significantly better tail latency.</p>
                  </div>
                )}
                {mB.errors === mA.errors && Math.abs(mB.p95 - mA.p95) < mA.p95 * 0.1 && (
                  <div className="cmp-callout cmp-callout-neutral">
                    <strong>No significant changes detected</strong>
                    <p>Both files have similar error rates and latency profiles.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Request Diff ── */}
          {activeTab === 'requests' && (
            <div className="cmp-diff-panel">
              <div className="cmp-diff-toolbar">
                <span className="cmp-diff-count">{filteredDiff.length} of {diff.length} requests</span>
                <div className="cmp-diff-filters">
                  {(['all', 'regressions', 'improvements', 'new', 'fixed'] as const).map(f => (
                    <button
                      key={f}
                      className={`cmp-filter-btn${diffFilter === f ? ' active' : ''}`}
                      onClick={() => setDiffFilter(f)}
                    >
                      {f === 'all' ? 'All' :
                       f === 'regressions' ? '▲ Slower' :
                       f === 'improvements' ? '▼ Faster' :
                       f === 'new' ? 'New in B' :
                       'Only in A'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="cmp-diff-table-wrap">
                <table className="cmp-diff-table">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>URL</th>
                      <th><span className="cmp-dot cmp-dot-a" />A Time</th>
                      <th><span className="cmp-dot cmp-dot-b" />B Time</th>
                      <th>Delta</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDiff.slice(0, 200).map((row, i) => {
                      const delta = row.timeA !== null && row.timeB !== null
                        ? row.timeB - row.timeA
                        : null;
                      return (
                        <tr
                          key={`${row.key}-${i}`}
                          className={`cmp-diff-row cmp-diff-row--${row.kind}`}
                        >
                          <td>
                            <span className={`cmp-method cmp-method--${row.method.toLowerCase()}`}>
                              {row.method}
                            </span>
                          </td>
                          <td className="cmp-url-cell" title={row.url}>{shortPath(row.url, 72)}</td>
                          <td className="cmp-time-cell">
                            {row.timeA !== null ? fmtMs(row.timeA) : <span className="cmp-absent">—</span>}
                          </td>
                          <td className="cmp-time-cell">
                            {row.timeB !== null ? fmtMs(row.timeB) : <span className="cmp-absent">—</span>}
                          </td>
                          <td className="cmp-delta-cell">
                            {delta !== null ? (
                              <span style={{ color: deltaColor(delta) }}>
                                {delta === 0 ? '±0' : deltaSign(delta)}
                              </span>
                            ) : (
                              <span className="cmp-tag cmp-tag--new">
                                {row.kind === 'only-b' ? 'new' : 'removed'}
                              </span>
                            )}
                          </td>
                          <td>
                            {row.statusA !== null && (
                              <span className={`cmp-status ${row.statusA >= 400 ? 'cmp-status--err' : ''}`}>
                                {row.statusA}
                              </span>
                            )}
                            {row.statusA !== null && row.statusB !== null && ' → '}
                            {row.statusB !== null && (
                              <span className={`cmp-status ${row.statusB >= 400 ? 'cmp-status--err' : ''}`}>
                                {row.statusB}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredDiff.length === 0 && (
                      <tr>
                        <td colSpan={6} className="cmp-empty-row">No requests match this filter.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Waterfall ── */}
          {activeTab === 'waterfall' && (
            <div className="cmp-waterfall-panel">
              <div className="cmp-waterfall-legend">
                <span><span className="cmp-dot cmp-dot-a" />{nameA}</span>
                <span><span className="cmp-dot cmp-dot-b" />{nameB}</span>
                <span className="cmp-wf-note">Showing first 40 requests per file · x-axis: ms from session start</span>
              </div>

              <div className="cmp-waterfall-cols">
                {/* File A */}
                <div className="cmp-wf-col">
                  <div className="cmp-wf-col-title" style={{ color: '#2563eb' }}>
                    <span className="cmp-dot cmp-dot-a" />{nameA}
                    <span className="cmp-wf-total">{fmtMs(Math.max(...waterfallA.map(r => r.relStart + r.duration), 0))} total</span>
                  </div>
                  <div className="cmp-wf-rows">
                    {waterfallA.map((row, i) => (
                      <div key={i} className="cmp-wf-row" title={`${row.method} ${row.url}\n${fmtMs(row.relStart)} start · ${fmtMs(row.duration)} duration · ${row.status}`}>
                        <div className="cmp-wf-label">{shortPath(row.url, 32)}</div>
                        <div className="cmp-wf-bar-track">
                          <div
                            className="cmp-wf-bar cmp-wf-bar--a"
                            style={{
                              left: `${(row.relStart / maxMs) * 100}%`,
                              width: `${Math.max((row.duration / maxMs) * 100, 0.3)}%`,
                            }}
                          />
                        </div>
                        <div className="cmp-wf-time">{fmtMs(row.duration)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* File B */}
                <div className="cmp-wf-col">
                  <div className="cmp-wf-col-title" style={{ color: '#d97706' }}>
                    <span className="cmp-dot cmp-dot-b" />{nameB}
                    <span className="cmp-wf-total">{fmtMs(Math.max(...waterfallB.map(r => r.relStart + r.duration), 0))} total</span>
                  </div>
                  <div className="cmp-wf-rows">
                    {waterfallB.map((row, i) => (
                      <div key={i} className="cmp-wf-row" title={`${row.method} ${row.url}\n${fmtMs(row.relStart)} start · ${fmtMs(row.duration)} duration · ${row.status}`}>
                        <div className="cmp-wf-label">{shortPath(row.url, 32)}</div>
                        <div className="cmp-wf-bar-track">
                          <div
                            className="cmp-wf-bar cmp-wf-bar--b"
                            style={{
                              left: `${(row.relStart / maxMs) * 100}%`,
                              width: `${Math.max((row.duration / maxMs) * 100, 0.3)}%`,
                            }}
                          />
                        </div>
                        <div className="cmp-wf-time">{fmtMs(row.duration)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── AI Summary ── */}
          {activeTab === 'ai' && (
            <div className="cmp-ai-panel">
              {!aiText && !aiLoading && !aiError && (
                <div className="cmp-ai-prompt">
                  <div className="cmp-ai-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
                      <path d="M12 6v6l4 2"/>
                    </svg>
                  </div>
                  <h3>AI Comparative Analysis</h3>
                  <p>OCA will compare both HAR files and explain what changed, why, and what to investigate.</p>
                  <button className="cmp-ai-run-btn" onClick={runAiDiff}>
                    Run AI Analysis
                  </button>
                </div>
              )}

              {aiLoading && (
                <div className="cmp-ai-loading">
                  <div className="cmp-ai-spinner" />
                  <p>OCA is analyzing the differences…</p>
                </div>
              )}

              {aiError && (
                <div className="cmp-ai-error">
                  <p>{aiError}</p>
                  <button className="cmp-ai-run-btn" onClick={runAiDiff}>Retry</button>
                </div>
              )}

              {aiText && (
                <div className="cmp-ai-result">
                  <div className="cmp-ai-result-header">
                    <span className="cmp-ai-badge">OCA Analysis</span>
                    <button className="cmp-ai-rerun" onClick={runAiDiff}>↺ Re-run</button>
                  </div>
                  <div className="cmp-ai-text">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {normalizedAiText}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Placeholder when files not loaded */}
      {!ready && !loadingA && !loadingB && (
        <div className="cmp-placeholder">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.2">
            <rect x="3" y="3" width="8" height="11" rx="1"/>
            <rect x="13" y="3" width="8" height="11" rx="1"/>
            <path d="M7 18h10M12 14v4" strokeLinecap="round"/>
          </svg>
          <p>Upload two HAR files above to compare them side by side.</p>
          <p className="cmp-placeholder-sub">Useful for: incognito vs normal, production vs UAT, before vs after a deployment.</p>
        </div>
      )}
    </div>
  );
};

export default HarCompare;


