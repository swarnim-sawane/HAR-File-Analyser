// src/hooks/useConsoleLogData.ts

import { useState, useCallback, useMemo } from 'react';
import { ConsoleLogFile, ConsoleLogEntry, ConsoleFilterOptions, LogLevel } from '../types/consolelog';
import { ConsoleLogParser } from '../utils/consoleLogParser';
import { ConsoleLogAnalyzer } from '../utils/consoleLogAnalyzer';
import { apiClient } from '../services/apiClient';

interface BackendLogEntry {
  _id?: { toString?: () => string } | string;
  index?: number;
  timestamp?: string;
  level?: string;
  message?: string;
  source?: string;
  stackTrace?: string;
  lineNumber?: number;
  columnNumber?: number;
  args?: unknown[];
  url?: string;
  category?: string;
}

const normalizeLogLevel = (level: string | undefined): LogLevel => {
  const normalized = (level || 'log').toLowerCase().trim();
  if (
    normalized === 'log' ||
    normalized === 'info' ||
    normalized === 'warn' ||
    normalized === 'error' ||
    normalized === 'debug' ||
    normalized === 'trace' ||
    normalized === 'verbose'
  ) {
    return normalized;
  }

  if (normalized === 'warning') return 'warn';
  if (normalized === 'err' || normalized === 'fatal' || normalized === 'critical') return 'error';
  if (normalized === 'information' || normalized === 'notice') return 'info';
  if (normalized === 'dbg') return 'debug';

  return 'log';
};

export const useConsoleLogData = () => {
  const [logData, setLogData] = useState<ConsoleLogFile | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ConsoleLogEntry | null>(null);
  const [filters, setFilters] = useState<ConsoleFilterOptions>({
    levels: {
      log: true,
      info: true,
      warn: true,
      error: true,
      debug: true,
      trace: true,
      verbose: true,
    },
    searchTerm: '',
    groupBy: 'all',
    timeRange: {
      start: null,
      end: null,
    },
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);

    try {
      const parsed = await ConsoleLogParser.parseFile(file);
      setLogData(parsed);
      setSelectedEntry(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse log file');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Maximum entries to load into the browser at once.
  // Loading millions of entries causes browser OOM / freeze on large files.
  // Engineers can use filters/search to drill into the full dataset on the backend.
  const MAX_BROWSER_ENTRIES = 50_000;

  const loadLogFromBackend = useCallback(async (fileId: string, fileName: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const status = await apiClient.getLogStatus(fileId).catch(() => null);
      const uploadedAt =
        typeof status?.uploadedAt === 'string' ? status.uploadedAt : new Date().toISOString();

      const allEntries: ConsoleLogEntry[] = [];
      const pageSize = 1000;
      let page = 1;
      let hasMore = true;
      let expectedTotal = typeof status?.totalEntries === 'number' ? status.totalEntries : 0;

      while (hasMore && allEntries.length < MAX_BROWSER_ENTRIES) {
        const pageData = await apiClient.getLogEntries(fileId, page, pageSize) as {
          entries?: BackendLogEntry[];
          pagination?: { hasMore?: boolean; totalEntries?: number };
        };

        const pageEntries = Array.isArray(pageData.entries) ? pageData.entries : [];
        const mappedEntries = pageEntries.map((entry) => {
          const rawId = entry._id;
          const id =
            typeof rawId === 'string'
              ? rawId
              : rawId?.toString
                ? rawId.toString()
                : `log-entry-${entry.index ?? page}-${Math.random().toString(36).slice(2, 8)}`;

          return {
            id,
            timestamp: entry.timestamp || new Date().toISOString(),
            level: normalizeLogLevel(entry.level),
            message: entry.message || '',
            source: entry.source,
            stackTrace: entry.stackTrace,
            lineNumber: entry.lineNumber,
            columnNumber: entry.columnNumber,
            args: entry.args,
            url: entry.url,
            category: entry.category,
          };
        });

        allEntries.push(...mappedEntries);
        expectedTotal = pageData.pagination?.totalEntries ?? expectedTotal;
        hasMore = Boolean(pageData.pagination?.hasMore);
        page += 1;
      }

      const resolvedTotal = expectedTotal > 0 ? expectedTotal : allEntries.length;
      const resolvedName = typeof status?.fileName === 'string' ? status.fileName : fileName;
      const isTruncated = resolvedTotal > MAX_BROWSER_ENTRIES && allEntries.length >= MAX_BROWSER_ENTRIES;

      setLogData({
        metadata: {
          fileName: resolvedName,
          uploadedAt,
          totalEntries: resolvedTotal,
          // Pass truncation info through so UI can show a warning banner
          ...(isTruncated ? { truncatedAt: MAX_BROWSER_ENTRIES } : {}),
        },
        entries: allEntries,
      });
      setSelectedEntry(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load processed log file');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateFilters = useCallback((newFilters: Partial<ConsoleFilterOptions>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  const clearData = useCallback(() => {
    setLogData(null);
    setSelectedEntry(null);
    setError(null);
  }, []);

  const filteredEntries = useMemo(() => {
    if (!logData) return [];

    let entries = [...logData.entries];

    // Filter by levels
    const enabledLevels = Object.entries(filters.levels)
      .filter(([, enabled]) => enabled)
      .map(([level]) => level as LogLevel);

    entries = ConsoleLogAnalyzer.filterByLevel(entries, enabledLevels);

    // Filter by search term
    if (filters.searchTerm) {
      entries = ConsoleLogAnalyzer.searchEntries(entries, filters.searchTerm);
    }

    // Filter by time range
    entries = ConsoleLogAnalyzer.filterByTimeRange(
      entries,
      filters.timeRange.start,
      filters.timeRange.end
    );

    return entries;
  }, [logData, filters]);

  return {
    logData,
    filteredEntries,
    selectedEntry,
    filters,
    isLoading,
    error,
    loadLogFile,
    loadLogFromBackend,
    setSelectedEntry,
    updateFilters,
    clearData,
  };
};
