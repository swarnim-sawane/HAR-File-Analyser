// src/hooks/useConsoleLogData.ts

import { useCallback, useMemo, useRef, useState } from 'react';
import { normalizeStructuredConsoleEntry } from '../../shared/consoleLogCore';
import {
  ConsoleFilterOptions,
  ConsoleLogEntry,
  ConsoleLogFile,
  LogLevel,
} from '../types/consolelog';
import { apiClient } from '../services/apiClient';
import { ConsoleLogAnalyzer } from '../utils/consoleLogAnalyzer';
import { ConsoleLogParser } from '../utils/consoleLogParser';

interface BackendLogEntry {
  _id?: { toString?: () => string } | string;
  index?: number;
  timestamp?: string;
  level?: string;
  message?: string;
  source?: string;
  stackTrace?: string;
  rawText?: string;
  lineNumber?: number;
  columnNumber?: number;
  args?: unknown[];
  url?: string;
  category?: string;
  issueTags?: unknown[];
  inferredSeverity?: string;
  primaryIssue?: string;
  fileId?: string;
}

const MAX_BROWSER_ENTRIES = 50_000;

function defaultFilters(): ConsoleFilterOptions {
  return {
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
    quickFocus: 'all',
    timeRange: {
      start: null,
      end: null,
    },
  };
}

function normalizeBackendEntry(
  entry: Record<string, unknown>,
  fallbackIndex: number,
  fileId?: string | null,
): ConsoleLogEntry {
  const rawId = entry._id;
  const normalized = normalizeStructuredConsoleEntry(entry, new Date().toISOString());
  const id =
    typeof entry.id === 'string'
      ? entry.id
      : typeof rawId === 'string'
        ? rawId
        : rawId && typeof rawId === 'object' && typeof (rawId as { toString?: () => string }).toString === 'function'
          ? (rawId as { toString: () => string }).toString()
          : `log-entry-${fallbackIndex}`;

  return {
    id,
    index: typeof entry.index === 'number' ? entry.index : fallbackIndex,
    fileId: typeof fileId === 'string' ? fileId : typeof entry.fileId === 'string' ? entry.fileId : undefined,
    _id:
      typeof rawId === 'string'
        ? rawId
        : rawId && typeof rawId === 'object' && typeof (rawId as { toString?: () => string }).toString === 'function'
          ? (rawId as { toString: () => string }).toString()
          : undefined,
    ...normalized,
  };
}

function normalizeLogFile(data: ConsoleLogFile, fileId?: string | null): ConsoleLogFile {
  return {
    metadata: {
      ...data.metadata,
      totalEntries:
        typeof data.metadata.totalEntries === 'number'
          ? data.metadata.totalEntries
          : data.entries.length,
    },
    entries: data.entries.map((entry, index) =>
      normalizeBackendEntry(entry as unknown as Record<string, unknown>, index, fileId),
    ),
  };
}

