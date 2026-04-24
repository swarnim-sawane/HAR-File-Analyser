// src/types/consolelog.ts

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'verbose';

export interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  source?: string;
  lineNumber?: number;
  columnNumber?: number;
  stackTrace?: string;
  args?: any[];
  url?: string;
  category?: string;
}

export interface ConsoleLogFile {
  metadata: {
    fileName: string;
    uploadedAt: string;
    totalEntries: number;
    browser?: string;
    version?: string;
    /** Set when the backend has more entries than were loaded into the browser */
    truncatedAt?: number;
  };
  entries: ConsoleLogEntry[];
}

export interface ConsoleFilterOptions {
  levels: {
    log: boolean;
    info: boolean;
    warn: boolean;
    error: boolean;
    debug: boolean;
    trace: boolean;
    verbose: boolean;
  };
  searchTerm: string;
  groupBy: 'all' | 'level' | 'source';
  timeRange: {
    start: string | null;
    end: string | null;
  };
}

export type ConsoleLogSortField = 'timestamp' | 'level' | 'source' | 'message';

export interface ConsoleLogEntrySummary extends ConsoleLogEntry {
  index: number;
  _id?: string;
  fileId?: string;
  createdAt?: string;
}

export interface ConsoleLogEntriesResponse {
  entries: ConsoleLogEntrySummary[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalEntries: number;
    hasMore: boolean;
    limit: number;
  };
}

export interface ConsoleLogQuery {
  page?: number;
  limit?: number;
  search?: string;
  levels?: LogLevel[];
  startTime?: string | null;
  endTime?: string | null;
  sortBy?: ConsoleLogSortField;
  sortDir?: 'asc' | 'desc';
}
