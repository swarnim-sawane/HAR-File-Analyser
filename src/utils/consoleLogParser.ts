// src/utils/consoleLogParser.ts

import { ConsoleLogEntry, ConsoleLogFile, LogLevel } from '../types/consolelog';
import { v4 as uuidv4 } from 'uuid';

export class ConsoleLogParser {
  // Parse JSON format (Chrome DevTools, custom formats)
  static parseJSON(content: string, fileName: string): ConsoleLogFile {
    try {
      const parsed = JSON.parse(content);

      // Check if it's already in our format
      if (parsed.metadata && parsed.entries) {
        return parsed;
      }

      // Check if it's an array of log entries
      if (Array.isArray(parsed)) {
        return this.parseJSONArray(parsed, fileName);
      }

      // Check if it's a single object with logs array
      if (parsed.logs && Array.isArray(parsed.logs)) {
        return this.parseJSONArray(parsed.logs, fileName);
      }

      throw new Error('Unrecognized JSON format');
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private static parseJSONArray(logs: any[], fileName: string): ConsoleLogFile {
    const entries: ConsoleLogEntry[] = logs.map((log) => {
      return {
        id: log.id || uuidv4(),
        timestamp: log.timestamp || log.time || log.timeStamp || new Date().toISOString(),
        level: this.normalizeLogLevel(log.level || log.type || log.severity || 'log'),
        message: log.message || log.msg || log.text || String(log),
        source: log.source || log.file || log.filename || undefined,
        lineNumber: log.lineNumber || log.line || log.lineno || undefined,
        columnNumber: log.columnNumber || log.column || log.colno || undefined,
        stackTrace: log.stackTrace || log.stack || log.trace || undefined,
        args: log.args || log.arguments || log.data || undefined,
        url: log.url || log.uri || log.location || undefined,
        category: log.category || log.tag || undefined,
      };
    });

    return {
      metadata: {
        fileName,
        uploadedAt: new Date().toISOString(),
        totalEntries: entries.length,
      },
      entries,
    };
  }

  // Parse plain text format with multiline support
  static parsePlainText(content: string, fileName: string): ConsoleLogFile {
    const lines = content.split('\n');
    const entries: ConsoleLogEntry[] = [];
    let currentEntry: ConsoleLogEntry | null = null;
    let stackTraceLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if this line is a stack trace continuation
      const isStackTraceLine = this.isStackTraceLine(line);
      
      if (isStackTraceLine && currentEntry) {
        // Accumulate stack trace lines
        stackTraceLines.push(line.trim());
        continue;
      }

      // If we have a current entry with stack trace, finalize it
      if (currentEntry && stackTraceLines.length > 0) {
        currentEntry.stackTrace = stackTraceLines.join('\n');
        entries.push(currentEntry);
        currentEntry = null;
        stackTraceLines = [];
      }

      // Try to parse the line as a new log entry
      const entry = this.parsePlainTextLine(line.trim());
      
      if (entry) {
        // If we have a pending entry, push it first
        if (currentEntry) {
          if (stackTraceLines.length > 0) {
            currentEntry.stackTrace = stackTraceLines.join('\n');
            stackTraceLines = [];
          }
          entries.push(currentEntry);
        }
        currentEntry = entry;
      } else if (currentEntry && line.trim()) {
        // This might be a continuation of the previous message
        currentEntry.message += '\n' + line.trim();
      }
    }

    // Don't forget the last entry
    if (currentEntry) {
      if (stackTraceLines.length > 0) {
        currentEntry.stackTrace = stackTraceLines.join('\n');
      }
      entries.push(currentEntry);
    }

    return {
      metadata: {
        fileName,
        uploadedAt: new Date().toISOString(),
        totalEntries: entries.length,
      },
      entries,
    };
  }

  private static isStackTraceLine(line: string): boolean {
    const trimmed = line.trim();
    return (
      trimmed.startsWith('at ') ||
      trimmed.startsWith('    at ') ||
      /^\s+at\s+/.test(line) ||
      /^\s+\w+@/.test(line) || // Firefox format
      /^\s+.*:\d+:\d+/.test(line) // file:line:col
    );
  }

  private static parsePlainTextLine(line: string): ConsoleLogEntry | null {
    if (!line.trim()) return null;

    // Pattern 1: Chrome/Edge DevTools format with timestamp
    // [12:34:56.789] ERROR: Something went wrong
    // [2024-01-16T12:34:56.789Z] ERROR: Something went wrong
    const chromePattern = /^\[([^\]]+)\]\s*(\w+):\s*(.+)$/;
    const chromeMatch = line.match(chromePattern);
    if (chromeMatch) {
      return {
        id: uuidv4(),
        timestamp: this.normalizeTimestamp(chromeMatch[1]),
        level: this.normalizeLogLevel(chromeMatch[2]),
        message: chromeMatch[3],
      };
    }

    // Pattern 2: Browser console with source
    // ERROR: Message http://example.com/script.js:123:45
    const browserPattern = /^(\w+):\s*(.+?)\s+(https?:\/\/[^\s]+):(\d+):(\d+)$/;
    const browserMatch = line.match(browserPattern);
    if (browserMatch) {
      return {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        level: this.normalizeLogLevel(browserMatch[1]),
        message: browserMatch[2],
        url: browserMatch[3],
        lineNumber: parseInt(browserMatch[4]),
        columnNumber: parseInt(browserMatch[5]),
      };
    }

    // Pattern 3: ISO timestamp with level
    // 2024-01-16T12:34:56.789Z ERROR Something went wrong
    // 2024-01-16 12:34:56.789 ERROR Something went wrong
    const isoPattern = /^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?)\s+(\w+)\s+(.+)$/;
    const isoMatch = line.match(isoPattern);
    if (isoMatch) {
      return {
        id: uuidv4(),
        timestamp: this.normalizeTimestamp(isoMatch[1]),
        level: this.normalizeLogLevel(isoMatch[2]),
        message: isoMatch[3],
      };
    }

