import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { HarEntry } from '../../../shared/types/har';
import { wsClient } from '../services/websocketClient';

const API_BASE_URL = 'http://localhost:4000/api';

export interface FilterOptions {
  statusCodes: {
    '0': boolean;
    '1xx': boolean;
    '2xx': boolean;
    '3xx': boolean;
    '4xx': boolean;
    '5xx': boolean;
  };
  searchTerm: string;
  groupBy: 'pages' | 'all';
  timingType: 'relative' | 'independent';
}

export interface UseHarDataReturn {
  entries: HarEntry[];
  filteredEntries: HarEntry[];
  filters: FilterOptions;
  updateFilters: (filters: Partial<FilterOptions>) => void;
  status: {
    status: string;
    progress?: number;
    fileName?: string;
    totalEntries?: number;
  } | null;
  loading: boolean;
  hasMore: boolean;
  currentPage: number;
  totalPages: number;
  loadMore: () => void;
  refresh: () => void;
}

const defaultFilters: FilterOptions = {
  statusCodes: {
    '0': true,
    '1xx': true,
    '2xx': true,
    '3xx': true,
    '4xx': true,
    '5xx': true,
  },
  searchTerm: '',
  groupBy: 'all',
  timingType: 'relative',
};

export function useHarData(fileId: string | null): UseHarDataReturn {
  const [entries, setEntries] = useState<HarEntry[]>([]);
  const [status, setStatus] = useState<UseHarDataReturn['status']>(null);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [filters, setFilters] = useState<FilterOptions>(defaultFilters);
  const hasFetchedRef = useRef(false);

  // ✅ FIXED: Fetch entries with pagination
  const fetchEntries = useCallback(async (page: number = 1, append: boolean = false) => {
    if (!fileId) return;

    console.log(`useHarData: Fetching page ${page} for fileId ${fileId}`);
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/har/${fileId}/entries?page=${page}&limit=100`);

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const data = await response.json();

      console.log(`✅ Loaded ${data.entries.length} HAR entries (page ${page}/${data.pagination.totalPages})`);

      // ✅ FIXED: Append or replace entries based on pagination
      if (append) {
        setEntries(prev => [...prev, ...data.entries]);
      } else {
        setEntries(data.entries);
      }

      // Update pagination state
      setCurrentPage(data.pagination.currentPage);
      setTotalPages(data.pagination.totalPages);
      setHasMore(data.pagination.hasMore);

      // Update status with total entries
      setStatus(prev => ({
        ...prev,
        status: 'ready',
        totalEntries: data.pagination.totalEntries
      }));

      setLoading(false);
    } catch (error) {
      console.error('❌ Failed to fetch HAR entries:', error);
      setStatus(prev => ({
        ...prev,
        status: 'error'
      }));
      setLoading(false);
    }
  }, [fileId]);

  // ✅ NEW: Client-side filtering
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      // Filter by status code
      const status = entry.response.status;
      let statusKey: keyof FilterOptions['statusCodes'] = '0';

      if (status === 0) statusKey = '0';
      else if (status >= 100 && status < 200) statusKey = '1xx';
      else if (status >= 200 && status < 300) statusKey = '2xx';
      else if (status >= 300 && status < 400) statusKey = '3xx';
      else if (status >= 400 && status < 500) statusKey = '4xx';
      else if (status >= 500) statusKey = '5xx';

      if (!filters.statusCodes[statusKey]) return false;

      // Filter by search term
      if (filters.searchTerm) {
        const term = filters.searchTerm.toLowerCase();
        const url = entry.request.url.toLowerCase();
        const method = entry.request.method.toLowerCase();
        if (!url.includes(term) && !method.includes(term)) {
          return false;
        }
      }

      return true;
    });
  }, [entries, filters]);

  // ✅ NEW: Update filters
  const updateFilters = useCallback((newFilters: Partial<FilterOptions>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  // ✅ NEW: Load more entries (pagination)
  const loadMore = useCallback(() => {
    if (hasMore && !loading) {
      fetchEntries(currentPage + 1, true);
    }
  }, [currentPage, hasMore, loading, fetchEntries]);

  // ✅ NEW: Refresh from beginning
  const refresh = useCallback(() => {
    setEntries([]);
    setCurrentPage(1);
    fetchEntries(1, false);
  }, [fetchEntries]);

  // Subscribe to WebSocket events and manage data lifecycle
  useEffect(() => {
    if (!fileId) {
      setEntries([]);
      setStatus(null);
      setFilters(defaultFilters);
      setCurrentPage(1);
      setTotalPages(1);
      setHasMore(false);
      return;
    }

    // Reset state when a new file is selected
    setEntries([]);
    setStatus(null);
    setFilters(defaultFilters);
    setCurrentPage(1);
    setTotalPages(1);
    setHasMore(false);
    hasFetchedRef.current = false;

    console.log('📡 useHarData: Subscribing to fileId:', fileId);

    // Subscribe to file room for real-time events (needed for session restores)
    wsClient.subscribeToFile(fileId);

    // Handle file status updates
    const handleFileStatus = (data: any) => {
      if (data.fileId !== fileId) return;

      console.log('📡 File status update:', data);
      setStatus({
        status: data.status,
        progress: data.progress,
        fileName: data.fileName,
        totalEntries: data.totalEntries
      });

      // Fetch entries once when file becomes ready
      if (data.status === 'ready' && !hasFetchedRef.current) {
        hasFetchedRef.current = true;
        fetchEntries(1, false);
      }
    };

    // Handle processing progress updates
    const handleProgress = (data: any) => {
      if (data.fileId === fileId) {
        console.log('📊 Progress update:', data);
        setStatus(prev => ({
          ...prev,
          status: prev?.status || 'processing',
          progress: data.progress
        }));
      }
    };

    wsClient.on('file:status', handleFileStatus);
    wsClient.on('processing:progress', handleProgress);

    // Check current file status — only fetch entries if already ready.
    // This prevents a blank screen when the file is still being processed.
    const checkStatusAndLoad = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/har/${fileId}/status`);
        if (!response.ok) throw new Error(`Status ${response.status}`);

        const data = await response.json();

        setStatus({
          status: data.status,
          fileName: data.fileName,
          totalEntries: data.totalEntries
        });

        if (data.status === 'ready' && !hasFetchedRef.current) {
          hasFetchedRef.current = true;
          fetchEntries(1, false);
        }
        // For any other status (parsing/processing/analyzing), just wait for WebSocket events
      } catch (err) {
        console.warn('⚠️ Could not check HAR file status (file may still be uploading):', err);
        // Leave status as null — WebSocket events will populate it when ready
      }
    };

    checkStatusAndLoad();

    // Cleanup
    return () => {
      wsClient.off('file:status', handleFileStatus);
      wsClient.off('processing:progress', handleProgress);
    };
  }, [fileId, fetchEntries]);

  return {
    entries,
    filteredEntries,
    filters,
    updateFilters,
    status,
    loading,
    hasMore,
    currentPage,
    totalPages,
    loadMore,
    refresh
  };
}
