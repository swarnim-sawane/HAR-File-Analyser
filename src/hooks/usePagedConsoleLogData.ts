import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ConsoleFilterOptions,
  ConsoleLogEntry,
  ConsoleLogEntrySummary,
  ConsoleLogQuery,
  ConsoleLogSortField,
  LogLevel,
} from '../types/consolelog';
import { apiClient } from '../services/apiClient';
import { useDebouncedValue } from './useDebouncedValue';

const PAGE_SIZE = 200;
const PAGE_CACHE_LIMIT = 5;
const ALL_LEVELS: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'verbose'];

type SortDirection = 'asc' | 'desc';

interface ConsoleLogStatus {
  fileId: string;
  fileName: string;
  status: string;
  totalEntries: number | null;
  uploadedAt: string | null;
  processedAt: string | null;
}

interface UsePagedConsoleLogDataOptions {
  fileId: string;
  fileName: string;
  isActive: boolean;
}

interface UsePagedConsoleLogDataReturn {
  filters: ConsoleFilterOptions;
  sortField: ConsoleLogSortField;
  sortDirection: SortDirection;
  selectedEntry: ConsoleLogEntry | null;
  selectedEntryIndex: number | null;
  selectedEntryId: string | null;
  selectedEntryLoading: boolean;
  error: string | null;
  isBootstrapping: boolean;
  isLoadingRows: boolean;
  fileStatus: ConsoleLogStatus | null;
  fileStats: Record<string, unknown> | null;
  totalEntries: number;
  filteredTotalEntries: number;
  updateFilters: (filters: Partial<ConsoleFilterOptions>) => void;
  updateSort: (field: ConsoleLogSortField) => void;
  getEntryAt: (position: number) => ConsoleLogEntrySummary | undefined;
  getLoadedEntries: () => ConsoleLogEntrySummary[];
  ensureRange: (startIndex: number, endIndex: number) => void;
  setSelectedEntry: (entry: ConsoleLogEntrySummary | null) => void;
  clearData: () => void;
}

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
    timeRange: {
      start: null,
      end: null,
    },
  };
}

function trimPageCache<T>(cache: Map<number, T>, centerPage: number): Map<number, T> {
  if (cache.size <= PAGE_CACHE_LIMIT) {
    return cache;
  }

  const keepPages = [...cache.keys()]
    .sort((a, b) => Math.abs(a - centerPage) - Math.abs(b - centerPage))
    .slice(0, PAGE_CACHE_LIMIT);

  const next = new Map<number, T>();
  keepPages.sort((a, b) => a - b).forEach((page) => {
    const pageData = cache.get(page);
    if (pageData) {
      next.set(page, pageData);
    }
  });

  return next;
}

