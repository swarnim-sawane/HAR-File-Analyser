import type { Entry } from '../types/har';
import { analyzeFlow, type ZoneRequest } from './requestFlowAnalyzer';

export type TraceRelationType = 'redirect' | 'initiator' | 'sequential';
export type TraceRole = 'root' | 'primary' | 'branch' | 'terminal';
export type TraceSelectionMode = '5xx' | '4xx' | 'failure-landing' | 'slow';
export type TraceConfidence = 'high' | 'medium' | 'low';

export interface SystemTraceNode {
  id: string;
  entryIndex: number;
  method: string;
  url: string;
  status: number;
  type: string;
  time: number;
  isSlow: boolean;
  failed: boolean;
  domainLabel: string;
  productLabel?: string;
  traceRole: TraceRole;
  relationType?: TraceRelationType;
}

export interface SystemTraceEdge {
  id: string;
  source: number;
  target: number;
  relationType: TraceRelationType;
  isPrimary: boolean;
}

export interface SystemTraceSummary {
  selectionMode: TraceSelectionMode;
  primaryReason: string;
  terminalStatus: number;
  hopCount: number;
  totalDurationMs: number;
  confidence: TraceConfidence;
}

export interface SystemTraceResult {
  nodes: SystemTraceNode[];
  edges: SystemTraceEdge[];
  primaryChainEntryIndexes: number[];
  terminalEntryIndex: number | null;
  summary: SystemTraceSummary | null;
  totalRequests: number;
  branchCount: number;
}

interface RequestContext {
  index: number;
  entry: Entry;
  meta: ZoneRequest;
  domainLabel: string;
  productLabel?: string;
  startedMs: number;
  endedMs: number;
  sortedOrder: number;
  chainLatency: number;
}

interface ParentLink {
  parentIndex: number;
  relationType: TraceRelationType;
}

const ERROR_LANDING_PATTERN = /servererror|errorpage|error\.jsp|\/error\b|\/oops|\/unavailable|\/fault|\/failure\b/i;
const MAX_BRANCHES = 6;
const MAX_BRANCHES_PER_PARENT = 2;

const parseUrl = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

const normalizeUrl = (url: string) => {
  const parsed = parseUrl(url);
  return parsed ? parsed.toString() : url;
};

const resolveAgainst = (baseUrl: string, targetUrl: string) => {
  if (!targetUrl) return '';
  try {
    return new URL(targetUrl, baseUrl).toString();
  } catch {
    return targetUrl;
  }
};

const getRedirectTarget = (entry: Entry) => {
  const locationHeader = entry.response.headers.find(
    (header) => header.name.toLowerCase() === 'location'
  )?.value;

  const rawTarget = entry.response.redirectURL || locationHeader || '';
  if (!rawTarget) return '';
  return normalizeUrl(resolveAgainst(entry.request.url, rawTarget));
};

const isFailureLanding = (url: string) => {
  const parsed = parseUrl(url);
  const target = parsed ? `${parsed.hostname}${parsed.pathname}` : url;
  return ERROR_LANDING_PATTERN.test(target);
};

const buildContexts = (entries: Entry[]) => {
  const flowData = analyzeFlow(entries);
  const requestByIndex = new Map<number, ZoneRequest>();
  const domainMetaByIndex = new Map<number, { domainLabel: string; productLabel?: string }>();

  flowData.zones.forEach((zone) => {
    zone.requests.forEach((request) => {
      requestByIndex.set(request.index, request);
      domainMetaByIndex.set(request.index, {
        domainLabel: zone.shortLabel || zone.domain,
        productLabel: zone.product || undefined,
      });
    });
  });

  const sortedEntries = entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        new Date(left.entry.startedDateTime).getTime() -
        new Date(right.entry.startedDateTime).getTime()
    );

  const contexts = new Map<number, RequestContext>();

  sortedEntries.forEach(({ entry, index }, sortedOrder) => {
    const meta = requestByIndex.get(index) ?? {
      index,
      url: entry.request.url,
      method: entry.request.method,
      status: entry.response.status,
      type: 'other',
      time: entry.time || 0,
      startMs: new Date(entry.startedDateTime).getTime(),
      failed: entry.response.status >= 400,
      isSlow: false,
      size: entry.response.content.size || entry.response.bodySize || 0,
      ttfb: Math.max(0, entry.timings.wait || 0),
      initiator: (entry as Entry & { _initiator?: { url?: string } })._initiator?.url,
    };
    const domainMeta = domainMetaByIndex.get(index);
    const startedMs = new Date(entry.startedDateTime).getTime();

    contexts.set(index, {
      index,
      entry,
      meta,
      domainLabel: domainMeta?.domainLabel || 'unknown',
      productLabel: domainMeta?.productLabel,
      startedMs,
      endedMs: startedMs + (entry.time || 0),
      sortedOrder,
      chainLatency: meta.time || 0,
    });
  });

  return {
    contexts,
    sortedIndexes: sortedEntries.map(({ index }) => index),
  };
};

