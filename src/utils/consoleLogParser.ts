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
    const entries: ConsoleLogEntry[] = logs.map((log, index) => {
      return {
        id: log.id || uuidv4(),
        timestamp: log.timestamp || log.time || new Date().toISOString(),
        level: this.normalizeLogLevel(log.level || log.type || 'log'),
        message: log.message || log.msg || String(log),
        source: log.source || log.file || undefined,
        lineNumber: log.lineNumber || log.line || undefined,
        columnNumber: log.columnNumber || log.column || undefined,
        stackTrace: log.stackTrace || log.stack || undefined,
        args: log.args || log.arguments || undefined,
        url: log.url || undefined,
        category: log.category || undefined,
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

  // Parse plain text format
  static parsePlainText(content: string, fileName: string): ConsoleLogFile {
    const lines = content.split('\n').filter(line => line.trim());
    const entries: ConsoleLogEntry[] = [];

    for (const line of lines) {
      const entry = this.parsePlainTextLine(line);
      if (entry) {
        entries.push(entry);
      }
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

  private static parsePlainTextLine(line: string): ConsoleLogEntry | null {
    if (!line.trim()) return null;

    // Pattern 1: Chrome DevTools format
    // [timestamp] level message
    const chromePattern = /^\[([^\]]+)\]\s+(\w+):\s+(.+)$/;
    const chromeMatch = line.match(chromePattern);
    if (chromeMatch) {
      return {
        id: uuidv4(),
        timestamp: chromeMatch[1],
        level: this.normalizeLogLevel(chromeMatch[2]),
        message: chromeMatch[3],
      };
    }

    // Pattern 2: Timestamp level message
    // 2023-11-27T10:30:45.123Z ERROR Something went wrong
    const isoPattern = /^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(\w+)\s+(.+)$/;
    const isoMatch = line.match(isoPattern);
    if (isoMatch) {
      return {
        id: uuidv4(),
        timestamp: isoMatch[1],
        level: this.normalizeLogLevel(isoMatch[2]),
        message: isoMatch[3],
      };
    }

    // Pattern 3: Level: message at source:line:column
    // ERROR: Something went wrong at file.js:10:15
    const sourcePattern = /^(\w+):\s+(.+?)\s+at\s+(.+?):(\d+):(\d+)$/;
    const sourceMatch = line.match(sourcePattern);
    if (sourceMatch) {
      return {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        level: this.normalizeLogLevel(sourceMatch[1]),
        message: sourceMatch[2],
        source: sourceMatch[3],
        lineNumber: parseInt(sourceMatch[4]),
        columnNumber: parseInt(sourceMatch[5]),
      };
    }

    // Pattern 4: Just level and message
    // ERROR: Something went wrong
    const simplePattern = /^(\w+):\s+(.+)$/;
    const simpleMatch = line.match(simplePattern);
    if (simpleMatch) {
      const possibleLevel = simpleMatch[1].toLowerCase();
      if (['log', 'info', 'warn', 'error', 'debug', 'trace', 'verbose'].includes(possibleLevel)) {
        return {
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          level: this.normalizeLogLevel(simpleMatch[1]),
          message: simpleMatch[2],
        };
      }
    }

    // Default: treat entire line as a log message
    return {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level: 'log',
      message: line,
    };
  }

  private static normalizeLogLevel(level: string): LogLevel {
    const normalized = level.toLowerCase();
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
      'information': 'info',
      'dbg': 'debug',
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
