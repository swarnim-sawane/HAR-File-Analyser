import type { ConsoleIssueTag, ConsoleLogEntry, ConsoleLogEntrySummary, LogLevel } from '../types/consolelog';
import { getConsoleDisplayLevel } from './consoleLogSeverity';

export type ConsoleIssueMapGroupId =
  | 'cors-network'
  | 'auth-http'
  | 'runtime-exceptions'
  | 'warnings'
  | 'framework-noise'
  | 'action-context'
  | 'informational';

export type ConsoleIssueMapTone =
  | 'critical'
  | 'warning'
  | 'network'
  | 'auth'
  | 'runtime'
  | 'context'
  | 'muted'
  | 'neutral';

export type ConsoleIssueMapConfidence = 'high' | 'medium' | 'low';

export interface ConsoleIssueMapGroup {
  id: ConsoleIssueMapGroupId;
  title: string;
  description: string;
  tone: ConsoleIssueMapTone;
  count: number;
  actionableCount: number;
}
export interface ConsoleIssueMapNode {
  id: string;
  groupId: ConsoleIssueMapGroupId;
  title: string;
  subtitle: string;
  detail: string;
  count: number;
  level: LogLevel;
  tone: ConsoleIssueMapTone;
  confidence: ConsoleIssueMapConfidence;
  tags: ConsoleIssueTag[];
  sourceLabel: string;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  representativeEntry: ConsoleLogEntry | ConsoleLogEntrySummary;
  entries: Array<ConsoleLogEntry | ConsoleLogEntrySummary>;
}

export interface ConsoleIssueMapEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  reason: string;
  confidence: ConsoleIssueMapConfidence;
}

export interface ConsoleIssueMapModel {
  groups: ConsoleIssueMapGroup[];
  nodes: ConsoleIssueMapNode[];
  edges: ConsoleIssueMapEdge[];
  summary: {
    totalEntries: number;
    actionableCount: number;
    errorCount: number;
    warningCount: number;
    groupCount: number;
    relationCount: number;
  };
}
const GROUP_META: Record<ConsoleIssueMapGroupId, Omit<ConsoleIssueMapGroup, 'count' | 'actionableCount'>> = {
  'cors-network': {
    id: 'cors-network',
    title: 'Network and CORS',
    description: 'Fetch failures, CORS blocks, preflight failures, and network errors.',
    tone: 'network',
  },
  'auth-http': {
    id: 'auth-http',
    title: 'Auth and HTTP Status',
    description: '401/403 evidence, HTTP status failures, login, token, and permission signals.',
    tone: 'auth',
  },
  'runtime-exceptions': {
    id: 'runtime-exceptions',
    title: 'Runtime Exceptions',
    description: 'JavaScript exceptions, unhandled promises, and application runtime failures.',
    tone: 'runtime',
  },
  warnings: {
    id: 'warnings',
    title: 'Warnings',
    description: 'Warnings worth reviewing, without a proven failure relationship.',
    tone: 'warning',
  },
  'framework-noise': {
    id: 'framework-noise',
    title: 'Framework and Browser Noise',
    description: 'Stack frames, telemetry, browser policy, and low-value runtime chatter.',
    tone: 'muted',
  },
  'action-context': {
    id: 'action-context',
    title: 'User and Request Context',
    description: 'Clicks, navigation, route changes, requests, and other context rows.',
    tone: 'context',
  },
  informational: {
    id: 'informational',
    title: 'Informational Rows',
    description: 'Rows that do not currently show actionable failure evidence.',
    tone: 'neutral',
  },
};

const GROUP_ORDER: ConsoleIssueMapGroupId[] = [
  'cors-network',
  'auth-http',
  'runtime-exceptions',
  'warnings',
  'action-context',
  'framework-noise',
  'informational',
];

