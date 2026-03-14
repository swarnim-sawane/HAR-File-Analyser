export interface LogEntry {
  index: number;
  timestamp: string | Date;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'verbose';
  message: string;
  source?: string;
  lineNumber?: number;
  columnNumber?: number;
  url?: string;
  category?: string;
  stackTrace?: string;
  args?: any[];
  metadata?: Record<string, any>;
}

export interface LogStats {
  totalLogs: number;
  byLevel: Record<string, number>;
  errorCount: number;
  warningCount: number;
  timeRange?: {
    start: string;
    end: string;
  };
  topSources?: Array<{ source: string; count: number }>;
  topCategories?: Array<{ category: string; count: number }>;
}

export interface LogFilter {
  levels?: string[];
  search?: string;
  source?: string;
  category?: string;
  startTime?: string;
  endTime?: string;
}

export interface ParsedLogEntry extends LogEntry {
  formatted?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
}
