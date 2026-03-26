
import React, { useCallback, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertIcon,
  ArrowRightLongIcon,
  CheckIcon,
  ClockIcon,
  FileIcon,
  FileTextIcon,
  LayersIcon,
  NetworkIcon,
  RefreshIcon,
  RouteIcon,
  SparklesIcon,
  UploadIcon,
} from './Icons';
import { Entry, HarFile } from '../types/har';
import { apiClient } from '../services/apiClient';

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL ||
  (import.meta as any).env?.VITE_API_URL ||
  'http://localhost:4000';

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
  if (bytes <= 0) return '-';
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
  if (delta === 0) return '0';
  return delta > 0 ? `+${fmtMs(delta)}` : `-${fmtMs(Math.abs(delta))}`;
}

function countDeltaSign(delta: number): string {
  if (delta === 0) return '0';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function percentPointDelta(delta: number): string {
  if (delta === 0) return '0.0 pts';
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)} pts`;
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
    const p = u.pathname + (u.search ? u.search.slice(0, 20) + (u.search.length > 20 ? '...' : '') : '');
    return p.length > maxLen ? '...' + p.slice(-maxLen) : p;
  } catch {
    return url.length > maxLen ? '...' + url.slice(-maxLen) : url;
  }
}

function normalizeCompareMarkdown(text: string): string {
  if (!text) return '';

  let normalized = text.replace(/\r\n/g, '\n');
  normalized = normalized.replace(
    /^[ \t]*[\u2022\u25CF\u25AA\u25B8\u25B9]?\s*#(\d+)\s*[\u2014\u2013\u2012\u2015-]\s+/gm,
    '$1. ',
  );
  normalized = normalized.replace(/^[ \t]*[\u2022\u25CF\u25AA\u25B8\u25B9]\s+/gm, '- ');
  normalized = normalized.replace(/^[ \t]*[\u25E6\u25AB\u2023]\s+/gm, '  - ');
  normalized = normalized.replace(/[ \t]+\n/g, '\n');
  normalized = normalized.replace(/\n{3,}/g, '\n\n');

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
  const sorted = [...entries].map(entry => entry.time).sort((a, b) => a - b);
  const errors = entries.filter(entry => entry.response.status >= 400).length;
  const totalSize = entries.reduce((sum, entry) => sum + Math.max(0, entry.response.bodySize), 0);
  const totalTime = entries.reduce((sum, entry) => sum + entry.time, 0);

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

  for (const entry of entriesA) {
    const key = urlKey(entry);
    if (!mapA.has(key)) mapA.set(key, []);
    mapA.get(key)!.push(entry);
  }

  for (const entry of entriesB) {
    const key = urlKey(entry);
    if (!mapB.has(key)) mapB.set(key, []);
    mapB.get(key)!.push(entry);
  }

  const rows: DiffRow[] = [];
  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

  for (const key of allKeys) {
    const entriesForA = mapA.get(key);
    const entriesForB = mapB.get(key);
    const sample = (entriesForA ?? entriesForB)![0];
    const avgTime = (items?: Entry[]) =>
      items ? items.reduce((sum, entry) => sum + entry.time, 0) / items.length : null;

    rows.push({
      key,
      url: sample.request.url,
      method: sample.request.method,
      timeA: avgTime(entriesForA),
      timeB: avgTime(entriesForB),
      statusA: entriesForA ? entriesForA[0].response.status : null,
      statusB: entriesForB ? entriesForB[0].response.status : null,
      kind: entriesForA && entriesForB ? 'both' : entriesForA ? 'only-a' : 'only-b',
    });
  }

  return rows.sort((a, b) => {
    if (a.kind === 'both' && b.kind === 'both') {
      const deltaA = (a.timeB ?? 0) - (a.timeA ?? 0);
      const deltaB = (b.timeB ?? 0) - (b.timeA ?? 0);
      return deltaB - deltaA;
    }

    const order = { both: 0, 'only-a': 1, 'only-b': 2 };
    return order[a.kind] - order[b.kind];
  });
}

interface WaterfallEntry {
  url: string;
  method: string;
  status: number;
  relStart: number;
  duration: number;
  file: 'A' | 'B';
}

function buildWaterfall(
  entriesA: Entry[],
  entriesB: Entry[],
  maxRows = 40,
): { rows: WaterfallEntry[]; maxMs: number } {
  const toMs = (dateTime: string) => new Date(dateTime).getTime();
  const baseA = entriesA.length ? Math.min(...entriesA.map(entry => toMs(entry.startedDateTime))) : 0;
  const baseB = entriesB.length ? Math.min(...entriesB.map(entry => toMs(entry.startedDateTime))) : 0;

  const rowsA: WaterfallEntry[] = entriesA.slice(0, maxRows).map(entry => ({
    url: entry.request.url,
    method: entry.request.method,
    status: entry.response.status,
    relStart: toMs(entry.startedDateTime) - baseA,
    duration: entry.time,
    file: 'A',
  }));

  const rowsB: WaterfallEntry[] = entriesB.slice(0, maxRows).map(entry => ({
    url: entry.request.url,
    method: entry.request.method,
    status: entry.response.status,
    relStart: toMs(entry.startedDateTime) - baseB,
    duration: entry.time,
    file: 'B',
  }));

  const maxMs = Math.max(
    ...rowsA.map(row => row.relStart + row.duration),
    ...rowsB.map(row => row.relStart + row.duration),
    1,
  );

  return { rows: [...rowsA, ...rowsB], maxMs };
}

type CompareTab = 'stats' | 'requests' | 'waterfall' | 'ai';

interface OpenTab {
  fileId: string;
  fileName: string;
}

interface HarCompareProps {
  openTabs?: OpenTab[];
}

interface DropZoneProps {
  title: string;
  hint: string;
  fileName: string | null;
  loading: boolean;
  progress: number;
  error: string | null;
  onFile: (file: File) => void;
  accentColor: string;
}

const DropZone: React.FC<DropZoneProps> = ({ title, hint, fileName, loading, progress, error, onFile, accentColor }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      className={`cmp-dropzone${dragging ? ' cmp-dropzone--drag' : ''}${fileName ? ' cmp-dropzone--loaded' : ''}`}
      style={{ '--dz-accent': accentColor } as React.CSSProperties}
      onDragOver={event => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !loading && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if ((event.key === 'Enter' || event.key === ' ') && !loading) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".har"
        style={{ display: 'none' }}
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />

      {loading ? (
        <div className="cmp-dz-state">
          <span className="cmp-dz-icon cmp-dz-icon--loading">
            <div className="cmp-dz-spinner" style={{ borderTopColor: accentColor }} />
          </span>
          <div className="cmp-dz-copy">
            <strong>Loading HAR</strong>
            <span>{progress > 0 ? `${Math.round(progress)}% complete` : 'Preparing the comparison file'}</span>
          </div>
          {progress > 0 && (
            <div className="cmp-dz-bar">
              <div className="cmp-dz-bar-fill" style={{ width: `${progress}%`, background: accentColor }} />
            </div>
          )}
        </div>
      ) : fileName ? (
        <div className="cmp-dz-state">
          <span className="cmp-dz-icon" style={{ color: accentColor }}>
            <CheckIcon />
          </span>
          <div className="cmp-dz-copy">
            <strong title={fileName}>{fileName}</strong>
            <span>Loaded and ready. Click to replace this HAR.</span>
          </div>
        </div>
      ) : (
        <div className="cmp-dz-state">
          <span className="cmp-dz-icon" style={{ color: accentColor }}>
            <UploadIcon />
          </span>
          <div className="cmp-dz-copy">
            <strong>{title}</strong>
            <span>{hint}</span>
          </div>
        </div>
      )}

      {error && <div className="cmp-dz-error">{error}</div>}
    </div>
  );
};

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
        {delta === 0 ? 'No change' : deltaSign(delta)}
      </span>
    ) : (
      <span className="cmp-stat-delta cmp-stat-delta--muted">Reference only</span>
    )}
  </div>
);

interface CompactFileControlProps {
  side: 'A' | 'B';
  title: string;
  fileName: string | null;
  loading: boolean;
  progress: number;
  error: string | null;
  accentColor: string;
  metrics: Metrics | null;
  openTabs: OpenTab[];
  onFile: (file: File) => void;
  onSelectOpenTab: (fileId: string, fileName: string) => void;
}

const CompactFileControl: React.FC<CompactFileControlProps> = ({ side, title, fileName, loading, progress, error, accentColor, metrics, openTabs, onFile, onSelectOpenTab }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`cmp-compact-file cmp-compact-file--${side.toLowerCase()}`}>
      <input
        ref={inputRef}
        type="file"
        accept=".har"
        style={{ display: 'none' }}
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />

      <div className="cmp-compact-file-main">
        <div className="cmp-compact-file-title">
          <span className="cmp-file-badge">{side}</span>
          <div className="cmp-compact-file-copy">
            <span className="cmp-file-role">{title}</span>
            <strong title={fileName ?? undefined}>{fileName ?? `Choose ${title.toLowerCase()}`}</strong>
          </div>
        </div>

        <div className="cmp-compact-file-meta">
          <span className={`cmp-file-state${fileName ? ' is-ready' : ''}${loading ? ' is-loading' : ''}`}>
            {loading ? (progress > 0 ? `${Math.round(progress)}%` : 'Loading') : fileName ? 'Ready' : 'Missing'}
          </span>
          {metrics && (
            <div className="cmp-compact-metrics">
              <span>{metrics.totalRequests} req</span>
              <span>{metrics.errors} err</span>
              <span>{fmtMs(metrics.totalTime)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="cmp-compact-file-actions">
        <button
          type="button"
          className="cmp-compact-action"
          onClick={() => inputRef.current?.click()}
          style={{ '--cmp-accent': accentColor } as React.CSSProperties}
        >
          <UploadIcon />
          {fileName ? 'Change' : 'Upload'}
        </button>

        {openTabs.length > 0 && (
          <select
            className="cmp-compact-select"
            value=""
            onChange={event => {
              const tab = openTabs.find(item => item.fileId === event.target.value);
              if (tab) onSelectOpenTab(tab.fileId, tab.fileName);
            }}
          >
            <option value="" disabled>Open files</option>
            {openTabs.map(tab => (
              <option key={tab.fileId} value={tab.fileId}>{tab.fileName}</option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="cmp-compact-error">{error}</div>}
    </div>
  );
};

const HarCompare: React.FC<HarCompareProps> = ({ openTabs = [] }) => {
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
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [diffFilter, setDiffFilter] = useState<'all' | 'regressions' | 'improvements' | 'new' | 'fixed'>('all');
  const aiAbortRef = useRef<AbortController | null>(null);

  const readHar = useCallback((file: File): Promise<HarFile> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => {
        try {
          const raw = JSON.parse(event.target?.result as string);
          if (!raw?.log?.entries) throw new Error('Not a valid HAR file - missing log.entries');
          resolve(raw as HarFile);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }, []);

  const loadFile = useCallback(async (file: File, side: 'A' | 'B') => {
    const setLoading = side === 'A' ? setLoadingA : setLoadingB;
    const setProgress = side === 'A' ? setProgressA : setProgressB;
    const setError = side === 'A' ? setErrorA : setErrorB;
    const setName = side === 'A' ? setNameA : setNameB;
    const setHar = side === 'A' ? setHarA : setHarB;

    setLoading(true);
    setError(null);
    setProgress(0);

    const ticker = setInterval(() => setProgress(value => Math.min(value + 15, 85)), 80);
    try {
      const data = await readHar(file);
      setHar(data);
      setName(file.name);
      setProgress(100);
      setAiText('');
      setAiError(null);
    } catch (error: any) {
      setError(error.message ?? 'Failed to parse HAR file');
    } finally {
      clearInterval(ticker);
      setLoading(false);
    }
  }, [readHar]);

  const loadFromFileId = useCallback(async (fileId: string, fileName: string, side: 'A' | 'B') => {
    const setLoading = side === 'A' ? setLoadingA : setLoadingB;
    const setProgress = side === 'A' ? setProgressA : setProgressB;
    const setError = side === 'A' ? setErrorA : setErrorB;
    const setName = side === 'A' ? setNameA : setNameB;
    const setHar = side === 'A' ? setHarA : setHarB;

    setLoading(true);
    setError(null);
    setProgress(0);
    const ticker = setInterval(() => setProgress(value => Math.min(value + 20, 85)), 80);

    try {
      const data = await apiClient.getHarData(fileId);
      setHar(data as HarFile);
      setName(fileName);
      setProgress(100);
      setAiText('');
      setAiError(null);
    } catch (error: any) {
      setError(error.message ?? 'Failed to load file from tab');
    } finally {
      clearInterval(ticker);
      setLoading(false);
    }
  }, []);

  const runAiDiff = useCallback(async () => {
    if (!harA || !harB) return;
    if (aiAbortRef.current) aiAbortRef.current.abort();
    aiAbortRef.current = new AbortController();

    setAiLoading(true);
    setAiText('');
    setAiError(null);

    const metricsA = computeMetrics(harA.log.entries);
    const metricsB = computeMetrics(harB.log.entries);

    const buildFileEvidence = (entries: Entry[], label: string, metrics: Metrics) => {
      const failed = entries
        .filter(entry => entry.response.status >= 400)
        .map(entry => `  ${entry.request.method} ${shortPath(entry.request.url, 80)} -> ${entry.response.status} (${fmtMs(entry.time)})`);

      const slow = entries
        .filter(entry => entry.time > 1000)
        .sort((a, b) => b.time - a.time)
        .slice(0, 8)
        .map(entry => `  ${entry.request.method} ${shortPath(entry.request.url, 80)} - ${fmtMs(entry.time)} (wait: ${fmtMs(entry.timings.wait)})`);

      const authPattern = /oauth|sso|login|token|callback|cloudgate|identity|idcs|saml|auth/i;
      const authFlows = entries
        .filter(entry => authPattern.test(entry.request.url))
        .map(entry => `  ${entry.request.method} ${shortPath(entry.request.url, 80)} -> ${entry.response.status} (${fmtMs(entry.time)})`);

      const domainCounts: Record<string, number> = {};
      entries.forEach(entry => {
        try {
          const hostname = new URL(entry.request.url).hostname;
          domainCounts[hostname] = (domainCounts[hostname] || 0) + 1;
        } catch {
          // Ignore invalid URLs in evidence preparation.
        }
      });

      const topDomains = Object.entries(domainCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([domain, count]) => `  ${domain} (${count} requests)`);

      const successMap: Record<string, number> = {};
      entries
        .filter(entry => entry.response.status >= 200 && entry.response.status < 400)
        .forEach(entry => {
          try {
            const path = new URL(entry.request.url).pathname.replace(/\/[0-9a-f-]{8,}/gi, '/{id}');
            successMap[path] = (successMap[path] || 0) + 1;
          } catch {
            // Ignore invalid URLs in evidence preparation.
          }
        });

      const topSuccess = Object.entries(successMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([path, count]) => `  ${path} x${count}`);

      return [
        `=== ${label} ===`,
        `Summary: ${entries.length} requests | ${failed.length} errors | avg ${fmtMs(metrics.avgTime)} | p95 ${fmtMs(metrics.p95)} | ${fmtBytes(metrics.totalSize)} transferred`,
        '',
        failed.length ? `FAILED REQUESTS (${failed.length}):\n${failed.join('\n')}` : 'FAILED REQUESTS: none',
        '',
        slow.length ? `SLOW REQUESTS >1s (${slow.length}):\n${slow.join('\n')}` : 'SLOW REQUESTS: none',
        '',
        authFlows.length ? `AUTH OR SSO FLOW:\n${authFlows.join('\n')}` : 'AUTH OR SSO FLOW: no auth requests detected',
        '',
        `TOP DOMAINS:\n${topDomains.join('\n')}`,
        '',
        topSuccess.length ? `SUCCESSFUL ENDPOINTS (sample):\n${topSuccess.join('\n')}` : '',
      ].join('\n');
    };

    const evidenceA = buildFileEvidence(harA.log.entries, `File A: ${nameA ?? 'File A'}`, metricsA);
    const evidenceB = buildFileEvidence(harB.log.entries, `File B: ${nameB ?? 'File B'}`, metricsB);
    const context = `${evidenceA}\n\n${evidenceB}`;

    const systemPrompt = `You are an Oracle L2 Support engineer triaging a customer issue using two HAR captures.