function entryTime(entry: ConsoleLogEntry | ConsoleLogEntrySummary): number {
  const parsed = Date.parse(entry.timestamp);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function normalizedText(entry: ConsoleLogEntry | ConsoleLogEntrySummary): string {
  return `${entry.message || ''}\n${entry.rawText || ''}`.replace(/\s+/g, ' ').trim();
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized || 'No message text';
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function sourceLabel(entry: ConsoleLogEntry | ConsoleLogEntrySummary): string {
  const source = entry.source || entry.url || entry.category;
  if (!source) return 'Source unavailable';

  try {
    if (/^https?:\/\//i.test(source)) {
      const parsed = new URL(source);
      return parsed.hostname || source;
    }
  } catch {
    // Fall through to compact path handling.
  }

  const parts = source.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || source;
}

function hasTag(entry: ConsoleLogEntry | ConsoleLogEntrySummary, tag: ConsoleIssueTag): boolean {
  return entry.primaryIssue === tag || entry.issueTags.includes(tag);
}

function hasAnyTag(
  entry: ConsoleLogEntry | ConsoleLogEntrySummary,
  tags: ConsoleIssueTag[],
): boolean {
  return tags.some(tag => hasTag(entry, tag));
}

function isNoiseEntry(entry: ConsoleLogEntry | ConsoleLogEntrySummary): boolean {
  const text = normalizedText(entry);
  const source = entry.source || '';

  return text.length === 0
    || /^undefined$/i.test(text)
    || /Tracking Prevention blocked access to storage/i.test(text)
    || /^\[NEW\]\s+Explain Console errors by using Copilot/i.test(text)
    || /Oracle OTel Client .* initialized/i.test(text)
    || /Extension Manager digest .* loaded/i.test(text)
    || /Tracer enabled on \[object Window\]/i.test(text)
    || /^[\w$<>.]+\s*@\s+\S+:\d+/i.test(text)
    || /^(?:\(?anonymous\)?|invoke|run|runTask|invokeTask|drainMicroTaskQueue|nativeScheduleMicroTask|scheduleMicroTask|scheduleTask|resolvePromise|scheduleResolveOrReject|execCb|check|enable|load|fetch|s|requirejs|Promise\.then)\s*@/i.test(text)
    || /^@\s+\S+:\d+/i.test(text)
    || /\bzone\.js\b/i.test(source)
    || /\blogCustomWriter\.js\b/i.test(source);
}

function isCorsEvidence(entry: ConsoleLogEntry | ConsoleLogEntrySummary): boolean {
  const text = normalizedText(entry);
  return hasTag(entry, 'cors')
    || /\b(?:blocked by CORS policy|CORS_BLOCKED|cross-origin request blocked|preflight request|access-control-allow-origin|cors policy)\b/i.test(text);
}

function isFailedFetch(entry: ConsoleLogEntry | ConsoleLogEntrySummary): boolean {
  return /\b(?:failed to fetch|network ?error|net::err_|request failed|load failed|err_failed|connection (?:refused|reset|timed out))\b/i.test(normalizedText(entry));
}

function isAuthOrHttpEvidence(entry: ConsoleLogEntry | ConsoleLogEntrySummary): boolean {
  const text = normalizedText(entry);
  return hasAnyTag(entry, ['http-4xx', 'http-5xx'])
    || /\b(?:401|403|404|429|500|502|503|504|unauthorized|forbidden|auth(?:entication|orization)?|permission|denied|token|login|sign[ -]?in|session)\b/i.test(text);
}

function isRuntimeException(entry: ConsoleLogEntry | ConsoleLogEntrySummary): boolean {
  const text = normalizedText(entry);
  return hasAnyTag(entry, ['exception', 'promise'])
    || /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|URIError|Unhandled|Uncaught|cannot read properties|is not defined|undefined is not)\b/i.test(text);
}

function isActionContext(entry: ConsoleLogEntry | ConsoleLogEntrySummary): boolean {
  if (isNoiseEntry(entry)) return false;

  return Boolean(entry.url)
    || /\b(?:click|clicked|select|selected|submit|submitted|navigate|navigating|route|routing|open|opened|load|loading|request|response|fetch|xhr|ajax|GET|POST|PUT|PATCH|DELETE|redirect|login|logout|sign in|save|search|filter)\b/i.test(normalizedText(entry));
}

function isActionable(entry: ConsoleLogEntry | ConsoleLogEntrySummary): boolean {
  const level = getConsoleDisplayLevel(entry);
  return level === 'error'
    || level === 'warn'
    || entry.inferredSeverity === 'error'
    || entry.inferredSeverity === 'warning'
    || entry.issueTags.length > 0
    || /\b(?:failed|failure|exception|error|blocked|denied|rejected|timeout)\b/i.test(normalizedText(entry));
}

function getGroupId(entry: ConsoleLogEntry | ConsoleLogEntrySummary): ConsoleIssueMapGroupId {
  if (isCorsEvidence(entry) || (hasTag(entry, 'network') && isFailedFetch(entry))) return 'cors-network';
  if (isAuthOrHttpEvidence(entry)) return 'auth-http';
  if (isRuntimeException(entry)) return 'runtime-exceptions';
  if (hasAnyTag(entry, ['react', 'browser-policy']) || isNoiseEntry(entry)) return 'framework-noise';
  if (getConsoleDisplayLevel(entry) === 'warn' || entry.inferredSeverity === 'warning') return 'warnings';
  if (isActionContext(entry)) return 'action-context';
  return 'informational';
}

function signature(entry: ConsoleLogEntry | ConsoleLogEntrySummary): string {
  const text = normalizedText(entry)
    .toLowerCase()
    .replace(/\b[0-9a-f]{8,}\b/g, '{id}')
    .replace(/\b\d+\b/g, '{n}')
    .replace(/\s+/g, ' ')
    .trim();

  const source = (entry.source || entry.category || '').toLowerCase();
  if (/typeerror:/.test(text)) return text.replace(/\(.+?\)/g, '(...)').slice(0, 150);
  if (/referenceerror:|syntaxerror:|rangeerror:|uncaught|unhandled/.test(text)) return text.slice(0, 150);
  if (isCorsEvidence(entry)) return `cors::${text.slice(0, 140)}`;
  if (isFailedFetch(entry)) return `network::${text.slice(0, 120)}`;
  return `${source}::${text.slice(0, 130)}`;
}

function titleForCluster(entries: Array<ConsoleLogEntry | ConsoleLogEntrySummary>): string {
  const representative = entries[0];
  const text = normalizedText(representative);
  const repeatedPrefix = entries.length > 1 ? 'Repeated ' : '';

  if (isCorsEvidence(representative)) return `${repeatedPrefix}CORS block`;
  if (isFailedFetch(representative)) return `${repeatedPrefix}Failed fetch`;
  if (/TypeError/i.test(text)) return `${repeatedPrefix}TypeError`;
  if (/ReferenceError/i.test(text)) return `${repeatedPrefix}ReferenceError`;
  if (/SyntaxError/i.test(text)) return `${repeatedPrefix}SyntaxError`;
  if (hasTag(representative, 'http-5xx')) return `${repeatedPrefix}HTTP 5xx`;
  if (hasTag(representative, 'http-4xx')) return `${repeatedPrefix}HTTP 4xx`;
  if (isActionContext(representative)) return `${repeatedPrefix}Action context`;

  const level = getConsoleDisplayLevel(representative);
  if (level === 'error') return `${repeatedPrefix}Error`;
  if (level === 'warn') return `${repeatedPrefix}Warning`;
  if (isNoiseEntry(representative)) return `${repeatedPrefix}Framework noise`;
  return `${repeatedPrefix}Log row`;
}

function nodeTone(groupId: ConsoleIssueMapGroupId, level: LogLevel): ConsoleIssueMapTone {
  if (groupId === 'cors-network') return 'network';
  if (groupId === 'auth-http') return 'auth';
  if (groupId === 'runtime-exceptions') return 'runtime';
  if (groupId === 'framework-noise') return 'muted';
  if (groupId === 'action-context') return 'context';
  if (level === 'error') return 'critical';
  if (level === 'warn') return 'warning';
  return 'neutral';
}

function buildNodes(
  entries: Array<ConsoleLogEntry | ConsoleLogEntrySummary>,
): ConsoleIssueMapNode[] {
  const clusterMap = new Map<string, Array<ConsoleLogEntry | ConsoleLogEntrySummary>>();

  for (const entry of entries) {
    const groupId = getGroupId(entry);
    const key = `${groupId}:${signature(entry)}`;
    const cluster = clusterMap.get(key) ?? [];
    cluster.push(entry);
    clusterMap.set(key, cluster);
  }

  const clusters = Array.from(clusterMap.entries())
    .map(([key, cluster]) => ({ key, cluster: cluster.sort((left, right) => entryTime(left) - entryTime(right)) }))
    .sort((left, right) => {
      const leftGroup = getGroupId(left.cluster[0]);
      const rightGroup = getGroupId(right.cluster[0]);
      const groupDelta = GROUP_ORDER.indexOf(leftGroup) - GROUP_ORDER.indexOf(rightGroup);
      if (groupDelta !== 0) return groupDelta;

      const leftActionable = isActionable(left.cluster[0]) ? 0 : 1;
      const rightActionable = isActionable(right.cluster[0]) ? 0 : 1;
      if (leftActionable !== rightActionable) return leftActionable - rightActionable;

      if (left.cluster.length !== right.cluster.length) return right.cluster.length - left.cluster.length;
      return entryTime(left.cluster[0]) - entryTime(right.cluster[0]);
    });

  const perGroupCounts = new Map<ConsoleIssueMapGroupId, number>();

  return clusters.map(({ cluster }) => {
    const representative = cluster[0];
    const lastEntry = cluster[cluster.length - 1];
    const groupId = getGroupId(representative);
    const level = getConsoleDisplayLevel(representative);
    const groupCounter = perGroupCounts.get(groupId) ?? 0;
    perGroupCounts.set(groupId, groupCounter + 1);

    return {
      id: `${groupId}-${groupCounter}`,
      groupId,
      title: titleForCluster(cluster),
      subtitle: compactText(representative.message || representative.rawText || 'No message text', 92),
      detail: cluster.length > 1
        ? `${cluster.length} matching rows collapsed. Seen from ${representative.timestamp} through ${lastEntry.timestamp}.`
        : compactText(representative.rawText || representative.message, 160),
      count: cluster.length,
      level,
      tone: nodeTone(groupId, level),
      confidence: isActionable(representative) ? 'high' : groupId === 'action-context' ? 'medium' : 'low',
      tags: Array.from(new Set(cluster.flatMap(entry => entry.issueTags))),
      sourceLabel: sourceLabel(representative),
      firstTimestamp: Number.isFinite(entryTime(representative)) ? representative.timestamp : null,
      lastTimestamp: Number.isFinite(entryTime(lastEntry)) ? lastEntry.timestamp : null,
      representativeEntry: representative,
      entries: cluster,
    };
  });
}

function sameOrNearbyTime(
  left: ConsoleLogEntry | ConsoleLogEntrySummary,
  right: ConsoleLogEntry | ConsoleLogEntrySummary,
  maxMs: number,
): boolean {
  const leftTime = entryTime(left);
  const rightTime = entryTime(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return true;
  return Math.abs(rightTime - leftTime) <= maxMs;
}

function isFailureNode(node: ConsoleIssueMapNode): boolean {
  return node.level === 'error'
    || node.representativeEntry.inferredSeverity === 'error'
    || ['cors-network', 'runtime-exceptions', 'auth-http'].includes(node.groupId);
}

function buildEdges(nodes: ConsoleIssueMapNode[]): ConsoleIssueMapEdge[] {
  const edges: ConsoleIssueMapEdge[] = [];
  const edgeIds = new Set<string>();

  const addEdge = (
    source: ConsoleIssueMapNode,
    target: ConsoleIssueMapNode,
    label: string,
    reason: string,
    confidence: ConsoleIssueMapConfidence,
  ) => {
    if (source.id === target.id) return;
    const id = `${source.id}->${target.id}:${label}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ id, source: source.id, target: target.id, label, reason, confidence });
  };

  const corsNodes = nodes.filter(node => node.entries.some(isCorsEvidence));
  const failedFetchNodes = nodes.filter(node => node.entries.some(isFailedFetch));

  for (const corsNode of corsNodes) {
    for (const fetchNode of failedFetchNodes) {
      if (corsNode.id === fetchNode.id) continue;
      if (!sameOrNearbyTime(corsNode.representativeEntry, fetchNode.representativeEntry, 15_000)) continue;

      addEdge(
        corsNode,
        fetchNode,
        'CORS block -> failed fetch',
        'One row contains explicit CORS/preflight evidence and a nearby row contains failed fetch/network error text.',
        'high',
      );
    }
  }

  const authNodes = nodes.filter(node => node.groupId === 'auth-http');
  const runtimeNodes = nodes.filter(node => node.groupId === 'runtime-exceptions');

  for (const authNode of authNodes) {
    for (const runtimeNode of runtimeNodes) {
      if (!sameOrNearbyTime(authNode.representativeEntry, runtimeNode.representativeEntry, 10_000)) continue;

      addEdge(
        authNode,
        runtimeNode,
        'status evidence near exception',
        'HTTP/auth evidence occurred near a runtime exception. Treat as inspection context, not confirmed causality.',
        'medium',
      );
    }
  }

  const actionNodes = nodes.filter(node => node.groupId === 'action-context');
  const failureNodes = nodes.filter(isFailureNode);

  for (const actionNode of actionNodes) {
    const actionTime = entryTime(actionNode.representativeEntry);

    const nearestFailure = failureNodes
      .filter(node => {
        const failureTime = entryTime(node.representativeEntry);
        if (!Number.isFinite(actionTime) || !Number.isFinite(failureTime)) return false;
        return failureTime >= actionTime && failureTime - actionTime <= 8_000;
      })
      .sort((left, right) => entryTime(left.representativeEntry) - entryTime(right.representativeEntry))[0];

    if (nearestFailure) {
      addEdge(
        actionNode,
        nearestFailure,
        'nearby context',
        'A user, navigation, request, or route row appears shortly before this failure.',
        'low',
      );
    }
  }

  return edges;
}

export function buildConsoleLogIssueMap(
  entries: Array<ConsoleLogEntry | ConsoleLogEntrySummary>,
): ConsoleIssueMapModel {
  const sortedEntries = [...entries].sort((left, right) => entryTime(left) - entryTime(right));
  const nodes = buildNodes(sortedEntries);
  const edges = buildEdges(nodes);
  const groupStats = new Map<ConsoleIssueMapGroupId, { count: number; actionableCount: number }>();

  for (const entry of sortedEntries) {
    const groupId = getGroupId(entry);
    const stats = groupStats.get(groupId) ?? { count: 0, actionableCount: 0 };
    stats.count += 1;
    if (isActionable(entry)) {
      stats.actionableCount += 1;
    }
    groupStats.set(groupId, stats);
  }

  const groups = GROUP_ORDER
    .filter(groupId => groupStats.has(groupId))
    .map(groupId => ({
      ...GROUP_META[groupId],
      count: groupStats.get(groupId)?.count ?? 0,
      actionableCount: groupStats.get(groupId)?.actionableCount ?? 0,
    }));

  let errorCount = 0;
  let warningCount = 0;
  let actionableCount = 0;

  for (const entry of sortedEntries) {
    const level = getConsoleDisplayLevel(entry);
    if (level === 'error') {
      errorCount += 1;
    } else if (level === 'warn') {
      warningCount += 1;
    }
    if (isActionable(entry)) {
      actionableCount += 1;
    }
  }

  return {
    groups,
    nodes,
    edges,
    summary: {
      totalEntries: sortedEntries.length,
      actionableCount,
      errorCount,
      warningCount,
      groupCount: groups.length,
      relationCount: edges.length,
    },
  };
}