    // Pattern 4: Unix timestamp
    // 1705401234567 ERROR Something went wrong
    const unixPattern = /^(\d{10,13})\s+(\w+)\s+(.+)$/;
    const unixMatch = line.match(unixPattern);
    if (unixMatch) {
      const timestamp = parseInt(unixMatch[1]);
      const date = timestamp > 10000000000 ? new Date(timestamp) : new Date(timestamp * 1000);
      return {
        id: uuidv4(),
        timestamp: date.toISOString(),
        level: this.normalizeLogLevel(unixMatch[2]),
        message: unixMatch[3],
      };
    }

    // Pattern 5: Level with file source and line
    // ERROR: Something went wrong at file.js:10:15
    // ERROR file.js:10 Something went wrong
    const sourcePattern = /^(\w+)[:\s]+(?:(.+?)\s+at\s+)?(.+?):(\d+):(\d+)\s*(.*)$/;
    const sourceMatch = line.match(sourcePattern);
    if (sourceMatch && this.isValidLogLevel(sourceMatch[1])) {
      return {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        level: this.normalizeLogLevel(sourceMatch[1]),
        message: sourceMatch[2] || sourceMatch[6] || '',
        source: sourceMatch[3],
        lineNumber: parseInt(sourceMatch[4]),
        columnNumber: parseInt(sourceMatch[5]),
      };
    }

    // Pattern 6: Simple level prefix
    // ERROR: Something went wrong
    // [ERROR] Something went wrong
    const simplePattern = /^[\[]?(\w+)[\]]?:\s*(.+)$/;
    const simpleMatch = line.match(simplePattern);
    if (simpleMatch && this.isValidLogLevel(simpleMatch[1])) {
      return {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        level: this.normalizeLogLevel(simpleMatch[1]),
        message: simpleMatch[2],
      };
    }

    // Pattern 7: Time-only timestamp
    // 12:34:56.789 ERROR Something went wrong
    const timePattern = /^(\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?)\s+(\w+)\s+(.+)$/;
    const timeMatch = line.match(timePattern);
    if (timeMatch && this.isValidLogLevel(timeMatch[2])) {
      const today = new Date().toISOString().split('T')[0];
      return {
        id: uuidv4(),
        timestamp: `${today}T${timeMatch[1].replace(',', '.')}Z`,
        level: this.normalizeLogLevel(timeMatch[2]),
        message: timeMatch[3],
      };
    }

    // Pattern 8: Starts with known level word
    // ERROR Something went wrong
    const levelWordPattern = /^(\w+)\s+(.+)$/;
    const levelWordMatch = line.match(levelWordPattern);
    if (levelWordMatch && this.isValidLogLevel(levelWordMatch[1])) {
      return {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        level: this.normalizeLogLevel(levelWordMatch[1]),
        message: levelWordMatch[2],
      };
    }

    // Default: treat entire line as a log message
    return {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level: 'log',
      message: line,
    };
  }

  private static isValidLogLevel(level: string): boolean {
    const normalized = level.toLowerCase();
    const validLevels = ['log', 'info', 'warn', 'warning', 'error', 'err', 'debug', 'trace', 'verbose', 'fatal', 'critical'];
    return validLevels.includes(normalized);
  }

  private static normalizeTimestamp(timestamp: string): string {
    // Try parsing as ISO date
    try {
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    } catch {}

    // If it's just a time (HH:MM:SS), add today's date
    if (/^\d{2}:\d{2}:\d{2}/.test(timestamp)) {
      const today = new Date().toISOString().split('T')[0];
      return `${today}T${timestamp.replace(',', '.')}Z`;
    }

    // Return as-is if we can't parse
    return timestamp;
  }

  private static normalizeLogLevel(level: string): LogLevel {
    const normalized = level.toLowerCase().trim();
    const validLevels: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'verbose'];

    if (validLevels.includes(normalized as LogLevel)) {
      return normalized as LogLevel;
    }

    // Map common variations
    const levelMap: Record<string, LogLevel> = {
      'warning': 'warn',
      'err': 'error',
      'fatal': 'error',
      'critical': 'error',
      'panic': 'error',
      'information': 'info',
      'inf': 'info',
      'dbg': 'debug',
      'verbose': 'verbose',
      'trace': 'trace',
      'notice': 'info',
      'emerg': 'error',
      'emergency': 'error',
      'alert': 'error',
      'crit': 'error',
    };

    return levelMap[normalized] || 'log';
  }

  // Auto-detect format and parse
  static async parseFile(file: File): Promise<ConsoleLogFile> {
    const content = await file.text();

    // Try JSON first
    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
      try {
        return this.parseJSON(content, file.name);
      } catch {
        // Fall through to plain text parsing
      }
    }

    // Parse as plain text
    return this.parsePlainText(content, file.name);
  }
}