Your job is not to compare numbers. Tell the engineer what was broken, what was working, and what to check at the customer's end.

Respond using strict GitHub markdown with this exact structure:

## What was broken
List every failing or slow request by name, status, and Oracle product or component. State clearly what the failure means.

## What was working
List the Oracle services or flows that completed successfully in both files. These can be ruled out as the source of the problem.

## What changed between A and B
Only include this section if there is a meaningful difference. State whether the issue is fixed, regressed, or new.

## What to troubleshoot at the customer's end
Give specific, actionable steps the engineer should ask the customer to check or collect. Name the Oracle product and exact location for each step.

Formatting rules:
- Use only "-" bullets and optional nested "   - " sub-bullets.
- Use **bold** for component or product names and \`code\` for endpoint paths, status codes, and config keys.
- Do not use unicode bullets or emoji in bullet text.
- Max 350 words.`;

    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt, messages: [{ role: 'user', content: context }] }),
        signal: aiAbortRef.current.signal,
      });

      if (!response.ok) throw new Error(`AI request failed (${response.status})`);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content ?? '';
            if (delta) setAiText(previous => previous + delta);
          } catch {
            // Ignore malformed SSE chunks.
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setAiError(error.message ?? 'AI analysis failed');
      }
    } finally {
      setAiLoading(false);
    }
  }, [harA, harB, nameA, nameB]);

  const ready = !!harA && !!harB;
  const metricsA = harA ? computeMetrics(harA.log.entries) : null;
  const metricsB = harB ? computeMetrics(harB.log.entries) : null;
  const diff = ready ? buildDiff(harA!.log.entries, harB!.log.entries) : [];

  const filteredDiff = diff.filter(row => {
    switch (diffFilter) {
      case 'regressions':
        return row.kind === 'both' && (row.timeB ?? 0) > (row.timeA ?? 0);
      case 'improvements':
        return row.kind === 'both' && (row.timeB ?? 0) < (row.timeA ?? 0);
      case 'new':
        return row.kind === 'only-b';
      case 'fixed':
        return row.kind === 'only-a';
      default:
        return true;
    }
  });

  const waterfall = ready ? buildWaterfall(harA!.log.entries, harB!.log.entries) : null;
  const waterfallA = waterfall?.rows.filter(row => row.file === 'A') ?? [];
  const waterfallB = waterfall?.rows.filter(row => row.file === 'B') ?? [];
  const maxMs = waterfall?.maxMs ?? 1;
  const normalizedAiText = normalizeCompareMarkdown(aiText);

  const compareTabs: Array<{ id: CompareTab; label: string; icon: React.ComponentType }> = [
    { id: 'stats', label: 'Stats', icon: LayersIcon },
    { id: 'requests', label: 'Request Diff', icon: NetworkIcon },
    { id: 'waterfall', label: 'Waterfall', icon: RouteIcon },
    { id: 'ai', label: 'AI Summary', icon: SparklesIcon },
  ];

  const diffSummary = {
    regressions: diff.filter(row => row.kind === 'both' && (row.timeB ?? 0) > (row.timeA ?? 0)).length,
    improvements: diff.filter(row => row.kind === 'both' && (row.timeB ?? 0) < (row.timeA ?? 0)).length,
    newInB: diff.filter(row => row.kind === 'only-b').length,
    onlyInA: diff.filter(row => row.kind === 'only-a').length,
  };

  const statHighlights = metricsA && metricsB ? [
    { label: 'Avg response', valueA: fmtMs(metricsA.avgTime), valueB: fmtMs(metricsB.avgTime), delta: deltaSign(metricsB.avgTime - metricsA.avgTime), tone: deltaColor(metricsB.avgTime - metricsA.avgTime) },
    { label: 'Error rate', valueA: `${(metricsA.errorRate * 100).toFixed(1)}%`, valueB: `${(metricsB.errorRate * 100).toFixed(1)}%`, delta: percentPointDelta((metricsB.errorRate - metricsA.errorRate) * 100), tone: deltaColor(metricsB.errorRate - metricsA.errorRate) },
    { label: 'p95 latency', valueA: fmtMs(metricsA.p95), valueB: fmtMs(metricsB.p95), delta: deltaSign(metricsB.p95 - metricsA.p95), tone: deltaColor(metricsB.p95 - metricsA.p95) },
    { label: 'Request volume', valueA: String(metricsA.totalRequests), valueB: String(metricsB.totalRequests), delta: countDeltaSign(metricsB.totalRequests - metricsA.totalRequests), tone: 'var(--text-secondary)' },
  ] : [];

  const heroSummary = metricsA && metricsB ? [
    { label: 'Compared requests', value: `${metricsA.totalRequests + metricsB.totalRequests}` },
    { label: 'Error delta', value: countDeltaSign(metricsB.errors - metricsA.errors) },
    { label: 'p95 delta', value: deltaSign(metricsB.p95 - metricsA.p95) },
  ] : [
    { label: 'Workspace', value: 'Dual HAR compare' },
    { label: 'Views', value: 'Stats, Diff, Waterfall, AI' },
    { label: 'Best for', value: 'Before vs after, prod vs UAT' },
  ];

  const callouts: Array<{ tone: 'bad' | 'good' | 'neutral'; title: string; body: string }> = [];
  if (metricsA && metricsB) {
    if (metricsB.errors > metricsA.errors) {
      callouts.push({ tone: 'bad', title: 'More errors in File B', body: `${metricsB.errors - metricsA.errors} additional error${metricsB.errors - metricsA.errors > 1 ? 's' : ''} were introduced. Inspect Request Diff for the affected endpoints.` });
    }
    if (metricsB.p95 > metricsA.p95 * 1.25) {
      callouts.push({ tone: 'bad', title: `Tail latency increased ${Math.round(((metricsB.p95 - metricsA.p95) / metricsA.p95) * 100)}%`, body: 'File B has a noticeably slower long tail. The Waterfall view should help expose blocking chains or late-loading requests.' });
    }
    if (metricsB.errors < metricsA.errors) {
      callouts.push({ tone: 'good', title: 'Error volume improved in File B', body: `${metricsA.errors - metricsB.errors} error${metricsA.errors - metricsB.errors > 1 ? 's' : ''} were resolved compared with the baseline capture.` });
    }
    if (metricsB.p95 < metricsA.p95 * 0.8) {
      callouts.push({ tone: 'good', title: `Tail latency improved ${Math.round(((metricsA.p95 - metricsB.p95) / metricsA.p95) * 100)}%`, body: 'File B is handling slower requests much better. This looks like a meaningful performance win.' });
    }
    if (callouts.length === 0) {
      callouts.push({ tone: 'neutral', title: 'No major regression signals', body: 'Both files are tracking closely across error rate and latency, so the change looks broadly stable.' });
    }
  }

  const totalA = Math.max(...waterfallA.map(row => row.relStart + row.duration), 0);
  const totalB = Math.max(...waterfallB.map(row => row.relStart + row.duration), 0);

  return (
    <div className="cmp-root">
      {!ready && (
        <>
          <section className="cmp-hero">
            <div className="cmp-hero-copy">
              <span className="cmp-hero-kicker">Premium comparison workspace</span>
              <h2>Compare two captures with a clearer executive lens</h2>
              <p>Load a baseline and a comparison HAR, then move through stats, request deltas, waterfalls, and AI guidance without leaving the same workspace.</p>
            </div>

            <div className="cmp-hero-summary">
              {heroSummary.map(item => (
                <div key={item.label} className="cmp-hero-pill">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="cmp-upload-stage">
            <div className="cmp-upload-row">
              <div className="cmp-file-card cmp-file-card--a">
                <div className="cmp-file-card-head">
                  <div className="cmp-file-card-title">
                    <span className="cmp-file-badge">A</span>
                    <div>
                      <span className="cmp-file-role">Baseline capture</span>
                      <h3>File A</h3>
                    </div>
                  </div>
                  <span className={`cmp-file-state${nameA ? ' is-ready' : ''}${loadingA ? ' is-loading' : ''}`}>
                    {loadingA ? 'Loading' : nameA ? 'Ready' : 'Awaiting HAR'}
                  </span>
                </div>

                <DropZone title="Upload baseline HAR" hint="Drag a capture here or click to browse" fileName={nameA} loading={loadingA} progress={progressA} error={errorA} onFile={file => loadFile(file, 'A')} accentColor="#2563eb" />

                <div className="cmp-file-card-foot">
                  {metricsA ? (
                    <div className="cmp-file-metrics">
                      <span>{metricsA.totalRequests} requests</span>
                      <span>{metricsA.errors} errors</span>
                      <span>{fmtMs(metricsA.totalTime)} total</span>
                    </div>
                  ) : (
                    <p className="cmp-file-helper">Use this side as the reference capture for regressions, fixes, and request timing changes.</p>
                  )}

                  {openTabs.length > 0 && (
                    <div className="cmp-tab-select-row">
                      <span className="cmp-tab-select-label">Select from open files</span>
                      <select className="cmp-tab-select" value="" onChange={event => {
                        const tab = openTabs.find(item => item.fileId === event.target.value);
                        if (tab) loadFromFileId(tab.fileId, tab.fileName, 'A');
                      }}>
                        <option value="" disabled>Choose a file</option>
                        {openTabs.map(tab => <option key={tab.fileId} value={tab.fileId}>{tab.fileName}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div className="cmp-compare-token" aria-hidden="true">
                <span className="cmp-compare-token-line" />
                <span className="cmp-compare-token-pill"><ArrowRightLongIcon /></span>
                <span className="cmp-compare-token-copy">Baseline to comparison</span>
              </div>

              <div className="cmp-file-card cmp-file-card--b">
                <div className="cmp-file-card-head">
                  <div className="cmp-file-card-title">
                    <span className="cmp-file-badge">B</span>
                    <div>
                      <span className="cmp-file-role">Comparison capture</span>
                      <h3>File B</h3>
                    </div>
                  </div>
                  <span className={`cmp-file-state${nameB ? ' is-ready' : ''}${loadingB ? ' is-loading' : ''}`}>
                    {loadingB ? 'Loading' : nameB ? 'Ready' : 'Awaiting HAR'}
                  </span>
                </div>

                <DropZone title="Upload comparison HAR" hint="Load the version you want to measure against the baseline" fileName={nameB} loading={loadingB} progress={progressB} error={errorB} onFile={file => loadFile(file, 'B')} accentColor="#d97706" />

                <div className="cmp-file-card-foot">
                  {metricsB ? (
                    <div className="cmp-file-metrics">
                      <span>{metricsB.totalRequests} requests</span>
                      <span>{metricsB.errors} errors</span>
                      <span>{fmtMs(metricsB.totalTime)} total</span>
                    </div>
                  ) : (
                    <p className="cmp-file-helper">Load the new capture here to spot regressions, improvements, and newly introduced requests.</p>
                  )}

                  {openTabs.length > 0 && (
                    <div className="cmp-tab-select-row">
                      <span className="cmp-tab-select-label">Select from open files</span>
                      <select className="cmp-tab-select" value="" onChange={event => {
                        const tab = openTabs.find(item => item.fileId === event.target.value);
                        if (tab) loadFromFileId(tab.fileId, tab.fileName, 'B');
                      }}>
                        <option value="" disabled>Choose a file</option>
                        {openTabs.map(tab => <option key={tab.fileId} value={tab.fileId}>{tab.fileName}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {ready && (
        <>
          <section className="cmp-sticky-rail">
            <div className="cmp-sticky-rail-top">
              <div className="cmp-sticky-copy">
                <span className="cmp-hero-kicker">Compare workspace</span>
                <h2>Compare captures</h2>
                <p>Switch files or tabs without losing your place in the analysis.</p>
              </div>

              <div className="cmp-sticky-summary">
                {heroSummary.map(item => (
                  <div key={item.label} className="cmp-sticky-pill">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="cmp-sticky-controls">
              <CompactFileControl side="A" title="Baseline capture" fileName={nameA} loading={loadingA} progress={progressA} error={errorA} accentColor="#2563eb" metrics={metricsA} openTabs={openTabs} onFile={file => loadFile(file, 'A')} onSelectOpenTab={(fileId, fileName) => loadFromFileId(fileId, fileName, 'A')} />

              <div className="cmp-sticky-relation" aria-hidden="true">
                <span className="cmp-sticky-relation-pill"><ArrowRightLongIcon /></span>
                <span className="cmp-sticky-relation-copy">A to B</span>
              </div>

              <CompactFileControl side="B" title="Comparison capture" fileName={nameB} loading={loadingB} progress={progressB} error={errorB} accentColor="#d97706" metrics={metricsB} openTabs={openTabs} onFile={file => loadFile(file, 'B')} onSelectOpenTab={(fileId, fileName) => loadFromFileId(fileId, fileName, 'B')} />
            </div>

            <div className="cmp-nav-shell cmp-nav-shell--sticky">
              <div className="main-tabs cmp-tabs">
                {compareTabs.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <button key={tab.id} className={`main-tab${activeTab === tab.id ? ' active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                      <span className="cmp-tab-icon"><Icon /></span>
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {activeTab === 'stats' && metricsA && metricsB && (
            <section className="cmp-view-shell">
              <div className="cmp-view-header">
                <div>
                  <span className="cmp-view-kicker">Executive compare</span>
                  <h3>Stats overview</h3>
                  <p>See the biggest movement in request volume, error rate, and long-tail latency before diving into endpoint-level diffs.</p>
                </div>
              </div>

              <div className="cmp-highlight-grid">
                {statHighlights.map(item => (
                  <div key={item.label} className="cmp-highlight-card">
                    <span className="cmp-highlight-label">{item.label}</span>
                    <div className="cmp-highlight-values">
                      <div><span className="cmp-highlight-side">A</span><strong>{item.valueA}</strong></div>
                      <div><span className="cmp-highlight-side">B</span><strong>{item.valueB}</strong></div>
                    </div>
                    <span className="cmp-highlight-delta" style={{ color: item.tone }}>{item.delta}</span>
                  </div>
                ))}
              </div>

              <div className="cmp-stats-panel">
                <div className="cmp-panel-head">
                  <div>
                    <span className="cmp-panel-kicker">Side-by-side metrics</span>
                    <h4>Performance and stability deltas</h4>
                  </div>
                  <div className="cmp-panel-files">
                    <span className="cmp-panel-file cmp-panel-file--a"><span className="cmp-dot cmp-dot-a" />{nameA}</span>
                    <span className="cmp-panel-file cmp-panel-file--b"><span className="cmp-dot cmp-dot-b" />{nameB}</span>
                  </div>
                </div>

                <div className="cmp-stat-header">
                  <span>Metric</span>
                  <span className="cmp-col-a">File A</span>
                  <span className="cmp-col-b">File B</span>
                  <span className="cmp-col-delta">Delta (B-A)</span>
                </div>

                <StatRow label="Total requests" valA={String(metricsA.totalRequests)} valB={String(metricsB.totalRequests)} delta={metricsB.totalRequests - metricsA.totalRequests} lowerIsBetter={false} />
                <StatRow label="Errors (4xx/5xx)" valA={`${metricsA.errors} (${(metricsA.errorRate * 100).toFixed(1)}%)`} valB={`${metricsB.errors} (${(metricsB.errorRate * 100).toFixed(1)}%)`} delta={metricsB.errors - metricsA.errors} />
                <StatRow label="Avg response time" valA={fmtMs(metricsA.avgTime)} valB={fmtMs(metricsB.avgTime)} delta={metricsB.avgTime - metricsA.avgTime} />
                <StatRow label="p95 latency" valA={fmtMs(metricsA.p95)} valB={fmtMs(metricsB.p95)} delta={metricsB.p95 - metricsA.p95} />
                <StatRow label="p99 latency" valA={fmtMs(metricsA.p99)} valB={fmtMs(metricsB.p99)} delta={metricsB.p99 - metricsA.p99} />
                <StatRow label="Total transfer size" valA={fmtBytes(metricsA.totalSize)} valB={fmtBytes(metricsB.totalSize)} />

                <div className="cmp-callouts">
                  {callouts.map(item => (
                    <div key={item.title} className={`cmp-callout cmp-callout-${item.tone}`}>
                      <span className="cmp-callout-icon">{item.tone === 'good' ? <CheckIcon /> : item.tone === 'bad' ? <AlertIcon /> : <ClockIcon />}</span>
                      <div><strong>{item.title}</strong><p>{item.body}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {activeTab === 'requests' && (
            <section className="cmp-view-shell">
              <div className="cmp-view-header"><div><span className="cmp-view-kicker">Analyst view</span><h3>Request diff</h3><p>Filter for regressions, improvements, and file-specific requests to isolate exactly what changed between the two captures.</p></div></div>
              <div className="cmp-diff-summary">
                <div className="cmp-diff-summary-card"><span>Regressions</span><strong>{diffSummary.regressions}</strong></div>
                <div className="cmp-diff-summary-card"><span>Improvements</span><strong>{diffSummary.improvements}</strong></div>
                <div className="cmp-diff-summary-card"><span>New in B</span><strong>{diffSummary.newInB}</strong></div>
                <div className="cmp-diff-summary-card"><span>Only in A</span><strong>{diffSummary.onlyInA}</strong></div>
              </div>
              <div className="cmp-diff-panel">
                <div className="cmp-panel-head cmp-panel-head--toolbar">
                  <div><span className="cmp-panel-kicker">Filtered diff table</span><h4>{filteredDiff.length} of {diff.length} requests in view</h4></div>
                  <div className="cmp-diff-filters">
                    {(['all', 'regressions', 'improvements', 'new', 'fixed'] as const).map(filter => (
                      <button key={filter} className={`cmp-filter-btn${diffFilter === filter ? ' active' : ''}`} onClick={() => setDiffFilter(filter)}>
                        {filter === 'all' ? 'All' : filter === 'regressions' ? 'Slower' : filter === 'improvements' ? 'Faster' : filter === 'new' ? 'New in B' : 'Only in A'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="cmp-diff-table-wrap">
                  <table className="cmp-diff-table">
                    <thead><tr><th>Method</th><th>URL</th><th><span className="cmp-dot cmp-dot-a" />A Time</th><th><span className="cmp-dot cmp-dot-b" />B Time</th><th>Delta</th><th>Status</th></tr></thead>
                    <tbody>
                      {filteredDiff.slice(0, 200).map((row, index) => {
                        const delta = row.timeA !== null && row.timeB !== null ? row.timeB - row.timeA : null;
                        return (
                          <tr key={`${row.key}-${index}`} className={`cmp-diff-row cmp-diff-row--${row.kind}`}>
                            <td><span className={`cmp-method cmp-method--${row.method.toLowerCase()}`}>{row.method}</span></td>
                            <td className="cmp-url-cell" title={row.url}>{shortPath(row.url, 72)}</td>
                            <td className="cmp-time-cell">{row.timeA !== null ? fmtMs(row.timeA) : <span className="cmp-absent">-</span>}</td>
                            <td className="cmp-time-cell">{row.timeB !== null ? fmtMs(row.timeB) : <span className="cmp-absent">-</span>}</td>
                            <td className="cmp-delta-cell">{delta !== null ? <span style={{ color: deltaColor(delta) }}>{delta === 0 ? 'No change' : deltaSign(delta)}</span> : <span className="cmp-tag cmp-tag--new">{row.kind === 'only-b' ? 'new' : 'removed'}</span>}</td>
                            <td>
                              <div className="cmp-status-stack">
                                {row.statusA !== null && <span className={`cmp-status ${row.statusA >= 400 ? 'cmp-status--err' : ''}`}>{row.statusA}</span>}
                                {row.statusA !== null && row.statusB !== null && <span className="cmp-status-sep"><ArrowRightLongIcon /></span>}
                                {row.statusB !== null && <span className={`cmp-status ${row.statusB >= 400 ? 'cmp-status--err' : ''}`}>{row.statusB}</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredDiff.length === 0 && <tr><td colSpan={6} className="cmp-empty-row">No requests match this filter.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'waterfall' && (
            <section className="cmp-view-shell">
              <div className="cmp-view-header"><div><span className="cmp-view-kicker">Sequence analysis</span><h3>Waterfall compare</h3><p>Inspect the first 40 requests per file to see whether the comparison file is shifting start times, extending waits, or building longer chains.</p></div></div>
              <div className="cmp-waterfall-panel">
                <div className="cmp-panel-head cmp-panel-head--waterfall">
                  <div><span className="cmp-panel-kicker">Side-by-side waterfalls</span><h4>Relative start time from session origin</h4></div>
                  <div className="cmp-waterfall-legend">
                    <span><span className="cmp-dot cmp-dot-a" />{nameA}</span>
                    <span><span className="cmp-dot cmp-dot-b" />{nameB}</span>
                    <span className="cmp-wf-note">Showing first 40 requests per file</span>
                  </div>
                </div>
                <div className="cmp-waterfall-cols">
                  <div className="cmp-wf-col">
                    <div className="cmp-wf-col-title"><span className="cmp-panel-file cmp-panel-file--a"><span className="cmp-dot cmp-dot-a" />{nameA}</span><span className="cmp-wf-total">{fmtMs(totalA)} total</span></div>
                    <div className="cmp-wf-rows">
                      {waterfallA.map((row, index) => (
                        <div key={index} className="cmp-wf-row" title={`${row.method} ${row.url}\n${fmtMs(row.relStart)} start | ${fmtMs(row.duration)} duration | ${row.status}`}>
                          <div className="cmp-wf-label">{shortPath(row.url, 32)}</div>
                          <div className="cmp-wf-bar-track"><div className="cmp-wf-bar cmp-wf-bar--a" style={{ left: `${(row.relStart / maxMs) * 100}%`, width: `${Math.max((row.duration / maxMs) * 100, 0.3)}%` }} /></div>
                          <div className="cmp-wf-time">{fmtMs(row.duration)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="cmp-wf-col">
                    <div className="cmp-wf-col-title"><span className="cmp-panel-file cmp-panel-file--b"><span className="cmp-dot cmp-dot-b" />{nameB}</span><span className="cmp-wf-total">{fmtMs(totalB)} total</span></div>
                    <div className="cmp-wf-rows">
                      {waterfallB.map((row, index) => (
                        <div key={index} className="cmp-wf-row" title={`${row.method} ${row.url}\n${fmtMs(row.relStart)} start | ${fmtMs(row.duration)} duration | ${row.status}`}>
                          <div className="cmp-wf-label">{shortPath(row.url, 32)}</div>
                          <div className="cmp-wf-bar-track"><div className="cmp-wf-bar cmp-wf-bar--b" style={{ left: `${(row.relStart / maxMs) * 100}%`, width: `${Math.max((row.duration / maxMs) * 100, 0.3)}%` }} /></div>
                          <div className="cmp-wf-time">{fmtMs(row.duration)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'ai' && (
            <section className="cmp-view-shell">
              <div className="cmp-view-header"><div><span className="cmp-view-kicker">AI assistance</span><h3>OCA summary</h3><p>Generate a guided narrative for what broke, what stayed healthy, and what the support engineer should verify next.</p></div></div>
              <div className="cmp-ai-panel">
                {!aiText && !aiLoading && !aiError && (
                  <div className="cmp-ai-prompt">
                    <div className="cmp-ai-hero">
                      <span className="cmp-ai-icon"><SparklesIcon /></span>
                      <div>
                        <span className="cmp-panel-kicker">Oracle compare assist</span>
                        <h4>Generate an AI comparison brief</h4>
                        <p>OCA will compare both HAR files and summarize what changed, what still looks healthy, and what to investigate next.</p>
                      </div>
                    </div>
                    <div className="cmp-ai-facts">
                      <div className="cmp-ai-fact"><span>Requests reviewed</span><strong>{diff.length}</strong></div>
                      <div className="cmp-ai-fact"><span>Baseline errors</span><strong>{metricsA?.errors ?? 0}</strong></div>
                      <div className="cmp-ai-fact"><span>Comparison errors</span><strong>{metricsB?.errors ?? 0}</strong></div>
                    </div>
                    <button className="cmp-ai-run-btn" onClick={runAiDiff}><SparklesIcon />Run AI Analysis</button>
                  </div>
                )}

                {aiLoading && (
                  <div className="cmp-ai-loading"><div className="cmp-ai-spinner" /><p>OCA is analyzing the differences between both captures.</p></div>
                )}

                {aiError && (
                  <div className="cmp-ai-error">
                    <span className="cmp-ai-error-icon"><AlertIcon /></span>
                    <p>{aiError}</p>
                    <button className="cmp-ai-run-btn" onClick={runAiDiff}><RefreshIcon />Retry</button>
                  </div>
                )}

                {aiText && (
                  <div className="cmp-ai-result">
                    <div className="cmp-ai-result-header">
                      <span className="cmp-ai-badge">OCA Analysis</span>
                      <button className="cmp-ai-rerun" onClick={runAiDiff}><RefreshIcon />Re-run</button>
                    </div>
                    <div className="cmp-ai-text"><ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizedAiText}</ReactMarkdown></div>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {!ready && !loadingA && !loadingB && (
        <div className="cmp-placeholder">
          <div className="cmp-placeholder-icon"><LayersIcon /></div>
          <h3>Load two HAR files to unlock the compare workspace</h3>
          <p>Great for before-and-after validation, incognito versus normal sessions, or comparing production with UAT in one place.</p>
          <div className="cmp-placeholder-grid">
            <div className="cmp-placeholder-card"><span className="cmp-placeholder-card-icon"><FileIcon /></span><strong>Baseline vs comparison</strong><span>Measure regressions and improvements side by side.</span></div>
            <div className="cmp-placeholder-card"><span className="cmp-placeholder-card-icon"><FileTextIcon /></span><strong>Request-by-request diff</strong><span>Filter new, fixed, slower, and faster requests instantly.</span></div>
            <div className="cmp-placeholder-card"><span className="cmp-placeholder-card-icon"><SparklesIcon /></span><strong>AI investigation summary</strong><span>Get a support-ready narrative once both captures are loaded.</span></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HarCompare;
