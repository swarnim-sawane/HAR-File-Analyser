import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Entry,
  FilterOptions,
  HarEntriesResponse,
  HarEntryQuery,
  HarEntrySummary,
  HarSortField,
} from '../types/har';
import { apiClient } from '../services/apiClient';
import { useDebouncedValue } from './useDebouncedValue';

const PAGE_SIZE = 200;
const PAGE_CACHE_LIMIT = 5;
const ALL_STATUS_BUCKETS: Array<keyof FilterOptions['statusCodes']> = ['0', '1xx', '2xx', '3xx', '4xx', '5xx'];

type SortDirection = 'asc' | 'desc';

interface HarFileStatus {
  fileId: string;
  fileName: string;
  status: string;
  totalEntries: number | null;
  uploadedAt: string | null;
  processedAt: string | null;
}

interface UsePagedHarDataOptions {
  fileId: string;
  fileName: string;
  isActive: boolean;
}

interface UsePagedHarDataReturn {
  filters: FilterOptions;
  sortField: HarSortField;
  sortDirection: SortDirection;
  selectedEntry: Entry | null;
  selectedEntryIndex: number | null;
  selectedEntryLoading: boolean;
  error: string | null;
  isBootstrapping: boolean;
  isLoadingRows: boolean;
  fileStatus: HarFileStatus | null;
  fileStats: Record<string, unknown> | null;
  totalEntries: number;
  filteredTotalEntries: number;
  updateFilters: (filters: Partial<FilterOptions>) => void;
  updateSort: (field: HarSortField) => void;
  getEntryAt: (position: number) => HarEntrySummary | undefined;
  getLoadedEntries: () => HarEntrySummary[];
  ensureRange: (startIndex: number, endIndex: number) => void;
  setSelectedEntry: (entry: HarEntrySummary | null) => void;
  clearData: () => void;
  exportFilteredData: () => Promise<void>;
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

function defaultFilters(): FilterOptions {
  return {
    statusCodes: {
      '0': false,
      '1xx': false,
      '2xx': true,
      '3xx': true,
      '4xx': true,
      '5xx': true,
    },
    searchTerm: '',
    timingType: 'relative',
  };
}

export function usePagedHarData({
  fileId,
  fileName,
  isActive,
}: UsePagedHarDataOptions): UsePagedHarDataReturn {
  const [filters, setFilters] = useState<FilterOptions>(defaultFilters);
  const [sortField, setSortField] = useState<HarSortField>('time');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [pageCache, setPageCache] = useState<Map<number, HarEntrySummary[]>>(new Map());
  const [selectedEntry, setSelectedEntryState] = useState<Entry | null>(null);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState<number | null>(null);
  const [selectedEntryLoading, setSelectedEntryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [fileStatus, setFileStatus] = useState<HarFileStatus | null>(null);
  const [fileStats, setFileStats] = useState<Record<string, unknown> | null>(null);
  const [filteredTotalEntries, setFilteredTotalEntries] = useState(0);

  const pageCacheRef = useRef<Map<number, HarEntrySummary[]>>(new Map());
  const inFlightPagesRef = useRef<Set<number>>(new Set());
  const detailCacheRef = useRef<Map<number, Entry>>(new Map());
  const requestVersionRef = useRef(0);
  const detailVersionRef = useRef(0);

  const debouncedSearch = useDebouncedValue(filters.searchTerm, 250);
  const isReady = fileStatus?.status === 'ready';

  const activeStatusBuckets = useMemo(() => {
    const activeBuckets = Object.entries(filters.statusCodes)
      .filter(([, active]) => active)
      .map(([bucket]) => bucket as keyof FilterOptions['statusCodes']);

    if (
      activeBuckets.length === 0 ||
      activeBuckets.length === ALL_STATUS_BUCKETS.length
    ) {
      return undefined;
    }

    return activeBuckets;
  }, [filters.statusCodes]);

  const query = useMemo<HarEntryQuery>(
    () => ({
      limit: PAGE_SIZE,
      search: debouncedSearch.trim() || undefined,
      sortBy: sortField,
      sortDir: sortDirection,
      statusBuckets: activeStatusBuckets,
    }),
    [activeStatusBuckets, debouncedSearch, sortDirection, sortField]
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
      if (!isReady) return;
      if (inFlightPagesRef.current.has(page)) return;
      if (pageCacheRef.current.has(page)) return;

      inFlightPagesRef.current.add(page);
      setPendingRequests((current) => current + 1);

      try {
        const response = await apiClient.getHarEntries(fileId, {
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
          setError(err instanceof Error ? err.message : 'Failed to load HAR entries');
        }
      } finally {
        inFlightPagesRef.current.delete(page);
        setPendingRequests((current) => Math.max(0, current - 1));
      }
    },
    [fileId, isActive, isReady, query]
  );

  const ensureRange = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!isActive) return;
      if (!isReady) return;
      const safeStart = Math.max(0, startIndex);
      const safeEnd = Math.max(safeStart, endIndex);
      const firstPage = Math.floor(safeStart / PAGE_SIZE) + 1;
      const lastPage = Math.floor(safeEnd / PAGE_SIZE) + 1;

      for (let page = firstPage; page <= lastPage; page += 1) {
        void loadPage(page);
      }
    },
    [isActive, isReady, loadPage]
  );

  const loadBootstrapData = useCallback(async () => {
    setBootstrapping(true);

    try {
      const status = await apiClient.getHarStatus(fileId);
      const stats =
        status?.status === 'ready'
          ? await apiClient.getHarStats(fileId).catch(() => null)
          : null;

      startTransition(() => {
        setFileStatus(status);
        setFileStats(stats);
        setFilteredTotalEntries(typeof status?.totalEntries === 'number' ? status.totalEntries : 0);
        setError(null);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load HAR metadata');
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
      setSelectedEntryState(null);
      setError(null);
    });

    if (!isActive) {
      return;
    }

    if (!isReady) {
      return;
    }

    void loadPage(1, requestVersionRef.current);
  }, [fileId, fileStatus?.totalEntries, isActive, isReady, loadPage, queryKey]);

  const updateFilters = useCallback((incoming: Partial<FilterOptions>) => {
    setFilters((previous) => ({
      ...previous,
      ...incoming,
    }));
  }, []);

  const updateSort = useCallback((field: HarSortField) => {
    setSortField((previousField) => {
      if (previousField === field) {
        setSortDirection((previousDirection) => (previousDirection === 'asc' ? 'desc' : 'asc'));
        return previousField;
      }

      setSortDirection('asc');
      return field;
    });
  }, []);

  const setSelectedEntry = useCallback(
    async (entrySummary: HarEntrySummary | null) => {
      if (!entrySummary) {
        setSelectedEntryIndex(null);
        setSelectedEntryState(null);
      setSelectedEntryLoading(false);
      return;
    }

      if (!isReady) {
        setError('HAR file is still processing');
        return;
      }

      setSelectedEntryIndex(entrySummary.index);

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
        const entry = await apiClient.getHarEntry(fileId, entrySummary.index);

        if (detailVersion !== detailVersionRef.current) {
          return;
        }

        detailCacheRef.current.set(entrySummary.index, entry);
        setSelectedEntryState(entry);
      } catch (err) {
        if (detailVersion === detailVersionRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load request details');
        }
      } finally {
        if (detailVersion === detailVersionRef.current) {
          setSelectedEntryLoading(false);
        }
      }
    },
    [fileId, isReady]
  );

  const clearData = useCallback(() => {
    requestVersionRef.current += 1;
    detailVersionRef.current += 1;
    inFlightPagesRef.current.clear();
    detailCacheRef.current.clear();
    pageCacheRef.current = new Map();
    setFilters(defaultFilters());
    setSortField('time');
    setSortDirection('asc');
    setPageCache(new Map());
    setSelectedEntryIndex(null);
    setSelectedEntryState(null);
    setSelectedEntryLoading(false);
    setError(null);
    setFilteredTotalEntries(0);
  }, []);

  const exportFilteredData = useCallback(async () => {
    const baseName = fileName.replace(/\.[^.]+$/, '') || 'har';
    await apiClient.exportHarData(fileId, query, `${baseName}-filtered.har`);
  }, [fileId, fileName, query]);

  return {
    filters,
    sortField,
    sortDirection,
    selectedEntry,
    selectedEntryIndex,
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
    exportFilteredData,
  };
}
