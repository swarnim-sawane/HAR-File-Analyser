import { describe, expect, it } from 'vitest';
import type { ConsoleLogEntry } from '../../types/consolelog';
import { buildConsoleLogIssueMap } from '../consoleLogIssueMap';

function entry(
  index: number,
  level: ConsoleLogEntry['level'],
  message: string,
  options: Partial<ConsoleLogEntry> = {},
): ConsoleLogEntry {
  return {
    id: `entry-${index}`,
    index,
    timestamp: new Date(Date.UTC(2026, 3, 23, 10, 37, index)).toISOString(),
    level,
    message,
    source: options.source ?? 'webapp.js',
    inferredSeverity: options.inferredSeverity ?? (level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'none'),
    issueTags: options.issueTags ?? [],
    primaryIssue: options.primaryIssue,
    rawText: options.rawText,
    url: options.url,
  };
}

describe('buildConsoleLogIssueMap', () => {
  it('keeps unrelated informational rows grouped without inferred edges', () => {
    const map = buildConsoleLogIssueMap([
      entry(0, 'info', 'Application boot complete'),
      entry(1, 'log', 'Loaded dashboard widgets'),
    ]);

    expect(map.summary.totalEntries).toBe(2);
    expect(map.summary.relationCount).toBe(0);
    expect(map.edges).toEqual([]);
    expect(map.groups.map(group => group.id)).toContain('informational');
    expect(map.nodes.every(node => node.groupId === 'informational')).toBe(true);
  });

  it('connects direct CORS evidence to a nearby failed fetch', () => {
    const map = buildConsoleLogIssueMap([
      entry(0, 'error', "Access to fetch at 'https://api.example.com/orders' has been blocked by CORS policy.", {
        issueTags: ['cors', 'network'],
        primaryIssue: 'cors',
      }),
      entry(1, 'error', 'TypeError: Failed to fetch', {
        issueTags: ['network', 'exception'],
        primaryIssue: 'network',
      }),
    ]);

    expect(map.edges).toHaveLength(1);
    expect(map.edges[0]).toEqual(expect.objectContaining({
      label: 'CORS block -> failed fetch',
      confidence: 'high',
    }));
    expect(map.groups.map(group => group.id)).toContain('cors-network');
  });

  it('collapses repeated error signatures into one clickable cluster node', () => {
    const map = buildConsoleLogIssueMap([
      entry(0, 'error', "TypeError: Cannot read properties of undefined (reading 'id')", {
        issueTags: ['exception'],
        primaryIssue: 'exception',
      }),
      entry(1, 'error', "TypeError: Cannot read properties of undefined (reading 'id')", {
        issueTags: ['exception'],
        primaryIssue: 'exception',
      }),
      entry(2, 'error', "TypeError: Cannot read properties of undefined (reading 'id')", {
        issueTags: ['exception'],
        primaryIssue: 'exception',
      }),
    ]);

    expect(map.nodes).toHaveLength(1);
    expect(map.nodes[0]).toEqual(expect.objectContaining({
      count: 3,
      title: 'Repeated TypeError',
      groupId: 'runtime-exceptions',
    }));
    expect(map.nodes[0].representativeEntry.index).toBe(0);
    expect(map.nodes[0].firstTimestamp).toBe(entry(0, 'error', '').timestamp);
    expect(map.nodes[0].lastTimestamp).toBe(entry(2, 'error', '').timestamp);
  });

  it('returns a bounded empty model for an empty log', () => {
    const map = buildConsoleLogIssueMap([]);

    expect(map.nodes).toEqual([]);
    expect(map.edges).toEqual([]);
    expect(map.groups).toEqual([]);
    expect(map.summary).toEqual(expect.objectContaining({
      totalEntries: 0,
      relationCount: 0,
    }));
  });

  it('keeps node ordering stable when mixed-severity input arrives out of order', () => {
    const entries = [
      entry(2, 'warn', 'Request timeout while loading dashboard', { issueTags: ['network'], primaryIssue: 'network' }),
      entry(0, 'error', 'TypeError: Failed to fetch', { issueTags: ['network'], primaryIssue: 'network' }),
      entry(1, 'info', 'User clicked refresh'),
    ];

    const forward = buildConsoleLogIssueMap(entries);
    const reversed = buildConsoleLogIssueMap([...entries].reverse());

    expect(reversed.nodes.map(node => node.id)).toEqual(forward.nodes.map(node => node.id));
    expect(reversed.nodes.map(node => node.representativeEntry.index)).toEqual(
      forward.nodes.map(node => node.representativeEntry.index),
    );
  });

  it('groups framework noise without creating a false flow', () => {
    const map = buildConsoleLogIssueMap([
      entry(0, 'info', 'Oracle OTel Client has been initialized', { source: 'otel.js' }),
      entry(1, 'log', '@ zone.js:2702', { source: 'zone.js:2702' }),
      entry(2, 'error', '@ logCustomWriter.js:28', {
        source: 'logCustomWriter.js:28',
        inferredSeverity: 'error',
      }),
    ]);

    expect(map.edges).toEqual([]);
    expect(map.groups.map(group => group.id)).toContain('framework-noise');
    expect(map.summary.relationCount).toBe(0);
  });
});
