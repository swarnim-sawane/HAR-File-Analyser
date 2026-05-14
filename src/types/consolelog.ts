// src/types/consolelog.ts

import type {
  ConsoleClassificationReason,
  ConsoleInferredSeverity,
  ConsoleIssueTag,
  ConsoleParseConfidence,
  ConsoleParseFormat,
  ConsoleParseStatus,
} from '../../shared/consoleLogCore';

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'verbose';
export type {
  ConsoleClassificationReason,
  ConsoleInferredSeverity,
  ConsoleIssueTag,
  ConsoleParseConfidence,
  ConsoleParseFormat,
  ConsoleParseStatus,
};

export type ConsoleQuickFocus =
  | 'all'
  | 'errors'
  | 'warnings'
  | ConsoleIssueTag;

export interface ConsoleLogEntry {
  id: string;
  index?: number;
  timestamp: string;
  level: LogLevel;
  originalLevel?: LogLevel;
  message: string;
  source?: string;
  lineNumber?: number;
  columnNumber?: number;
  stackTrace?: string;
  args?: any[];
  url?: string;
  category?: string;
  rawText?: string;
  inferredSeverity: ConsoleInferredSeverity;
  issueTags: ConsoleIssueTag[];
  primaryIssue?: ConsoleIssueTag;
  classificationReasons?: ConsoleClassificationReason[];
  parseStatus?: ConsoleParseStatus;
  parseFormat?: ConsoleParseFormat;
  parseConfidence?: ConsoleParseConfidence;
  parseWarnings?: string[];
  fileId?: string;
  _id?: string;
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
  quickFocus: ConsoleQuickFocus;
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
  facets?: ConsoleLogFacets;
}

export interface ConsoleLogQuery {
  page?: number;
  limit?: number;
  search?: string;
  levels?: LogLevel[];
  quickFocus?: ConsoleQuickFocus;
  startTime?: string | null;
  endTime?: string | null;
  sortBy?: ConsoleLogSortField;
  sortDir?: 'asc' | 'desc';
}

export interface ConsoleLogFacets {
  levelCounts: Partial<Record<LogLevel, number>>;
  issueTagCounts: Record<string, number>;
  topSources: Array<{ source: string; count: number }>;
  parseStatusCounts?: Partial<Record<ConsoleParseStatus, number>>;
  parseFormatCounts?: Partial<Record<ConsoleParseFormat, number>>;
  parseWarningCounts?: Record<string, number>;
}