export function usePagedConsoleLogData({
  fileId,
  fileName,
  isActive,
}: UsePagedConsoleLogDataOptions): UsePagedConsoleLogDataReturn {
  const [filters, setFilters] = useState<ConsoleFilterOptions>(defaultFilters);
  const [sortField, setSortField] = useState<ConsoleLogSortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [pageCache, setPageCache] = useState<Map<number, ConsoleLogEntrySummary[]>>(new Map());
  const [selectedEntry, setSelectedEntryState] = useState<ConsoleLogEntry | null>(null);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState<number | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedEntryLoading, setSelectedEntryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [fileStatus, setFileStatus] = useState<ConsoleLogStatus | null>(null);
  const [fileStats, setFileStats] = useState<Record<string, unknown> | null>(null);
  const [filteredTotalEntries, setFilteredTotalEntries] = useState(0);

  const pageCacheRef = useRef<Map<number, ConsoleLogEntrySummary[]>>(new Map());
  const inFlightPagesRef = useRef<Set<number>>(new Set());
  const detailCacheRef = useRef<Map<number, ConsoleLogEntry>>(new Map());
  const requestVersionRef = useRef(0);
  const detailVersionRef = useRef(0);

  const debouncedSearch = useDebouncedValue(filters.searchTerm, 250);

  const activeLevels = useMemo(() => {
    const enabledLevels = Object.entries(filters.levels)
      .filter(([, enabled]) => enabled)
      .map(([level]) => level as LogLevel);

    if (enabledLevels.length === 0 || enabledLevels.length === ALL_LEVELS.length) {
      return undefined;
    }

    return enabledLevels;
  }, [filters.levels]);

  const query = useMemo<ConsoleLogQuery>(
    () => ({
      limit: PAGE_SIZE,
      search: debouncedSearch.trim() || undefined,
      levels: activeLevels,
      startTime: filters.timeRange.start,
      endTime: filters.timeRange.end,
      sortBy: sortField,
      sortDir: sortDirection,
    }),
    [activeLevels, debouncedSearch, filters.timeRange.end, filters.timeRange.start, sortDirection, sortField]
  );

  const queryKey = useMemo(() => JSON.stringify(query), [query]);

  const getEntryAt = useCallback(
    (position: number) => {
      const page = Math.floor(position / PAGE_SIZE) + 1;
      const offset = position % PAGE_SIZE;
      return pageCache.get(page)?.[offset];
    },
    [pageCache]
  );

  const getLoadedEntries = useCallback(
    () => [...pageCache.keys()].sort((a, b) => a - b).flatMap((page) => pageCache.get(page) ?? []),
    [pageCache]
  );

  const loadPage = useCallback(
    async (page: number, version = requestVersionRef.current) => {
      if (!isActive) return;
      if (inFlightPagesRef.current.has(page)) return;
      if (pageCacheRef.current.has(page)) return;

      inFlightPagesRef.current.add(page);
      setPendingRequests((current) => current + 1);

      try {
        const response = await apiClient.getLogEntries(fileId, {
          ...query,
          page,
        });

        if (version !== requestVersionRef.current) {
          return;
        }

        startTransition(() => {
          setFilteredTotalEntries(response.pagination.totalEntries);
          setPageCache((previous) => {
            const next = new Map(previous);
            next.set(page, response.entries);
            const trimmed = trimPageCache(next, page);
            pageCacheRef.current = trimmed;
            return trimmed;
          });
          setError(null);
        });
      } catch (err) {
        if (version === requestVersionRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load console log entries');
        }
      } finally {
        inFlightPagesRef.current.delete(page);
        setPendingRequests((current) => Math.max(0, current - 1));
      }
    },
    [fileId, isActive, query]
  );

  const ensureRange = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!isActive) return;
      const safeStart = Math.max(0, startIndex);
      const safeEnd = Math.max(safeStart, endIndex);
      const firstPage = Math.floor(safeStart / PAGE_SIZE) + 1;
      const lastPage = Math.floor(safeEnd / PAGE_SIZE) + 1;

      for (let page = firstPage; page <= lastPage; page += 1) {
        void loadPage(page);
      }
    },
    [isActive, loadPage]
  );

  const loadBootstrapData = useCallback(async () => {
    setBootstrapping(true);

    try {
      const [status, stats] = await Promise.all([
        apiClient.getLogStatus(fileId),
        apiClient.getLogStats(fileId).catch(() => null),
      ]);

      startTransition(() => {
        setFileStatus(status);
        setFileStats(stats);
        setFilteredTotalEntries(typeof status?.totalEntries === 'number' ? status.totalEntries : 0);
        setError(null);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load console log metadata');
    } finally {
      setBootstrapping(false);
    }
  }, [fileId]);

  useEffect(() => {
    if (!isActive) {
      inFlightPagesRef.current.clear();
      pageCacheRef.current = new Map();
      setPageCache(new Map());
      setPendingRequests(0);
      return;
    }

    void loadBootstrapData();
  }, [isActive, loadBootstrapData]);

  useEffect(() => {
    requestVersionRef.current += 1;
    inFlightPagesRef.current.clear();
    pageCacheRef.current = new Map();
    startTransition(() => {
      setPageCache(new Map());
      setFilteredTotalEntries(typeof fileStatus?.totalEntries === 'number' ? fileStatus.totalEntries : 0);
      setSelectedEntryIndex(null);
      setSelectedEntryId(null);
      setSelectedEntryState(null);
      setError(null);
    });

    if (!isActive) {
      return;
    }

    void loadPage(1, requestVersionRef.current);
  }, [fileId, fileStatus?.totalEntries, isActive, loadPage, queryKey]);

  const updateFilters = useCallback((incoming: Partial<ConsoleFilterOptions>) => {
    setFilters((previous) => ({
      ...previous,
      ...incoming,
    }));
  }, []);

  const updateSort = useCallback((field: ConsoleLogSortField) => {
    setSortField((previousField) => {
      if (previousField === field) {
        setSortDirection((previousDirection) => (previousDirection === 'asc' ? 'desc' : 'asc'));
        return previousField;
      }

      setSortDirection(field === 'timestamp' ? 'desc' : 'desc');
      return field;
    });
  }, []);

  const setSelectedEntry = useCallback(
    async (entrySummary: ConsoleLogEntrySummary | null) => {
      if (!entrySummary) {
        setSelectedEntryIndex(null);
        setSelectedEntryId(null);
        setSelectedEntryState(null);
        setSelectedEntryLoading(false);
        return;
      }

      setSelectedEntryIndex(entrySummary.index);
      setSelectedEntryId(entrySummary.id);

      const cached = detailCacheRef.current.get(entrySummary.index);
      if (cached) {
        setSelectedEntryState(cached);
        setSelectedEntryLoading(false);
        return;
      }

      const detailVersion = detailVersionRef.current + 1;
      detailVersionRef.current = detailVersion;
      setSelectedEntryLoading(true);

      try {
        const entry = await apiClient.getLogEntry(fileId, entrySummary.index);

        if (detailVersion !== detailVersionRef.current) {
          return;
        }

        detailCacheRef.current.set(entrySummary.index, entry);
        setSelectedEntryState(entry);
      } catch (err) {
        if (detailVersion === detailVersionRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load log details');
        }
      } finally {
        if (detailVersion === detailVersionRef.current) {
          setSelectedEntryLoading(false);
        }
      }
    },
    [fileId]
  );

  const clearData = useCallback(() => {
    requestVersionRef.current += 1;
    detailVersionRef.current += 1;
    inFlightPagesRef.current.clear();
    detailCacheRef.current.clear();
    pageCacheRef.current = new Map();
    setFilters(defaultFilters());
    setSortField('timestamp');
    setSortDirection('desc');
    setPageCache(new Map());
    setSelectedEntryIndex(null);
    setSelectedEntryId(null);
    setSelectedEntryState(null);
    setSelectedEntryLoading(false);
    setError(null);
    setFilteredTotalEntries(0);
  }, []);

  return {
    filters,
    sortField,
    sortDirection,
    selectedEntry,
    selectedEntryIndex,
    selectedEntryId,
    selectedEntryLoading,
    error,
    isBootstrapping: bootstrapping,
    isLoadingRows: pendingRequests > 0,
    fileStatus,
    fileStats,
    totalEntries: typeof fileStatus?.totalEntries === 'number' ? fileStatus.totalEntries : 0,
    filteredTotalEntries,
    updateFilters,
    updateSort,
    getEntryAt,
    getLoadedEntries,
    ensureRange,
    setSelectedEntry,
    clearData,
  };
}
