// src/hooks/useConsoleLogInsights.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConsoleLogFile } from '../types/consolelog';
import { InsightFinding, InsightHealth, InsightSection, InsightsResult } from './useInsights';

export type { InsightFinding, InsightHealth, InsightSection, InsightsResult };

interface UseConsoleLogInsightsReturn {
  insights: InsightsResult | null;
  isGenerating: boolean;
  error: string | null;
  generate: () => void;
  cancel: () => void;
}

const insightsCache = new Map<string, InsightsResult>();

// Regex that matches a 3-digit HTTP status code in a log message.
// Looks for patterns like: "500", "status: 503", "HTTP/1.1 404", "statusCode=401", etc.
const HTTP_STATUS_RE = /\b([45]\d{2})\b/;

export function buildConsoleLogContext(logData: ConsoleLogFile): string {
  const entries = logData.entries;
  const total = entries.length;
  const getEvidenceText = (entry: { rawText?: string; message: string; stackTrace?: string }) =>
    entry.rawText || [entry.message, entry.stackTrace].filter(Boolean).join('\n');

  // ── Level counts ────────────────────────────────────────────────────────────
  const levelCounts: Record<string, number> = {};
  for (const e of entries) {
    levelCounts[e.level] = (levelCounts[e.level] || 0) + 1;
  }

  // ── Source module frequency ─────────────────────────────────────────────────
  const sourceCounts: Record<string, number> = {};
  for (const e of entries) {
    if (e.source) sourceCounts[e.source] = (sourceCounts[e.source] || 0) + 1;
  }
  const topSources = Object.entries(sourceCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([src, cnt]) => `${src}: ${cnt}`);

  // ── HTTP status extraction from log messages (5xx → 4xx priority) ───────────
  // Many Oracle products log HTTP status codes inside error/warn messages.
  // We surface these explicitly so the AI analyses server-side failures first.
  const errorAndWarnEntries = entries.filter((e) => e.level === 'error' || e.level === 'warn');

  const http5xxEntries = errorAndWarnEntries.filter((e) => {
    const match = HTTP_STATUS_RE.exec(getEvidenceText(e));
    return match ? parseInt(match[1], 10) >= 500 : false;
  });

  const http4xxEntries = errorAndWarnEntries.filter((e) => {
    const match = HTTP_STATUS_RE.exec(getEvidenceText(e));
    if (!match) return false;
    const code = parseInt(match[1], 10);
    return code >= 400 && code < 500;
  });

  // ── All errors: non-HTTP errors last (after HTTP-status-bearing ones) ───────
  const errorEntries = entries.filter((e) => e.level === 'error');
  // Entries that don't already appear in the 5xx/4xx buckets
  const http5xxSet = new Set(http5xxEntries.map((e) => getEvidenceText(e)));
  const http4xxSet = new Set(http4xxEntries.map((e) => getEvidenceText(e)));
  const remainingErrors = errorEntries.filter(
    (e) => !http5xxSet.has(getEvidenceText(e)) && !http4xxSet.has(getEvidenceText(e))
  );

  const formatError = (
    e: {
      level: string;
      source?: string;
      message: string;
      rawText?: string;
      stackTrace?: string;
      issueTags: string[];
    },
  ) => {
    const src = e.source ? ` [${e.source}]` : '';
    const issueTags = e.issueTags.length > 0 ? ` [${e.issueTags.join(', ')}]` : '';
    const evidence = getEvidenceText(e).substring(0, 320);
    return `${e.level.toUpperCase()}${src}${issueTags}: ${e.message}\n  Evidence: ${evidence}`;
  };

  const http5xxLines  = http5xxEntries.slice(0, 10).map(formatError);
  const http4xxLines  = http4xxEntries.slice(0, 10).map(formatError);
  const remainingErrorLines = remainingErrors.map(formatError);

  // ── Warnings (up to 30) ─────────────────────────────────────────────────────
  const warnEntries = entries.filter((e) => e.level === 'warn');
  const warnLines = warnEntries.slice(0, 30).map((e) => {
    const src = e.source ? ` [${e.source}]` : '';
    const issueTags = e.issueTags.length > 0 ? ` [${e.issueTags.join(', ')}]` : '';
    return `WARN${src}${issueTags}: ${getEvidenceText(e).substring(0, 260)}`;
  });

  // ── Repeated message patterns ───────────────────────────────────────────────
  const msgCounts = new Map<string, number>();
  for (const e of entries) {
    const key = getEvidenceText(e).substring(0, 120);
    msgCounts.set(key, (msgCounts.get(key) || 0) + 1);
  }
  const repeatedMessages = Array.from(msgCounts.entries())
    .filter(([, count]) => count > 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([msg, count]) => `x${count}: ${msg}`);

  // ── Action chain failures (VB-specific) ─────────────────────────────────────
  const chainFailures = entries
    .filter((e) => {
      const evidence = getEvidenceText(e).toLowerCase();
      return e.level === 'error' && evidence.includes('chain') && evidence.includes('fail');
    })
    .slice(0, 10)
    .map((e) => getEvidenceText(e).substring(0, 200));

  // ── REST / API errors ────────────────────────────────────────────────────────
  const apiErrors = entries
    .filter((e) => {
      const evidence = getEvidenceText(e).toLowerCase();
      return (
        (e.level === 'error' || e.level === 'warn' || e.issueTags.includes('cors') || e.issueTags.includes('network')) &&
        (evidence.includes('fetch') ||
          evidence.includes('rest') ||
          evidence.includes('json') ||
          evidence.includes('response') ||
          evidence.includes('api') ||
          evidence.includes('status') ||
          e.issueTags.includes('browser-policy'))
      );
    })
    .slice(0, 15)
    .map((e) => `[${e.level.toUpperCase()}] ${getEvidenceText(e).substring(0, 240)}`);

  const issueSummary = entries.reduce<Record<string, number>>((acc, entry) => {
    entry.issueTags.forEach((tag) => {
      acc[tag] = (acc[tag] || 0) + 1;
    });
    return acc;
  }, {});

  // ── Unique source modules ────────────────────────────────────────────────────
  const uniqueModules = [...new Set(
    entries.map((e) => e.source).filter(Boolean)
  )].slice(0, 30);

  // ── Build context string — ordered: 5xx → 4xx → other errors → warnings ─────
  const levelSummary = Object.entries(levelCounts)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');

  const parts: string[] = [
    `CONSOLE LOG SUMMARY: total:${total} ${levelSummary}`,
    `FILE: ${logData.metadata.fileName}`,
  ];

  if (uniqueModules.length > 0) {
    parts.push(`MODULES (${uniqueModules.length} unique):\n${uniqueModules.slice(0, 20).join('\n')}`);
  }

  if (topSources.length > 0) {
    parts.push(`TOP SOURCES BY FREQUENCY:\n${topSources.join('\n')}`);
  }

  if (Object.keys(issueSummary).length > 0) {
    const issueLines = Object.entries(issueSummary)
      .sort(([, a], [, b]) => b - a)
      .map(([tag, count]) => `${tag}: ${count}`);
    parts.push(`INFERRED ISSUE TAGS:\n${issueLines.join('\n')}`);
  }

  // HTTP 5xx — highest priority block
  if (http5xxLines.length > 0) {
    parts.push(`HTTP 5XX SERVER ERRORS IN LOGS (${http5xxEntries.length} total — analyse first):\n${http5xxLines.join('\n')}`);
  }

  // HTTP 4xx — second priority block
  if (http4xxLines.length > 0) {
    parts.push(`HTTP 4XX CLIENT ERRORS IN LOGS (${http4xxEntries.length} total):\n${http4xxLines.join('\n')}`);
  }

  // Remaining non-HTTP errors
  if (remainingErrorLines.length > 0) {
    parts.push(`ERRORS (${remainingErrors.length} total):\n${remainingErrorLines.join('\n')}`);
  }

  if (warnLines.length > 0) {
    parts.push(`WARNINGS (${warnEntries.length} total, showing ${warnLines.length}):\n${warnLines.join('\n')}`);
  }

  if (chainFailures.length > 0) {
    parts.push(`ACTION CHAIN FAILURES:\n${chainFailures.join('\n')}`);
  }

  if (apiErrors.length > 0) {
    parts.push(`API / NETWORK ISSUES:\n${apiErrors.join('\n')}`);
  }

  if (repeatedMessages.length > 0) {
    parts.push(`REPEATED MESSAGES (>2 occurrences):\n${repeatedMessages.join('\n')}`);
  }

  const raw = parts.join('\n\n');
  return raw.length > 12000 ? `${raw.slice(0, 12000)}\n[TRUNCATED]` : raw;
}

export function useConsoleLogInsights(
  logData: ConsoleLogFile,
  backendUrl: string
): UseConsoleLogInsightsReturn {
  const cacheKey = `log:${logData.metadata.fileName}:${logData.metadata.totalEntries}`;

  const [insights, setInsights] = useState<InsightsResult | null>(
    () => insightsCache.get(cacheKey) ?? null
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logDataRef = useRef(logData);
  const backendUrlRef = useRef(backendUrl);
  const controllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const firedKeyRef = useRef('');

  logDataRef.current = logData;
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
      const context = buildConsoleLogContext(logDataRef.current);

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
        insightsCache.set(cacheKey, data.result);
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
  }, [cacheKey]);

  useEffect(() => {
    if (firedKeyRef.current === cacheKey) return;
    if (insightsCache.has(cacheKey)) return;
    firedKeyRef.current = cacheKey;
    void generate();
  }, [cacheKey, generate]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      controllerRef.current?.abort('unmount');
    };
  }, []);

  return { insights, isGenerating, error, generate, cancel };
}