export const useConsoleLogData = () => {
  const [logData, setLogData] = useState<ConsoleLogFile | null>(null);
  const [selectedEntry, setSelectedEntryState] = useState<ConsoleLogEntry | null>(null);
  const [selectedEntryLoading, setSelectedEntryLoading] = useState(false);
  const [filters, setFilters] = useState<ConsoleFilterOptions>(defaultFilters);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendFileId, setBackendFileId] = useState<string | null>(null);

  const detailCacheRef = useRef<Map<number, ConsoleLogEntry>>(new Map());
  const detailRequestIdRef = useRef(0);

  const loadLogFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    setBackendFileId(null);
    detailCacheRef.current.clear();

    try {
      const parsed = await ConsoleLogParser.parseFile(file);
      setLogData(normalizeLogFile(parsed));
      setSelectedEntryState(null);
      setSelectedEntryLoading(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse log file');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadLogFromBackend = useCallback(async (fileId: string, fileName: string) => {
    setIsLoading(true);
    setError(null);
    setBackendFileId(fileId);
    detailCacheRef.current.clear();

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
        const pageData = (await apiClient.getLogEntries(fileId, page, pageSize)) as {
          entries?: BackendLogEntry[];
          pagination?: { hasMore?: boolean; totalEntries?: number };
        };

        const pageEntries = Array.isArray(pageData.entries) ? pageData.entries : [];
        const mappedEntries = pageEntries.map((entry, entryOffset) =>
          normalizeBackendEntry(
            entry as unknown as Record<string, unknown>,
            allEntries.length + entryOffset,
            fileId,
          ),
        );

        allEntries.push(...mappedEntries);
        expectedTotal = pageData.pagination?.totalEntries ?? expectedTotal;
        hasMore = Boolean(pageData.pagination?.hasMore);
        page += 1;
      }

      const resolvedTotal = expectedTotal > 0 ? expectedTotal : allEntries.length;
      const resolvedName = typeof status?.fileName === 'string' ? status.fileName : fileName;
      const isTruncated =
        resolvedTotal > MAX_BROWSER_ENTRIES && allEntries.length >= MAX_BROWSER_ENTRIES;

      setLogData({
        metadata: {
          fileName: resolvedName,
          uploadedAt,
          totalEntries: resolvedTotal,
          ...(isTruncated ? { truncatedAt: MAX_BROWSER_ENTRIES } : {}),
        },
        entries: allEntries,
      });
      setSelectedEntryState(null);
      setSelectedEntryLoading(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load processed log file');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateFilters = useCallback((newFilters: Partial<ConsoleFilterOptions>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  }, []);

  const loadFromData = useCallback((data: ConsoleLogFile) => {
    setBackendFileId(null);
    detailCacheRef.current.clear();
    setLogData(normalizeLogFile(data));
    setSelectedEntryState(null);
    setSelectedEntryLoading(false);
    setError(null);
  }, []);

  const clearData = useCallback(() => {
    setLogData(null);
    setSelectedEntryState(null);
    setSelectedEntryLoading(false);
    setError(null);
    setBackendFileId(null);
    detailCacheRef.current.clear();
    setFilters(defaultFilters());
  }, []);

  const setSelectedEntry = useCallback(
    async (entry: ConsoleLogEntry | null) => {
      detailRequestIdRef.current += 1;
      const requestId = detailRequestIdRef.current;

      if (!entry) {
        setSelectedEntryState(null);
        setSelectedEntryLoading(false);
        return;
      }

      setSelectedEntryState(entry);

      if (!backendFileId || entry.index === undefined) {
        setSelectedEntryLoading(false);
        return;
      }

      const cached = detailCacheRef.current.get(entry.index);
      if (cached) {
        setSelectedEntryState(cached);
        setSelectedEntryLoading(false);
        return;
      }

      setSelectedEntryLoading(true);

      try {
        const detail = (await apiClient.getLogEntry(fileIdFromEntry(entry, backendFileId), entry.index)) as BackendLogEntry;
        if (requestId !== detailRequestIdRef.current) {
          return;
        }

        const normalizedDetail = normalizeBackendEntry(
          detail as unknown as Record<string, unknown>,
          entry.index,
          backendFileId,
        );

        detailCacheRef.current.set(entry.index, normalizedDetail);
        setSelectedEntryState(normalizedDetail);
      } catch (err) {
        if (requestId === detailRequestIdRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load log details');
        }
      } finally {
        if (requestId === detailRequestIdRef.current) {
          setSelectedEntryLoading(false);
        }
      }
    },
    [backendFileId],
  );

  const filteredEntries = useMemo(() => {
    if (!logData) return [];

    let entries = [...logData.entries];

    const enabledLevels = Object.entries(filters.levels)
      .filter(([, enabled]) => enabled)
      .map(([level]) => level as LogLevel);

    entries = ConsoleLogAnalyzer.filterByLevel(entries, enabledLevels);
    entries = ConsoleLogAnalyzer.filterByQuickFocus(entries, filters.quickFocus);

    if (filters.searchTerm) {
      entries = ConsoleLogAnalyzer.searchEntries(entries, filters.searchTerm);
    }

    return ConsoleLogAnalyzer.filterByTimeRange(
      entries,
      filters.timeRange.start,
      filters.timeRange.end,
    );
  }, [filters, logData]);

  return {
    logData,
    filteredEntries,
    selectedEntry,
    selectedEntryLoading,
    filters,
    isLoading,
    error,
    loadLogFile,
    loadLogFromBackend,
    loadFromData,
    setSelectedEntry,
    updateFilters,
    clearData,
  };
};

function fileIdFromEntry(entry: ConsoleLogEntry, fallbackFileId: string): string {
  return typeof entry.fileId === 'string' && entry.fileId ? entry.fileId : fallbackFileId;
}
