import type { ConsoleIssueTag } from '../../shared/consoleLogCore';
import type { ConsoleLogEntry, ConsoleLogFile, LogLevel } from '../types/consolelog';
import { getConsoleDisplayLevel } from './consoleLogSeverity';

export interface ConsoleLogCompareMetrics {
  totalEntries: number;
  errorCount: number;
  warningCount: number;
  sourceCount: number;
  issueTagCount: number;
  topSources: Array<{ source: string; count: number }>;
}
export type ConsoleLogSignatureStatus = 'new' | 'resolved' | 'increased' | 'decreased' | 'unchanged';

export interface ConsoleLogSignatureDelta {
  signature: string;
  message: string;
  countA: number;
  countB: number;
  delta: number;
  status: ConsoleLogSignatureStatus;
  evidenceA: ConsoleLogEntry[];
  evidenceB: ConsoleLogEntry[];
}

export interface ConsoleLogCompareResult {
  metricsA: ConsoleLogCompareMetrics;
  metricsB: ConsoleLogCompareMetrics;
  levelDeltas: Partial<Record<LogLevel, number>>;
  newIssueTags: ConsoleIssueTag[];
  removedIssueTags: ConsoleIssueTag[];
  newErrors: ConsoleLogEntry[];
  resolvedErrors: ConsoleLogEntry[];
  signatureDeltas: ConsoleLogSignatureDelta[];
  repeatedMessages: Array<{ message: string; countA: number; countB: number; delta: number }>;
  summary: string;
}

const LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'log', 'debug', 'trace', 'verbose'];

function normalizeMessage(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8,}\b/gi, '{id}')
    .replace(/\b\d{2,}\b/g, '{n}')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function collectLevelCounts(entries: ConsoleLogEntry[]): Partial<Record<LogLevel, number>> {
  const counts: Partial<Record<LogLevel, number>> = {};
  for (const entry of entries) {
    const level = getConsoleDisplayLevel(entry);
    counts[level] = (counts[level] ?? 0) + 1;
  }
  return counts;
}

function collectIssueTags(entries: ConsoleLogEntry[]): ConsoleIssueTag[] {
  return Array.from(new Set(entries.flatMap(entry => entry.issueTags))).sort();
}

function collectMessageCounts(entries: ConsoleLogEntry[]): Map<string, { entry: ConsoleLogEntry; count: number; entries: ConsoleLogEntry[] }> {
  const counts = new Map<string, { entry: ConsoleLogEntry; count: number; entries: ConsoleLogEntry[] }>();
  for (const entry of entries) {
    const key = normalizeMessage(entry.message);
    const current = counts.get(key);
    counts.set(key, {
      entry: current?.entry ?? entry,
      count: (current?.count ?? 0) + 1,
      entries: [...(current?.entries ?? []), entry],
    });
  }
  return counts;
}

function buildMetrics(log: ConsoleLogFile): ConsoleLogCompareMetrics {
  const sourceCounts = new Map<string, number>();
  for (const entry of log.entries) {
    const source = entry.source || entry.url || 'Unknown';
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }

  const issueTags = collectIssueTags(log.entries);

  return {
    totalEntries: log.entries.length,
    errorCount: log.entries.filter(entry => getConsoleDisplayLevel(entry) === 'error' || entry.inferredSeverity === 'error').length,
    warningCount: log.entries.filter(entry => getConsoleDisplayLevel(entry) === 'warn' || entry.inferredSeverity === 'warning').length,
    sourceCount: sourceCounts.size,
    issueTagCount: issueTags.length,
    topSources: [...sourceCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([source, count]) => ({ source, count })),
  };
}
function buildSummary(metricsA: ConsoleLogCompareMetrics, metricsB: ConsoleLogCompareMetrics): string {
  const errorDelta = metricsB.errorCount - metricsA.errorCount;
  const warningDelta = metricsB.warningCount - metricsA.warningCount;
  const entryDelta = metricsB.totalEntries - metricsA.totalEntries;
  const parts: string[] = [];

  if (errorDelta !== 0) {
    parts.push(`${Math.abs(errorDelta)} ${errorDelta > 0 ? 'more' : 'fewer'} errors`);
  }
  if (warningDelta !== 0) {
    parts.push(`${Math.abs(warningDelta)} ${warningDelta > 0 ? 'more' : 'fewer'} warnings`);
  }
  if (entryDelta !== 0) {
    parts.push(`${Math.abs(entryDelta)} ${entryDelta > 0 ? 'more' : 'fewer'} total entries`);
  }

  return parts.length > 0
    ? `Comparison log has ${parts.join(', ')} than the baseline.`
    : 'Both console logs have similar severity counts and entry volume.';
}

