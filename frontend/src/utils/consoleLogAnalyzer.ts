// src/utils/consoleLogAnalyzer.ts

import { LogEntry } from '../../../shared/types/consolelog';  // ✅ Updated import path and type

export class ConsoleLogAnalyzer {
  static filterByLevel(entries: LogEntry[], levels: string[]): LogEntry[] {
    return entries.filter(entry => levels.includes(entry.level));
  }

  static searchEntries(entries: LogEntry[], term: string): LogEntry[] {
    const lowerTerm = term.toLowerCase();
    return entries.filter(entry =>
      entry.message.toLowerCase().includes(lowerTerm) ||
      entry.args?.toString().toLowerCase().includes(lowerTerm)
    );
  }

  static groupByLevel(entries: LogEntry[]): Map<string, LogEntry[]> {
    const grouped = new Map<string, LogEntry[]>();

    entries.forEach(entry => {
      const existing = grouped.get(entry.level) || [];
      grouped.set(entry.level, [...existing, entry]);
    });

    return grouped;
  }

  static getStatistics(entries: LogEntry[]) {
    const levelCounts: Record<string, number> = {};

    let entriesWithStackTrace = 0;

    entries.forEach(entry => {
      // Count by level
      levelCounts[entry.level] = (levelCounts[entry.level] || 0) + 1;

      // Check for stack trace in args
      if (entry.args && Array.isArray(entry.args)) {
        const hasStack = entry.args.some(arg => 
          typeof arg === 'string' && (arg.includes('at ') || arg.includes('Error'))
        );
        if (hasStack) entriesWithStackTrace++;
      }
    });

    const timeRange = this.getTimeRange(entries);
    const topErrors = this.getTopErrors(entries);

    return {
      totalEntries: entries.length,
      levelCounts,
      entriesWithStackTrace,
      timeRange,
      topErrors,
    };
  }

  static getTimeRange(entries: LogEntry[]): { start: string; end: string } | null {
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

  static getTopErrors(entries: LogEntry[], limit: number = 10): Array<{ message: string; count: number }> {
    const errorEntries = entries.filter(e => e.level.toLowerCase() === 'error');
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
    entries: LogEntry[],
    start: string | null,
    end: string | null
  ): LogEntry[] {
    return entries.filter(entry => {
      const timestamp = new Date(entry.timestamp).getTime();
      if (isNaN(timestamp)) return true;

      if (start && timestamp < new Date(start).getTime()) return false;
      if (end && timestamp > new Date(end).getTime()) return false;

      return true;
    });
  }
}
