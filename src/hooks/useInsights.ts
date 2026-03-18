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

function buildContext(harData: HarFile): string {
  const entries = harData.log.entries;
  const errors = entries.filter((e) => e.response.status >= 400);
  const totalMs = entries.reduce((s, e) => s + e.time, 0);
  const domains = [
    ...new Set(
      entries.map((e) => {
        try {
          return new URL(e.request.url).hostname;
        } catch {
          return 'unknown';
        }
      })
    ),
  ];

  const summary = `requests:${entries.length} errors:${errors.length} domains:${domains.length} totalms:${totalMs.toFixed(0)}`;

  const topSlow = [...entries]
    .sort((a, b) => b.time - a.time)
    .slice(0, 20)
    .map((e) => {
      let path = e.request.url;
      try {
        const u = new URL(e.request.url);
        path = u.hostname + u.pathname;
      } catch {
        // Ignore URL parsing failures.
      }
      return `${e.request.method} ${path} status:${e.response.status} totalms:${e.time.toFixed(0)} waitms:${e.timings.wait.toFixed(0)}`;
    });

  const failedLines = errors.slice(0, 10).map((e) => {
    let path = e.request.url;
    try {
      const u = new URL(e.request.url);
      path = u.hostname + u.pathname;
    } catch {
      // Ignore URL parsing failures.
    }
    return `${e.request.method} ${path} status:${e.response.status}`;
  });

  const parts = [
    `HAR SUMMARY: ${summary}`,
    `TOP SLOW:\n${topSlow.join('\n')}`,
    ...(failedLines.length ? [`FAILED:\n${failedLines.join('\n')}`] : []),
  ];

  const raw = parts.join('\n\n');
  return raw.length > 10000 ? `${raw.slice(0, 10000)}\n[TRUNCATED]` : raw;
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
      const context = buildContext(harDataRef.current);

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
