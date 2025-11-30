// src/utils/consoleLogAnalyzer.ts

import { ConsoleLogEntry, LogLevel } from '../types/consolelog';

export class ConsoleLogAnalyzer {
  static filterByLevel(entries: ConsoleLogEntry[], levels: LogLevel[]): ConsoleLogEntry[] {
    return entries.filter(entry => levels.includes(entry.level));
  }

  static searchEntries(entries: ConsoleLogEntry[], term: string): ConsoleLogEntry[] {
    const lowerTerm = term.toLowerCase();
    return entries.filter(entry =>
      entry.message.toLowerCase().includes(lowerTerm) ||
      entry.source?.toLowerCase().includes(lowerTerm) ||
      entry.url?.toLowerCase().includes(lowerTerm) ||
      entry.stackTrace?.toLowerCase().includes(lowerTerm)
    );
  }

  static groupByLevel(entries: ConsoleLogEntry[]): Map<LogLevel, ConsoleLogEntry[]> {
    const grouped = new Map<LogLevel, ConsoleLogEntry[]>();
    
    entries.forEach(entry => {
      const existing = grouped.get(entry.level) || [];
      grouped.set(entry.level, [...existing, entry]);
    });

    return grouped;
  }

  static groupBySource(entries: ConsoleLogEntry[]): Map<string, ConsoleLogEntry[]> {
    const grouped = new Map<string, ConsoleLogEntry[]>();
    
    entries.forEach(entry => {
      const source = entry.source || 'Unknown';
      const existing = grouped.get(source) || [];
      grouped.set(source, [...existing, entry]);
    });

    return grouped;
  }

  static getStatistics(entries: ConsoleLogEntry[]) {
    const levelCounts: Record<LogLevel, number> = {
      log: 0,
      info: 0,
      warn: 0,
      error: 0,
      debug: 0,
      trace: 0,
      verbose: 0,
    };

    const sourceCounts: Record<string, number> = {};
    let entriesWithStackTrace = 0;

    entries.forEach(entry => {
      levelCounts[entry.level]++;
      
      if (entry.source) {
        sourceCounts[entry.source] = (sourceCounts[entry.source] || 0) + 1;
      }

      if (entry.stackTrace) {
        entriesWithStackTrace++;
      }
    });

    const timeRange = this.getTimeRange(entries);
    const topErrors = this.getTopErrors(entries);
    const topSources = Object.entries(sourceCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([source, count]) => ({ source, count }));

    return {
      totalEntries: entries.length,
      levelCounts,
      sourceCounts: topSources,
      entriesWithStackTrace,
      timeRange,
      topErrors,
    };
  }

  static getTimeRange(entries: ConsoleLogEntry[]): { start: string; end: string } | null {
    if (entries.length === 0) return null;

    const timestamps = entries
      .map(e => new Date(e.timestamp).getTime())
      .filter(t => !isNaN(t));

    if (timestamps.length === 0) return null;

    return {
      start: new Date(Math.min(...timestamps)).toISOString(),
      end: new Date(Math.max(...timestamps)).toISOString(),
    };
  }

  static getTopErrors(entries: ConsoleLogEntry[], limit: number = 10): Array<{ message: string; count: number }> {
    const errorEntries = entries.filter(e => e.level === 'error');
    const messageCounts = new Map<string, number>();

    errorEntries.forEach(entry => {
      const msg = entry.message.substring(0, 100); // Truncate for grouping
      messageCounts.set(msg, (messageCounts.get(msg) || 0) + 1);
    });

    return Array.from(messageCounts.entries())
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  static filterByTimeRange(
    entries: ConsoleLogEntry[],
    start: string | null,
    end: string | null
  ): ConsoleLogEntry[] {
    return entries.filter(entry => {
      const timestamp = new Date(entry.timestamp).getTime();
      if (isNaN(timestamp)) return true;

      if (start && timestamp < new Date(start).getTime()) return false;
      if (end && timestamp > new Date(end).getTime()) return false;

      return true;
    });
  }
}
