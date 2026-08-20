import { describe, expect, it } from 'vitest';
import type { ConsoleLogEntry, ConsoleLogFile } from '../../types/consolelog';
import { buildConsoleLogCompare } from '../consoleLogCompare';

function logFile(fileName: string, entries: Array<Partial<ConsoleLogEntry> & Pick<ConsoleLogEntry, 'level' | 'message'>>): ConsoleLogFile {
  return {
    metadata: {
      fileName,
      uploadedAt: '2026-04-23T10:37:00.000Z',
      totalEntries: entries.length,
    },
    entries: entries.map((entry, index) => ({
      id: `${fileName}-${index}`,
      index,
      timestamp: new Date(Date.UTC(2026, 3, 23, 10, 37, index)).toISOString(),
      source: entry.source ?? 'console',
      inferredSeverity: entry.inferredSeverity ?? (entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warning' : 'info'),
      issueTags: entry.issueTags ?? [],
      ...entry,
    })),
  };
}

describe('buildConsoleLogCompare', () => {
  it('summarizes changed severity, new issue tags, and repeated messages between two console logs', () => {
    const result = buildConsoleLogCompare(
      logFile('before.log', [
        { level: 'info', message: 'Application boot complete', source: 'app.js' },
        { level: 'warn', message: 'HTTP 404 while loading optional translation bundle', source: 'legacy.js', issueTags: ['http-4xx'] },
      ]),
      logFile('after.log', [
        { level: 'info', message: 'Application boot complete', source: 'app.js' },
        { level: 'error', message: 'TypeError: Failed to fetch', source: 'api.js', issueTags: ['network'] },
        { level: 'error', message: 'Access blocked by CORS policy', source: 'api.js', issueTags: ['cors'] },
      ]),
    );

    expect(result.metricsA.errorCount).toBe(0);
    expect(result.metricsB.errorCount).toBe(2);
    expect(result.levelDeltas.error).toBe(2);
    expect(result.newIssueTags).toEqual(['cors', 'network']);
    expect(result.removedIssueTags).toEqual(['http-4xx']);
    expect(result.newErrors.map(item => item.message)).toEqual([
      'TypeError: Failed to fetch',
      'Access blocked by CORS policy',
    ]);
    expect(result.summary).toContain('2 more errors');
  });

  it('classifies every signature delta and retains evidence without weak similarity matching', () => {
    const baseline = logFile('baseline.log', [
      { level: 'error', message: 'Resolved failure', source: 'api.js' },
      { level: 'warn', message: 'Increasing warning', source: 'queue.js' },
      { level: 'warn', message: 'Decreasing warning', source: 'queue.js' },
      { level: 'warn', message: 'Decreasing warning', source: 'queue.js' },
      { level: 'info', message: 'Unchanged checkpoint', source: 'app.js' },
      { level: 'error', message: 'Request failed for tenant alpha', source: 'api.js' },
    ]);
    const comparison = logFile('comparison.log', [
      { level: 'error', message: 'New failure', source: 'api.js' },
      { level: 'warn', message: 'Increasing warning', source: 'queue.js' },
      { level: 'warn', message: 'Increasing warning', source: 'queue.js' },
      { level: 'warn', message: 'Decreasing warning', source: 'queue.js' },
      { level: 'info', message: 'Unchanged checkpoint', source: 'app.js' },
      { level: 'error', message: 'Request failed for tenant beta', source: 'api.js' },
    ]);

    const result = buildConsoleLogCompare(baseline, comparison);
    const statusFor = (message: string) => result.signatureDeltas.find(item => item.message === message)?.status;

    expect(statusFor('New failure')).toBe('new');
    expect(statusFor('Resolved failure')).toBe('resolved');
    expect(statusFor('Increasing warning')).toBe('increased');
    expect(statusFor('Decreasing warning')).toBe('decreased');
    expect(statusFor('Unchanged checkpoint')).toBe('unchanged');
    expect(statusFor('Request failed for tenant alpha')).toBe('resolved');
    expect(statusFor('Request failed for tenant beta')).toBe('new');

    const increased = result.signatureDeltas.find(item => item.message === 'Increasing warning');
    expect(increased).toEqual(expect.objectContaining({ countA: 1, countB: 2, delta: 1 }));
    expect(increased?.evidenceA).toHaveLength(1);
    expect(increased?.evidenceB).toHaveLength(2);

    const repeatedRun = buildConsoleLogCompare(baseline, comparison);
    expect(repeatedRun.signatureDeltas.map(item => [item.signature, item.status, item.delta])).toEqual(
      result.signatureDeltas.map(item => [item.signature, item.status, item.delta]),
    );
  });
});