export function buildConsoleLogCompare(logA: ConsoleLogFile, logB: ConsoleLogFile): ConsoleLogCompareResult {
  const metricsA = buildMetrics(logA);
  const metricsB = buildMetrics(logB);
  const levelCountsA = collectLevelCounts(logA.entries);
  const levelCountsB = collectLevelCounts(logB.entries);
  const levelDeltas: Partial<Record<LogLevel, number>> = {};

  for (const level of LOG_LEVELS) {
    const delta = (levelCountsB[level] ?? 0) - (levelCountsA[level] ?? 0);
    if (delta !== 0) levelDeltas[level] = delta;
  }

  const tagsA = collectIssueTags(logA.entries);
  const tagsB = collectIssueTags(logB.entries);
  const newIssueTags = tagsB.filter(tag => !tagsA.includes(tag));
  const removedIssueTags = tagsA.filter(tag => !tagsB.includes(tag));
  const messagesA = collectMessageCounts(logA.entries);
  const messagesB = collectMessageCounts(logB.entries);
  const errorMessagesA = new Set(
    logA.entries
      .filter(entry => getConsoleDisplayLevel(entry) === 'error' || entry.inferredSeverity === 'error')
      .map(entry => normalizeMessage(entry.message))
  );
  const errorMessagesB = new Set(
    logB.entries
      .filter(entry => getConsoleDisplayLevel(entry) === 'error' || entry.inferredSeverity === 'error')
      .map(entry => normalizeMessage(entry.message))
  );

  const newErrors = logB.entries
    .filter(entry => getConsoleDisplayLevel(entry) === 'error' || entry.inferredSeverity === 'error')
    .filter(entry => !errorMessagesA.has(normalizeMessage(entry.message)))
    .slice(0, 8);

  const resolvedErrors = logA.entries
    .filter(entry => getConsoleDisplayLevel(entry) === 'error' || entry.inferredSeverity === 'error')
    .filter(entry => !errorMessagesB.has(normalizeMessage(entry.message)))
    .slice(0, 8);

  const statusOrder: Record<ConsoleLogSignatureStatus, number> = {
    new: 0,
    resolved: 1,
    increased: 2,
    decreased: 3,
    unchanged: 4,
  };
  const signatureDeltas: ConsoleLogSignatureDelta[] = Array.from(new Set([...messagesA.keys(), ...messagesB.keys()]))
    .map(signature => {
      const recordA = messagesA.get(signature);
      const recordB = messagesB.get(signature);
      const countA = recordA?.count ?? 0;
      const countB = recordB?.count ?? 0;
      const delta = countB - countA;
      const status: ConsoleLogSignatureStatus = countA === 0
        ? 'new'
        : countB === 0
        ? 'resolved'
        : delta > 0
        ? 'increased'
        : delta < 0
        ? 'decreased'
        : 'unchanged';
      return {
        signature,
        message: recordB?.entry.message ?? recordA?.entry.message ?? signature,
        countA,
        countB,
        delta,
        status,
        evidenceA: recordA?.entries ?? [],
        evidenceB: recordB?.entries ?? [],
      };
    })
    .sort((left, right) => {
      const statusDelta = statusOrder[left.status] - statusOrder[right.status];
      if (statusDelta !== 0) return statusDelta;
      const countDelta = Math.abs(right.delta) - Math.abs(left.delta);
      if (countDelta !== 0) return countDelta;
      return left.signature.localeCompare(right.signature);
    });

  const repeatedMessages = signatureDeltas
    .filter(item => item.delta !== 0)
    .slice(0, 10)
    .map(({ message, countA, countB, delta }) => ({ message, countA, countB, delta }));

  return {
    metricsA,
    metricsB,
    levelDeltas,
    newIssueTags,
    removedIssueTags,
    newErrors,
    resolvedErrors,
    signatureDeltas,
    repeatedMessages,
    summary: buildSummary(metricsA, metricsB),
  };
}