const chooseBestParent = (
  parentIndexes: number[],
  childContext: RequestContext,
  contexts: Map<number, RequestContext>
) => {
  if (!parentIndexes.length) return null;

  const uniqueParents = Array.from(new Set(parentIndexes));

  uniqueParents.sort((left, right) => {
    const leftContext = contexts.get(left);
    const rightContext = contexts.get(right);

    if (!leftContext || !rightContext) return 0;

    const leftGap = Math.max(0, childContext.startedMs - leftContext.endedMs);
    const rightGap = Math.max(0, childContext.startedMs - rightContext.endedMs);
    if (leftGap !== rightGap) return leftGap - rightGap;

    if (leftContext.chainLatency !== rightContext.chainLatency) {
      return rightContext.chainLatency - leftContext.chainLatency;
    }

    return leftContext.sortedOrder - rightContext.sortedOrder;
  });

  return uniqueParents[0] ?? null;
};

const pushChildLink = (
  childLinks: Map<number, Array<{ childIndex: number; relationType: TraceRelationType }>>,
  parentIndex: number,
  childIndex: number,
  relationType: TraceRelationType
) => {
  const existing = childLinks.get(parentIndex) ?? [];
  existing.push({ childIndex, relationType });
  childLinks.set(parentIndex, existing);
};

const buildParentLinks = (
  contexts: Map<number, RequestContext>,
  sortedIndexes: number[]
) => {
  const parentByIndex = new Map<number, ParentLink>();
  const childLinks = new Map<number, Array<{ childIndex: number; relationType: TraceRelationType }>>();
  const seenByUrl = new Map<string, number[]>();
  const redirectSourcesByTarget = new Map<string, number[]>();

  sortedIndexes.forEach((index, sortedPosition) => {
    const context = contexts.get(index);
    if (!context) return;

    const urlKey = normalizeUrl(context.entry.request.url);
    const initiatorUrl = (
      context.entry as Entry & { _initiator?: { url?: string } }
    )._initiator?.url;
    const initiatorKey = initiatorUrl ? normalizeUrl(initiatorUrl) : '';

    const redirectParentCandidates =
      redirectSourcesByTarget.get(urlKey)?.filter((candidate) => candidate !== index) ?? [];
    const redirectParent = chooseBestParent(redirectParentCandidates, context, contexts);

    const initiatorParentCandidates =
      initiatorKey && initiatorKey !== urlKey
        ? seenByUrl.get(initiatorKey)?.filter((candidate) => candidate !== index) ?? []
        : [];
    const initiatorParent = chooseBestParent(initiatorParentCandidates, context, contexts);

    const sequentialParent =
      sortedPosition > 0 ? sortedIndexes[sortedPosition - 1] ?? null : null;

    const parentIndex =
      redirectParent ?? initiatorParent ?? sequentialParent;
    const relationType: TraceRelationType | null =
      redirectParent !== null
        ? 'redirect'
        : initiatorParent !== null
          ? 'initiator'
          : sequentialParent !== null
            ? 'sequential'
            : null;

    if (parentIndex !== null && relationType) {
      parentByIndex.set(index, { parentIndex, relationType });
      pushChildLink(childLinks, parentIndex, index, relationType);

      const parentContext = contexts.get(parentIndex);
      context.chainLatency = (parentContext?.chainLatency ?? 0) + context.meta.time;
    } else {
      context.chainLatency = context.meta.time;
    }

    const seenForUrl = seenByUrl.get(urlKey) ?? [];
    seenForUrl.push(index);
    seenByUrl.set(urlKey, seenForUrl);

    const redirectTarget = getRedirectTarget(context.entry);
    if (redirectTarget) {
      const redirectSources = redirectSourcesByTarget.get(redirectTarget) ?? [];
      redirectSources.push(index);
      redirectSourcesByTarget.set(redirectTarget, redirectSources);
    }
  });

  return { parentByIndex, childLinks };
};

