import { describe, expect, it } from 'vitest';
import type { ConsoleLogEntry } from '../../types/consolelog';
import { ConsoleLogAnalyzer } from '../consoleLogAnalyzer';

const baseEntry: ConsoleLogEntry = {
  id: 'entry-1',
  timestamp: '2026-04-28T00:00:00.000Z',
  level: 'log',
  message: 'plain console line',
  rawText: 'plain console line',
  inferredSeverity: 'none',
  issueTags: [],
};

describe('ConsoleLogAnalyzer effective levels', () => {
  it('filters, groups, and counts inferred CORS errors as displayed errors', () => {
    const corsEntry: ConsoleLogEntry = {
      ...baseEntry,
      id: 'cors-entry',
      message: "Access to fetch has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header.",
      rawText: "Access to fetch has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header.",
      inferredSeverity: 'error',
      issueTags: ['cors', 'network'],
      primaryIssue: 'cors',
    };

    const entries = [baseEntry, corsEntry];

    expect(ConsoleLogAnalyzer.filterByLevel(entries, ['error'])).toEqual([corsEntry]);
    expect(ConsoleLogAnalyzer.groupByLevel(entries).get('error')).toEqual([corsEntry]);

    const stats = ConsoleLogAnalyzer.getStatistics(entries);
    expect(stats.levelCounts.error).toBe(1);
    expect(stats.levelCounts.log).toBe(1);
    expect(stats.topErrors[0]).toMatchObject({
      message: expect.stringContaining('blocked by CORS policy'),
      count: 1,
    });
  });
});
