import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiClient } from '../services/apiClient';
import { wsClient } from '../services/websocketClient';
import { LogEntry, LogStats } from '../../../shared/types/consolelog';
import { ConsoleFilterOptions } from '../shared/types/consolelog';
import { FileStatus } from '../types/fileStatus';

interface UseConsoleLogDataReturn {
  entries: LogEntry[];
  filteredEntries: LogEntry[];
  filters: ConsoleFilterOptions;
  updateFilters: (filters: Partial<ConsoleFilterOptions>) => void;
  stats: LogStats | null;
  status: FileStatus | null;
  loading: boolean;
  error: string | null;
  currentPage: number;
  totalPages: number;
  totalEntries: number; // ✅ NEW: Add total entries
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

const DEFAULT_FILTERS: ConsoleFilterOptions = {
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

export function useConsoleLogData(fileId: string | null): UseConsoleLogDataReturn {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filters, setFilters] = useState<ConsoleFilterOptions>(DEFAULT_FILTERS);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [status, setStatus] = useState<FileStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalEntries, setTotalEntries] = useState(0); // ✅ NEW: Track total entries
  const [hasMore, setHasMore] = useState(false);
  const pageSize = 100;

  // Apply filters to entries
  const filteredEntries = useMemo(() => {
    let filtered = [...entries];

    // Filter by level
    const activeLevels = Object.entries(filters.levels)
      .filter(([_, isActive]) => isActive)
      .map(([level]) => level);

    if (activeLevels.length < 7) {
      filtered = filtered.filter(entry => activeLevels.includes(entry.level));
    }

    // Filter by search term
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      filtered = filtered.filter(entry =>
        entry.message.toLowerCase().includes(searchLower) ||
        (entry.source && entry.source.toLowerCase().includes(searchLower))
      );
    }

    // Filter by time range
    if (filters.timeRange.start) {
      filtered = filtered.filter(entry =>
        new Date(entry.timestamp) >= new Date(filters.timeRange.start!)
      );
    }

    if (filters.timeRange.end) {
      filtered = filtered.filter(entry =>
        new Date(entry.timestamp) <= new Date(filters.timeRange.end!)
      );
    }

    return filtered;
  }, [entries, filters]);

  const updateFilters = useCallback((newFilters: Partial<ConsoleFilterOptions>) => {
    setFilters((prev: any) => ({ ...prev, ...newFilters }));
  }, []);

  // Load entries with proper pagination
  const loadEntries = useCallback(async (page: number = 1, append: boolean = false) => {
    if (!fileId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.getLogEntries(fileId, page, pageSize);

      // Append or replace based on pagination
      if (append) {
        setEntries(prev => [...prev, ...response.entries]);
      } else {
        setEntries(response.entries);
      }

      setCurrentPage(response.pagination.currentPage);
      setTotalPages(response.pagination.totalPages);
      setTotalEntries(response.pagination.totalEntries); // ✅ NEW: Store total entries
      setHasMore(response.pagination.hasMore);
    } catch (err) {
      setError((err as Error).message);
      console.error('Failed to load log entries:', err);
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  // Load stats
  const loadStats = useCallback(async () => {
    if (!fileId) return;

    try {
      const data = await apiClient.getLogStats(fileId);
      setStats(data);
    } catch (err) {
      console.error('Failed to load log stats:', err);
    }
  }, [fileId]);

  // Load status
  const loadStatus = useCallback(async () => {
    if (!fileId) return;

    try {
      const data = await apiClient.getLogStatus(fileId);
      setStatus(data);

      // Only load entries if ready and not already loaded
      if (data.status === 'ready' && entries.length === 0) {
        await loadEntries(1, false);
        await loadStats();
      }
    } catch (err) {
      console.error('Failed to load file status:', err);
    }
  }, [fileId, entries.length, loadEntries, loadStats]);

  // Load more entries
  const loadMore = useCallback(() => {
    if (hasMore && !loading) {
      loadEntries(currentPage + 1, true);
    }
  }, [currentPage, hasMore, loading, loadEntries]);

  // Refresh from beginning
  const refresh = useCallback(() => {
    setEntries([]);
    setCurrentPage(1);
    loadEntries(1, false);
  }, [loadEntries]);

  // WebSocket listeners
  useEffect(() => {
    if (!fileId) return;

    wsClient.subscribeToFile(fileId);

    const handleStatus = (data: any) => {
      if (data.fileId === fileId) {
        setStatus(prev => ({ ...prev, ...data } as FileStatus));

        // Load entries when ready
        if (data.status === 'ready') {
          loadEntries(1, false);
          loadStats();
        }
      }
    };

    const handleProgress = (data: any) => {
      if (data.fileId === fileId) {
        setStatus(prev =>
          prev ? { ...prev, progress: data.progress } : null
        );
      }
    };

    wsClient.on('file:status', handleStatus);
    wsClient.on('processing:progress', handleProgress);

    return () => {
      wsClient.off('file:status', handleStatus);
      wsClient.off('processing:progress', handleProgress);
    };
  }, [fileId, loadEntries, loadStats]);

  // Initial load
  useEffect(() => {
    if (fileId) {
      loadStatus();
    } else {
      // Reset state when fileId is null
      setEntries([]);
      setFilters(DEFAULT_FILTERS);
      setStats(null);
      setStatus(null);
      setCurrentPage(1);
      setTotalPages(1);
      setTotalEntries(0); // ✅ NEW: Reset total entries
      setError(null);
    }
  }, [fileId, loadStatus]);

  return {
    entries,
    filteredEntries,
    filters,
    updateFilters,
    stats,
    status,
    loading,
    error,
    currentPage,
    totalPages,
    totalEntries, // ✅ NEW: Return total entries
    hasMore,
    loadMore,
    refresh
  };
}