const pickTerminalIndex = (
  contexts: Map<number, RequestContext>,
  sortedIndexes: number[]
) => {
  const rankedByTime = [...sortedIndexes].sort((left, right) => {
    const leftContext = contexts.get(left);
    const rightContext = contexts.get(right);
    if (!leftContext || !rightContext) return 0;

    if (leftContext.meta.time !== rightContext.meta.time) {
      return rightContext.meta.time - leftContext.meta.time;
    }

    if (leftContext.chainLatency !== rightContext.chainLatency) {
      return rightContext.chainLatency - leftContext.chainLatency;
    }

    return leftContext.sortedOrder - rightContext.sortedOrder;
  });

  const entries5xx = rankedByTime.filter((index) => (contexts.get(index)?.meta.status ?? 0) >= 500);
  if (entries5xx.length > 0) return { terminalIndex: entries5xx[0], selectionMode: '5xx' as const };

  const entries4xx = rankedByTime.filter((index) => {
    const status = contexts.get(index)?.meta.status ?? 0;
    return status >= 400 && status < 500;
  });
  if (entries4xx.length > 0) return { terminalIndex: entries4xx[0], selectionMode: '4xx' as const };

  const failureLandingEntries = rankedByTime.filter((index) => {
    const context = contexts.get(index);
    return context ? isFailureLanding(context.meta.url) : false;
  });
  if (failureLandingEntries.length > 0) {
    return { terminalIndex: failureLandingEntries[0], selectionMode: 'failure-landing' as const };
  }

  return { terminalIndex: rankedByTime[0] ?? null, selectionMode: 'slow' as const };
};

const buildPrimaryChain = (
  terminalIndex: number,
  parentByIndex: Map<number, ParentLink>
) => {
  const chain: number[] = [];
  const seen = new Set<number>();
  let currentIndex: number | null = terminalIndex;

  while (currentIndex !== null && !seen.has(currentIndex)) {
    seen.add(currentIndex);
    chain.push(currentIndex);
    currentIndex = parentByIndex.get(currentIndex)?.parentIndex ?? null;
  }

  return chain.reverse();
};

const summarizeConfidence = (
  primaryChainEntryIndexes: number[],
  parentByIndex: Map<number, ParentLink>
): TraceConfidence => {
  const relationTypes = primaryChainEntryIndexes
    .slice(1)
    .map((entryIndex) => parentByIndex.get(entryIndex)?.relationType)
    .filter((relationType): relationType is TraceRelationType => Boolean(relationType));

  if (relationTypes.length === 0) return 'medium';
  if (relationTypes.every((relationType) => relationType === 'sequential')) return 'low';
  if (relationTypes.some((relationType) => relationType === 'sequential')) return 'medium';
  return 'high';
};

const getReasonLabel = (selectionMode: TraceSelectionMode) => {
  switch (selectionMode) {
    case '5xx':
      return 'Server-side failure chain';
    case '4xx':
      return 'Client/auth failure chain';
    case 'failure-landing':
      return 'Error-like landing chain';
    default:
      return 'Slowest visible request chain';
  }
};

