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

function buildConsoleLogContext(logData: ConsoleLogFile): string {
  const entries = logData.entries;
  const total = entries.length;

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

  // ── All errors (most important) ─────────────────────────────────────────────
  const errorEntries = entries.filter((e) => e.level === 'error');
  const errorLines = errorEntries.map((e) => {
    const src = e.source ? ` [${e.source}]` : '';
    const stack = e.stackTrace ? `\n  Stack: ${e.stackTrace.substring(0, 200)}` : '';
    return `ERROR${src}: ${e.message}${stack}`;
  });

  // ── Warnings (up to 30) ─────────────────────────────────────────────────────
  const warnEntries = entries.filter((e) => e.level === 'warn');
  const warnLines = warnEntries.slice(0, 30).map((e) => {
    const src = e.source ? ` [${e.source}]` : '';
    return `WARN${src}: ${e.message.substring(0, 200)}`;
  });

  // ── Repeated message patterns ───────────────────────────────────────────────
  const msgCounts = new Map<string, number>();
  for (const e of entries) {
    const key = e.message.substring(0, 80);
    msgCounts.set(key, (msgCounts.get(key) || 0) + 1);
  }
  const repeatedMessages = Array.from(msgCounts.entries())
    .filter(([, count]) => count > 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([msg, count]) => `x${count}: ${msg}`);

  // ── Action chain failures (VB-specific) ─────────────────────────────────────
  const chainFailures = entries
    .filter((e) => e.level === 'error' && e.message.toLowerCase().includes('chain') && e.message.toLowerCase().includes('fail'))
    .slice(0, 10)
    .map((e) => e.message.substring(0, 200));

  // ── REST / API errors ────────────────────────────────────────────────────────
  const apiErrors = entries
    .filter((e) => (e.level === 'error' || e.level === 'warn') &&
      (e.message.includes('fetch') || e.message.includes('REST') || e.message.includes('JSON') ||
       e.message.includes('response') || e.message.includes('api') || e.message.includes('status')))
    .slice(0, 15)
    .map((e) => `[${e.level.toUpperCase()}] ${e.message.substring(0, 200)}`);

  // ── Unique source modules ────────────────────────────────────────────────────
  const uniqueModules = [...new Set(
    entries.map((e) => e.source).filter(Boolean)
  )].slice(0, 30);

  // ── Build context string ─────────────────────────────────────────────────────
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

  if (errorLines.length > 0) {
    parts.push(`ERRORS (${errorLines.length} total):\n${errorLines.join('\n')}`);
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
