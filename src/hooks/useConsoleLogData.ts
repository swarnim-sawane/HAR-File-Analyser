// src/hooks/useConsoleLogData.ts

import { useState, useCallback, useMemo } from 'react';
import { ConsoleLogFile, ConsoleLogEntry, ConsoleFilterOptions, LogLevel } from '../types/consolelog';
import { ConsoleLogParser } from '../utils/consoleLogParser';
import { ConsoleLogAnalyzer } from '../utils/consoleLogAnalyzer';

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse log file');
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
    setSelectedEntry,
    updateFilters,
    clearData,
  };
};
