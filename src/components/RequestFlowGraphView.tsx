import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel,
  MarkerType,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import type { Edge, Node, ReactFlowInstance } from 'reactflow';
import 'reactflow/dist/style.css';
import { Entry, FilterOptions } from '../types/har';
import type { RequestFlowFocusMode } from '../types/requestFlow';
import {
  getVisibleRequestIndexes,
  requestMatchesFlowFocus,
} from '../utils/requestFlowFilters';
import { analyzeFlow, TYPE_COLOR, type ZoneRequest } from '../utils/requestFlowAnalyzer';
import { analyzeRequestFlowFocus, type RequestFlowFocusPath } from '../utils/requestFlowFocus';
import { AlertIcon, FlameIcon, GlobeIcon, SearchIcon, SparklesIcon } from './Icons';
import {
  DefaultNode,
  ErrorNode,
  type RequestFlowNodePayload,
} from './RequestFlowNodes';

interface RequestFlowGraphViewProps {
  entries: Entry[];
  visibleEntries?: Entry[];
  filters: FilterOptions;
  onFiltersChange: (filters: Partial<FilterOptions>) => void;
  focusMode: RequestFlowFocusMode;
  onFocusModeChange: (mode: RequestFlowFocusMode) => void;
  issueFocusPath?: RequestFlowFocusPath | null;
  issueFocusEnabled?: boolean;
  onIssueFocusEnabledChange?: (enabled: boolean) => void;
  onNodeClick?: (entry: Entry) => void;
}

const NODE_TYPES = {
  request: DefaultNode,
  requestError: ErrorNode,
};

const STATUS_FILTERS: Array<{ code: keyof FilterOptions['statusCodes']; label: string }> = [
  { code: '0', label: '0' },
  { code: '1xx', label: '1xx' },
  { code: '2xx', label: '2xx' },
  { code: '3xx', label: '3xx' },
  { code: '4xx', label: '4xx' },
  { code: '5xx', label: '5xx' },
];

const FOCUS_OPTIONS: Array<{
  mode: RequestFlowFocusMode;
  label: string;
  icon: React.ReactNode;
}> = [
  { mode: 'all', label: 'All', icon: <SparklesIcon /> },
  { mode: 'errors', label: 'Errors', icon: <AlertIcon /> },
  { mode: 'slow', label: 'Slow', icon: <FlameIcon /> },
];

const parseHostname = (url: string) => {
  try {
    return new URL(url).hostname || 'unknown';
  } catch {
    return 'unknown';
  }
};

const getErrorJumpPathLabel = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  } catch {
    return url.split('?')[0] || url;
  }
};

const compactPathLabel = (path: string, maxLength = 34) => {
  if (path.length <= maxLength) return path;

  const segments = path.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (lastSegment && lastSegment.length + 2 <= maxLength) return `/${lastSegment}`;

  return `${path.slice(0, maxLength - 1)}…`;
};

