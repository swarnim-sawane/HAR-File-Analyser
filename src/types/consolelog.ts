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
