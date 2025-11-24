// src/hooks/useHarData.ts
import { useState, useCallback, useMemo } from 'react';
import { HarFile, Entry, FilterOptions } from '../types/har';
import { HarParser } from '../utils/harParser';
import { HarAnalyzer } from '../utils/harAnalyzer';

export interface UseHarDataReturn {
  harData: HarFile | null;
  filteredEntries: Entry[];
  selectedEntry: Entry | null;
  filters: FilterOptions;
  isLoading: boolean;
  error: string | null;
  loadHarFile: (file: File) => Promise<void>;
  setSelectedEntry: (entry: Entry | null) => void;
  updateFilters: (filters: Partial<FilterOptions>) => void;
  clearData: () => void;
  exportFilteredData: () => void;
}

export const useHarData = (): UseHarDataReturn => {
  const [harData, setHarData] = useState<HarFile | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterOptions>({
    statusCodes: {
      '0': false,
      '1xx': false,
      '2xx': true,
      '3xx': true,
      '4xx': true,
      '5xx': true,
    },
    groupBy: 'pages',
    searchTerm: '',
    timingType: 'relative',
  });

  const parser = useMemo(() => new HarParser(), []);

  const loadHarFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const parsed = await parser.parseFile(file);
      setHarData(parsed);
      setSelectedEntry(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to parse HAR file';
      setError(errorMessage);
      console.error('HAR parsing error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [parser]);

  const updateFilters = useCallback((newFilters: Partial<FilterOptions>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  const clearData = useCallback(() => {
    setHarData(null);
    setSelectedEntry(null);
    setError(null);
    setFilters({
      statusCodes: {
        '0': false,
        '1xx': false,
        '2xx': true,
        '3xx': true,
        '4xx': true,
        '5xx': true,
      },
      groupBy: 'pages',
      searchTerm: '',
      timingType: 'relative',
    });
  }, []);

  const exportFilteredData = useCallback(() => {
    if (!harData) return;

    const dataToExport = {
      log: {
        ...harData.log,
        entries: filteredEntries,
      },
    };

    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `filtered-har-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [harData]);

  const filteredEntries = useMemo(() => {
    if (!harData) return [];

    let entries = parser.getEntries();

    // Filter by status codes
    const activeStatusCodes = Object.entries(filters.statusCodes)
      .filter(([_, isActive]) => isActive)
      .map(([code]) => code);

    // Only filter if at least one checkbox is checked
    if (activeStatusCodes.length > 0) {
      entries = entries.filter(entry => {
        const status = entry.response.status;
        
        return activeStatusCodes.some(code => {
          if (code === '0') return status === 0;
          if (code === '1xx') return status >= 100 && status < 200;
          if (code === '2xx') return status >= 200 && status < 300;
          if (code === '3xx') return status >= 300 && status < 400;
          if (code === '4xx') return status >= 400 && status < 500;
          if (code === '5xx') return status >= 500 && status < 600;
          return false;
        });
      });
    }

    // Search filter
    if (filters.searchTerm.trim()) {
      entries = HarAnalyzer.searchEntries(entries, filters.searchTerm);
    }

    return entries;
  }, [harData, filters, parser]);

  return {
    harData,
    filteredEntries,
    selectedEntry,
    filters,
    isLoading,
    error,
    loadHarFile,
    setSelectedEntry,
    updateFilters,
    clearData,
    exportFilteredData,
  };
};