function buildGraphElements(
  entries: Entry[],
  onEntrySelect?: (entryIndex: number) => void
) {
  const flowData = analyzeFlow(entries);
  const focusPath = analyzeRequestFlowFocus(entries);
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

  const rowByDomain = new Map<string, number>();
  const lastSeenByUrl = new Map<string, number>();
  const nodes: Array<Node<RequestFlowNodePayload>> = [];
  const edges: Edge[] = [];
  const criticalNodeIds = new Set<string>();

  sortedEntries.forEach(({ entry, index }, sortedIndex) => {
    const request = requestByIndex.get(index);
    const domain = parseHostname(entry.request.url);

    if (!rowByDomain.has(domain)) {
      rowByDomain.set(domain, 60 + rowByDomain.size * 150);
    }

    const failed = request?.failed ?? entry.response.status >= 400;
    const type = request?.type ?? 'other';
    const nodeId = `request-${index}`;
    const domainMeta = domainMetaByIndex.get(index);
    const isCriticalPathRequest = failed || type === 'document' || type === 'script';

    if (isCriticalPathRequest) {
      criticalNodeIds.add(nodeId);
    }

    nodes.push({
      id: nodeId,
      type: failed ? 'requestError' : 'request',
      position: {
        x: 56 + sortedIndex * 260,
        y: rowByDomain.get(domain) ?? 60,
      },
      draggable: true,
      selectable: true,
      data: {
        type,
        status: request?.status ?? entry.response.status,
        statusText: entry.response.statusText,
        method: request?.method ?? entry.request.method,
        url: request?.url ?? entry.request.url,
        time: request?.time ?? entry.time,
        startedDateTime: entry.startedDateTime,
        mimeType: entry.response.content?.mimeType,
        responseSize:
          typeof entry.response.content?.size === 'number' && entry.response.content.size >= 0
            ? entry.response.content.size
            : entry.response.bodySize,
        requestSize: entry.request.bodySize,
        timings: entry.timings,
        isSlow: request?.isSlow ?? (entry.time || 0) >= flowData.p90,
        entryIndex: index,
        domainLabel: domainMeta?.domainLabel || domain,
        productLabel: domainMeta?.productLabel,
        onClick: onEntrySelect ? () => onEntrySelect(index) : undefined,
      },
    });

    if (sortedIndex > 0) {
      const initiatorUrl = (entry as any)._initiator?.url as string | undefined;
      let sourceIndex = initiatorUrl ? lastSeenByUrl.get(initiatorUrl) : undefined;
      let fallbackSequence = false;

      if (sourceIndex === undefined) {
        sourceIndex = sortedEntries[sortedIndex - 1]?.index;
        fallbackSequence = true;
      }

      if (sourceIndex !== undefined) {
        const stroke = failed
          ? '#ef4444'
          : fallbackSequence
            ? '#d4d4d4'
            : '#94a3b8';

        edges.push({
          id: `edge-${sourceIndex}-${index}`,
          source: `request-${sourceIndex}`,
          target: nodeId,
          type: 'default',
          animated: failed && !fallbackSequence,
          style: {
            stroke,
            strokeWidth: fallbackSequence ? 1.2 : 2,
            strokeDasharray: fallbackSequence ? '5 5' : undefined,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
          },
        });
      }
    }

    lastSeenByUrl.set(entry.request.url, index);
  });

  const totalRequests = entries.length;
  const failedCount = entries.filter((entry) => entry.response.status >= 400).length;
  const slowCount = Array.from(requestByIndex.values()).filter((request) => request.isSlow).length;
  const successRate = totalRequests
    ? `${(((totalRequests - failedCount) / totalRequests) * 100).toFixed(1)}%`
    : '0.0%';

  return {
    nodes,
    edges,
    criticalNodeIds: Array.from(criticalNodeIds),
    focusPath,
    totalRequests,
    failedCount,
    slowCount,
    successRate,
    p90: flowData.p90,
  };
}

const minimapNodeColor = (node: Node<RequestFlowNodePayload>) => {
  if (node.type === 'requestError') return '#ef4444';
  return TYPE_COLOR[node.data.type] || TYPE_COLOR.other;
};

function nodeMatchesFlowVisibility(
  node: Node<RequestFlowNodePayload>,
  visibleRequestIndexes: Set<number> | null,
  focusMode: RequestFlowFocusMode
): boolean {
  if (visibleRequestIndexes && !visibleRequestIndexes.has(node.data.entryIndex)) return false;

  return requestMatchesFlowFocus(
    {
      failed: node.data.status >= 400,
      isSlow: Boolean(node.data.isSlow),
    },
    focusMode
  );
}