export function analyzeSystemTrace(entries: Entry[]): SystemTraceResult {
  if (!entries.length) {
    return {
      nodes: [],
      edges: [],
      primaryChainEntryIndexes: [],
      terminalEntryIndex: null,
      summary: null,
      totalRequests: 0,
      branchCount: 0,
    };
  }

  const { contexts, sortedIndexes } = buildContexts(entries);
  const { parentByIndex, childLinks } = buildParentLinks(contexts, sortedIndexes);
  const { terminalIndex, selectionMode } = pickTerminalIndex(contexts, sortedIndexes);

  if (terminalIndex === null) {
    return {
      nodes: [],
      edges: [],
      primaryChainEntryIndexes: [],
      terminalEntryIndex: null,
      summary: null,
      totalRequests: entries.length,
      branchCount: 0,
    };
  }

  const primaryChainEntryIndexes = buildPrimaryChain(terminalIndex, parentByIndex);
  const primaryChainSet = new Set(primaryChainEntryIndexes);
  const branchIndexes: number[] = [];

  for (const parentIndex of primaryChainEntryIndexes) {
    if (branchIndexes.length >= MAX_BRANCHES) break;

    const parentContext = contexts.get(parentIndex);
    const children = childLinks.get(parentIndex) ?? [];
    const eligibleBranches = children
      .filter(({ childIndex }) => !primaryChainSet.has(childIndex))
      .filter(({ childIndex }) => {
        const childContext = contexts.get(childIndex);
        if (!parentContext || !childContext) return false;

        const isCrossDomain = childContext.domainLabel !== parentContext.domainLabel;
        return childContext.meta.failed || childContext.meta.isSlow || isCrossDomain;
      })
      .sort((left, right) => {
        const leftContext = contexts.get(left.childIndex);
        const rightContext = contexts.get(right.childIndex);
        if (!leftContext || !rightContext) return 0;

        const leftScore =
          (leftContext.meta.failed ? 4 : 0) +
          (leftContext.meta.isSlow ? 2 : 0) +
          (leftContext.domainLabel !== parentContext?.domainLabel ? 1 : 0);
        const rightScore =
          (rightContext.meta.failed ? 4 : 0) +
          (rightContext.meta.isSlow ? 2 : 0) +
          (rightContext.domainLabel !== parentContext?.domainLabel ? 1 : 0);

        if (leftScore !== rightScore) return rightScore - leftScore;
        if (leftContext.meta.time !== rightContext.meta.time) {
          return rightContext.meta.time - leftContext.meta.time;
        }

        return leftContext.sortedOrder - rightContext.sortedOrder;
      })
      .slice(0, MAX_BRANCHES_PER_PARENT);

    eligibleBranches.forEach(({ childIndex }) => {
      if (branchIndexes.length < MAX_BRANCHES) {
        branchIndexes.push(childIndex);
      }
    });
  }

  const visibleIndexes = [...primaryChainEntryIndexes, ...branchIndexes];
  const visibleSet = new Set(visibleIndexes);
  const nodes: SystemTraceNode[] = visibleIndexes.map((entryIndex, visibleOrder) => {
    const context = contexts.get(entryIndex)!;
    const parentRelation = parentByIndex.get(entryIndex)?.relationType;
    let traceRole: TraceRole = 'primary';

    if (branchIndexes.includes(entryIndex)) {
      traceRole = 'branch';
    } else if (entryIndex === terminalIndex) {
      traceRole = 'terminal';
    } else if (visibleOrder === 0) {
      traceRole = 'root';
    }

    return {
      id: `trace-${entryIndex}`,
      entryIndex,
      method: context.meta.method,
      url: context.meta.url,
      status: context.meta.status,
      type: context.meta.type,
      time: context.meta.time,
      isSlow: context.meta.isSlow,
      failed: context.meta.failed,
      domainLabel: context.domainLabel,
      productLabel: context.productLabel,
      traceRole,
      relationType: parentRelation,
    };
  });

  const primaryEdges = primaryChainEntryIndexes.slice(1).map((entryIndex) => {
    const parent = parentByIndex.get(entryIndex)!;
    return {
      id: `trace-edge-${parent.parentIndex}-${entryIndex}`,
      source: parent.parentIndex,
      target: entryIndex,
      relationType: parent.relationType,
      isPrimary: true,
    };
  });

  const branchEdges = branchIndexes
    .map((entryIndex) => {
      const parent = parentByIndex.get(entryIndex);
      if (!parent || !visibleSet.has(parent.parentIndex)) return null;

      return {
        id: `trace-edge-${parent.parentIndex}-${entryIndex}`,
        source: parent.parentIndex,
        target: entryIndex,
        relationType: parent.relationType,
        isPrimary: false,
      };
    })
    .filter((edge): edge is SystemTraceEdge => Boolean(edge));

  const firstPrimaryContext = contexts.get(primaryChainEntryIndexes[0])!;
  const terminalContext = contexts.get(terminalIndex)!;
  const summary: SystemTraceSummary = {
    selectionMode,
    primaryReason: getReasonLabel(selectionMode),
    terminalStatus: terminalContext.meta.status,
    hopCount: primaryChainEntryIndexes.length,
    totalDurationMs: Math.max(0, terminalContext.endedMs - firstPrimaryContext.startedMs),
    confidence: summarizeConfidence(primaryChainEntryIndexes, parentByIndex),
  };

  return {
    nodes,
    edges: [...primaryEdges, ...branchEdges],
    primaryChainEntryIndexes,
    terminalEntryIndex: terminalIndex,
    summary,
    totalRequests: entries.length,
    branchCount: branchIndexes.length,
  };
}