const RequestFlowGraphView: React.FC<RequestFlowGraphViewProps> = ({
  entries,
  visibleEntries,
  filters,
  onFiltersChange,
  focusMode,
  onFocusModeChange,
  issueFocusPath,
  issueFocusEnabled,
  onIssueFocusEnabledChange,
  onNodeClick,
}) => {
  const onNodeClickRef = useRef(onNodeClick);
  const searchInputId = useId();
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const hasAutoFitFocusRef = useRef<string | null>(null);
  const [focusLikelyIssue, setFocusLikelyIssue] = useState(true);
  const [selectedErrorNodeId, setSelectedErrorNodeId] = useState<string | null>(null);
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);

  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  const handleEntrySelection = useCallback(
    (entryIndex: number) => {
      const selectedEntry = entries[entryIndex];
      if (selectedEntry && onNodeClickRef.current) {
        onNodeClickRef.current(selectedEntry);
      }
    },
    [entries]
  );

  const graphModel = useMemo(
    () => buildGraphElements(entries, handleEntrySelection),
    [entries, handleEntrySelection]
  );
  const errorJumpItems = useMemo(
    () =>
      entries
        .map((entry, index) => ({
          index,
          status: entry.response.status,
          pathLabel: compactPathLabel(getErrorJumpPathLabel(entry.request.url)),
        }))
        .filter((item) => item.status >= 400),
    [entries]
  );
  const visibleRequestIndexes = useMemo(
    () => getVisibleRequestIndexes(entries, visibleEntries),
    [entries, visibleEntries]
  );
  const {
    focusPath: computedFocusPath,
    totalRequests,
    failedCount,
    slowCount,
    p90,
  } = graphModel;
  const focusPath = issueFocusPath ?? computedFocusPath;
  const focusLikelyIssueActive = issueFocusEnabled ?? focusLikelyIssue;
  const focusAnchorLabel = focusPath?.confidence === 'low' ? 'Worth checking' : 'Likely issue';
  const focusNodeIdSet = useMemo(
    () => new Set((focusPath?.nodeIndexes ?? []).map((index) => `request-${index}`)),
    [focusPath]
  );
  const focusAnchorNodeId = focusPath ? `request-${focusPath.anchorIndex}` : null;
  const focusStepByNodeId = useMemo(() => {
    const steps = new Map<string, number>();
    if (!focusPath) return steps;

    const orderedIndexes = [
      focusPath.anchorIndex,
      ...focusPath.nodeIndexes.filter((index) => index !== focusPath.anchorIndex),
    ];

    orderedIndexes.forEach((index, pathIndex) => {
      steps.set(`request-${index}`, pathIndex + 1);
    });

    return steps;
  }, [focusPath]);
  const focusPrimaryReason = focusPath?.reasonLabels[0] ?? focusPath?.summary ?? '';
  const [nodes, setNodes, onNodesChange] = useNodesState(graphModel.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphModel.edges);

  useEffect(() => {
    setNodes(graphModel.nodes);
    setEdges(graphModel.edges);
  }, [graphModel, setEdges, setNodes]);

  useEffect(() => {
    setSelectedErrorNodeId(null);
    setPreviewNodeId(null);
  }, [entries]);

  useEffect(() => {
    if (!focusLikelyIssueActive || !focusPath || !reactFlowInstanceRef.current) return;

    const focusKey = `${focusPath.anchorIndex}:${focusPath.nodeIndexes.join(',')}`;
    if (hasAutoFitFocusRef.current === focusKey) return;

    hasAutoFitFocusRef.current = focusKey;
    window.requestAnimationFrame(() => {
      reactFlowInstanceRef.current?.fitView({
        nodes: focusPath.nodeIndexes.map((index) => ({ id: `request-${index}` })),
        padding: 0.28,
        maxZoom: 1.05,
        duration: 500,
      });
    });
  }, [focusLikelyIssueActive, focusPath]);

  const focusedNodeIdSet = useMemo(() => {
    const focused = new Set<string>();

    graphModel.nodes.forEach((node) => {
      if (nodeMatchesFlowVisibility(node, visibleRequestIndexes, focusMode)) {
        focused.add(node.id);
      }
    });

    return focused;
  }, [focusMode, graphModel.nodes, visibleRequestIndexes]);

  const focusedRequestCount = focusedNodeIdSet.size;

  const handleStatusCodeChange = useCallback(
    (code: keyof FilterOptions['statusCodes']) => {
      onFiltersChange({
        statusCodes: {
          ...filters.statusCodes,
          [code]: !filters.statusCodes[code],
        },
      });
    },
    [filters.statusCodes, onFiltersChange]
  );

  const handleSearchTermChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange({ searchTerm: event.target.value });
    },
    [onFiltersChange]
  );

  const handleErrorJump = useCallback(
    (entryIndex: number) => {
      const nodeId = `request-${entryIndex}`;
      setSelectedErrorNodeId(nodeId);
      reactFlowInstanceRef.current?.fitView({
        nodes: [{ id: nodeId }],
        padding: 0.62,
        maxZoom: 1.12,
        duration: 420,
      });
    },
    []
  );

  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => {
        const isIssueFocused = focusLikelyIssueActive && Boolean(focusPath);
        const isFocusPath = isIssueFocused && focusNodeIdSet.has(node.id);
        const isFocusAnchor = isIssueFocused && node.id === focusAnchorNodeId;
        const isErrorJumpSelected = selectedErrorNodeId === node.id;
        const isPreviewOpen = previewNodeId === node.id;
        const matchesFlowVisibility = focusedNodeIdSet.has(node.id);
        const isCritical = Boolean(isFocusPath || isErrorJumpSelected);
        const isDimmed = !matchesFlowVisibility || (isIssueFocused && !isFocusPath && !isErrorJumpSelected);

        return {
          ...node,
          data: {
            ...node.data,
            isCritical,
            isDimmed,
            isFocusPath,
            isFocusAnchor,
            isErrorJumpSelected,
            focusLabel: focusAnchorLabel,
            focusSeverity: focusPath?.severity,
            focusStep: isFocusPath ? focusStepByNodeId.get(node.id) : undefined,
            focusReason: isFocusAnchor ? focusPrimaryReason : undefined,
            onPreviewOpen: () => setPreviewNodeId(node.id),
            onPreviewClose: () => setPreviewNodeId((current) => current === node.id ? null : current),
          },
          style: {
            ...(node.style || {}),
            zIndex: isPreviewOpen ? 1000 : isErrorJumpSelected ? 4 : isFocusAnchor ? 3 : isFocusPath ? 2 : 1,
          },
        };
      }),
    [
      nodes,
      focusLikelyIssueActive,
      focusPath,
      focusNodeIdSet,
      focusAnchorNodeId,
      focusAnchorLabel,
      focusedNodeIdSet,
      focusStepByNodeId,
      focusPrimaryReason,
      selectedErrorNodeId,
      previewNodeId,
    ]
  );

  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => {
        const isIssueFocused = focusLikelyIssueActive && Boolean(focusPath);
        const edgeIsFocusPath =
          isIssueFocused &&
          focusNodeIdSet.has(edge.source) &&
          focusNodeIdSet.has(edge.target);
        const edgeMatchesFlowVisibility =
          focusedNodeIdSet.has(edge.source) && focusedNodeIdSet.has(edge.target);
        const shouldDimForFocus = !edgeMatchesFlowVisibility;
        const shouldDimForIssueFocus = isIssueFocused && !edgeIsFocusPath;
        const shouldDim = shouldDimForFocus || shouldDimForIssueFocus;
        const baseStyle = edge.style || {};
        const baseStroke = String(baseStyle.stroke || '#94a3b8');
        const focusStroke = focusPath?.severity === 'critical' ? '#ef4444' : '#f97316';
        const edgeStroke = edgeIsFocusPath
          ? focusStroke
          : baseStroke;
        const markerEnd =
          edge.markerEnd && typeof edge.markerEnd === 'object'
            ? {
                ...edge.markerEnd,
                color: edgeStroke,
              }
            : edge.markerEnd;

        return {
          ...edge,
          animated: shouldDim ? false : edge.animated,
          data: {
            ...(edge.data || {}),
            isFocusPath: edgeIsFocusPath,
          },
          style: {
            ...baseStyle,
            opacity: shouldDim ? 0.38 : 1,
            stroke: edgeStroke,
            strokeWidth: edgeIsFocusPath
              ? Math.max(Number(baseStyle.strokeWidth ?? 1.2), 3)
              : Number(baseStyle.strokeWidth ?? 1.2),
            filter: edgeIsFocusPath ? `drop-shadow(0 0 7px ${focusStroke}66)` : undefined,
          },
          markerEnd,
        };
      }),
    [edges, focusLikelyIssueActive, focusPath, focusNodeIdSet, focusedNodeIdSet]
  );

  const handleIssueFocusToggle = (enabled: boolean) => {
    if (onIssueFocusEnabledChange) {
      onIssueFocusEnabledChange(enabled);
      return;
    }

    setFocusLikelyIssue(enabled);
  };

  if (entries.length === 0) {
    return (
      <div className="request-flow-empty-state">
        <div className="request-flow-empty-icon" aria-hidden="true">
          <GlobeIcon />
        </div>
        <strong>No requests to display</strong>
        <span>Load a HAR trace to explore the journey across domains and request groups.</span>
      </div>
    );
  }

  return (
    <section className="request-flow-scattered-shell">
      <div className="request-flow-scattered-canvas">
        <ReactFlow
          className="request-flow-scattered-view"
          nodes={renderedNodes}
          edges={renderedEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          onInit={(instance) => {
            reactFlowInstanceRef.current = instance;
          }}
          fitView
          fitViewOptions={{ padding: 0.16, maxZoom: 1.05 }}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          minZoom={0.18}
          maxZoom={1.4}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} color="#e5e5e5" />
          <Controls />
          <MiniMap
            position="top-right"
            nodeColor={minimapNodeColor}
            style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
            }}
          />

          <Panel position="top-left">
            <div className="request-flow-diagnostic-toolbar" aria-label="Scattered view diagnostic controls">
              <div className="request-flow-diagnostic-toolbar-row">
                <div className="request-flow-diagnostic-focus-list" aria-label="Request Flow focus">
                  {FOCUS_OPTIONS.map((option) => (
                    <button
                      key={option.mode}
                      type="button"
                      className={`request-flow-diagnostic-chip ${focusMode === option.mode ? 'is-active' : ''}`}
                      aria-pressed={focusMode === option.mode}
                      onClick={() => onFocusModeChange(option.mode)}
                    >
                      <span aria-hidden="true">{option.icon}</span>
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>

                <label
                  className={`request-flow-diagnostic-focus-toggle ${focusLikelyIssueActive && focusPath ? 'is-active' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={focusLikelyIssueActive && Boolean(focusPath)}
                    disabled={!focusPath}
                    onChange={(event) => handleIssueFocusToggle(event.target.checked)}
                  />
                  <span>Focus issue</span>
                </label>
              </div>

              <div className="request-flow-diagnostic-toolbar-row">
                <div className="request-flow-diagnostic-status-list" aria-label="Status filters">
                  {STATUS_FILTERS.map((item) => (
                    <label key={item.code} className="request-flow-diagnostic-status-chip">
                      <input
                        type="checkbox"
                        checked={filters.statusCodes[item.code]}
                        onChange={() => handleStatusCodeChange(item.code)}
                      />
                      <span className={`status-badge status-${item.code}`}>{item.label}</span>
                    </label>
                  ))}
                </div>

                <div className="request-flow-diagnostic-count">
                  <strong>{focusedRequestCount}</strong> / {totalRequests} shown
                  {failedCount > 0 && <span className="is-danger"> · {failedCount} failed</span>}
                  {slowCount > 0 && <span> · {slowCount} slow</span>}
                  {p90 ? <span> · p90 {p90.toFixed(0)}ms</span> : null}
                </div>
              </div>

              {errorJumpItems.length > 0 && (
                <div className="request-flow-diagnostic-error-row" aria-label="Failed request jump list">
                  <span className="request-flow-diagnostic-error-label">Errors</span>
                  <div className="request-flow-diagnostic-error-list">
                    {errorJumpItems.map((item) => {
                      const nodeId = `request-${item.index}`;
                      const selected = selectedErrorNodeId === nodeId;

                      return (
                        <button
                          key={nodeId}
                          type="button"
                          className={`request-flow-diagnostic-error-chip ${selected ? 'is-selected' : ''}`}
                          aria-pressed={selected}
                          aria-label={`Open error ${item.status} ${item.pathLabel}`}
                          onClick={() => handleErrorJump(item.index)}
                        >
                          <strong>{item.status}</strong>
                          <span>{item.pathLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <label className="request-flow-diagnostic-search" htmlFor={searchInputId}>
                <SearchIcon />
                <input
                  id={searchInputId}
                  type="search"
                  value={filters.searchTerm}
                  placeholder="Search URL, status, headers..."
                  onChange={handleSearchTermChange}
                />
              </label>
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </section>
  );
};

export default RequestFlowGraphView;
