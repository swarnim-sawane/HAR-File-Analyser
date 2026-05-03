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
import type { Edge, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { Entry, FilterOptions } from '../types/har';
import type { RequestFlowFocusMode } from '../types/requestFlow';
import {
  getVisibleRequestIndexes,
  requestMatchesFlowFocus,
} from '../utils/requestFlowFilters';
import { analyzeFlow, TYPE_COLOR, type ZoneRequest } from '../utils/requestFlowAnalyzer';
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
  onNodeClick?: (entry: Entry) => void;
}

const NODE_TYPES = {
  request: DefaultNode,
  requestError: ErrorNode,
};

const LEGEND_ITEMS = [
  { label: 'Document', color: TYPE_COLOR.document },
  { label: 'Script', color: TYPE_COLOR.script },
  { label: 'XHR', color: TYPE_COLOR.xhr },
  { label: 'Stylesheet', color: TYPE_COLOR.stylesheet },
  { label: 'Image', color: TYPE_COLOR.image },
  { label: 'Error', color: '#ef4444' },
];

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

function buildGraphElements(
  entries: Entry[],
  onEntrySelect?: (entryIndex: number) => void
) {
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
        method: request?.method ?? entry.request.method,
        url: request?.url ?? entry.request.url,
        time: request?.time ?? entry.time,
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
  onNodeClick,
}) => {
  const onNodeClickRef = useRef(onNodeClick);
  const searchInputId = useId();
  const [highlightCriticalPath, setHighlightCriticalPath] = useState(false);

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
  const visibleRequestIndexes = useMemo(
    () => getVisibleRequestIndexes(entries, visibleEntries),
    [entries, visibleEntries]
  );
  const {
    criticalNodeIds,
    totalRequests,
    failedCount,
    slowCount,
    successRate,
    p90,
  } = graphModel;
  const criticalNodeIdSet = useMemo(() => new Set(criticalNodeIds), [criticalNodeIds]);
  const [nodes, setNodes, onNodesChange] = useNodesState(graphModel.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphModel.edges);

  useEffect(() => {
    setNodes(graphModel.nodes);
    setEdges(graphModel.edges);
  }, [graphModel, setEdges, setNodes]);

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

  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => {
        const isCritical = highlightCriticalPath && criticalNodeIdSet.has(node.id);
        const matchesFlowVisibility = focusedNodeIdSet.has(node.id);
        const isDimmed = !matchesFlowVisibility || (highlightCriticalPath && !isCritical);

        return {
          ...node,
          data: {
            ...node.data,
            isCritical,
            isDimmed,
          },
          style: {
            ...(node.style || {}),
            opacity: isDimmed ? 0.28 : 1,
            zIndex: isCritical ? 2 : 1,
          },
        };
      }),
    [nodes, highlightCriticalPath, criticalNodeIdSet, focusedNodeIdSet]
  );

  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => {
        const edgeIsCritical =
          criticalNodeIdSet.has(edge.source) && criticalNodeIdSet.has(edge.target);
        const edgeMatchesFlowVisibility =
          focusedNodeIdSet.has(edge.source) && focusedNodeIdSet.has(edge.target);
        const shouldDimForFocus = !edgeMatchesFlowVisibility;
        const shouldDimForCritical = highlightCriticalPath && !edgeIsCritical;
        const shouldDim = shouldDimForFocus || shouldDimForCritical;
        const baseStyle = edge.style || {};
        const baseStroke = String(baseStyle.stroke || '#94a3b8');
        const highlightStroke = baseStroke === '#d4d4d4' ? '#5b8def' : baseStroke;
        const edgeStroke = highlightCriticalPath && edgeIsCritical && !shouldDimForFocus
          ? highlightStroke
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
          style: {
            ...baseStyle,
            opacity: shouldDim ? 0.14 : 1,
            stroke: edgeStroke,
            strokeWidth: highlightCriticalPath && edgeIsCritical && !shouldDimForFocus
              ? Math.max(Number(baseStyle.strokeWidth ?? 1.2), 2.4)
              : Number(baseStyle.strokeWidth ?? 1.2),
          },
          markerEnd,
        };
      }),
    [edges, highlightCriticalPath, criticalNodeIdSet, focusedNodeIdSet]
  );

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
            nodeColor={minimapNodeColor}
            style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
            }}
          />

          <Panel position="top-left">
            <div className="request-flow-scattered-panel request-flow-scattered-filter-panel">
              <div className="request-flow-scattered-panel-title">Request Filters</div>

              <div className="request-flow-scattered-focus-list" aria-label="Request Flow focus">
                {FOCUS_OPTIONS.map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    className={`request-flow-scattered-focus-chip ${focusMode === option.mode ? 'is-active' : ''}`}
                    aria-pressed={focusMode === option.mode}
                    onClick={() => onFocusModeChange(option.mode)}
                  >
                    <span aria-hidden="true">{option.icon}</span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>

              <div className="request-flow-scattered-filter-count">
                Focused: <strong>{focusedRequestCount}</strong> of <strong>{totalRequests}</strong>
              </div>

              <div className="request-flow-scattered-divider" />

              <div className="request-flow-scattered-status-grid" aria-label="Status filters">
                {STATUS_FILTERS.map((item) => (
                  <label key={item.code} className="request-flow-scattered-status-toggle">
                    <input
                      type="checkbox"
                      checked={filters.statusCodes[item.code]}
                      onChange={() => handleStatusCodeChange(item.code)}
                    />
                    <span className={`status-badge status-${item.code}`}>{item.label}</span>
                  </label>
                ))}
              </div>

              <label className="request-flow-scattered-search-label" htmlFor={searchInputId}>
                <span>Search</span>
                <span className="request-flow-scattered-search-box">
                  <SearchIcon />
                  <input
                    id={searchInputId}
                    type="search"
                    value={filters.searchTerm}
                    placeholder="URL, status, headers..."
                    onChange={handleSearchTermChange}
                  />
                </span>
              </label>
            </div>
          </Panel>

          <Panel position="bottom-left">
            <div className="request-flow-scattered-panel request-flow-scattered-legend">
              <div className="request-flow-scattered-panel-title">Legend</div>
              <div className="request-flow-scattered-legend-list">
                {LEGEND_ITEMS.map((item) => (
                  <div key={item.label} className="request-flow-scattered-legend-item">
                    <span
                      className="request-flow-scattered-legend-dot"
                      style={{ ['--legend-color' as string]: item.color } as React.CSSProperties}
                    />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel position="top-right">
            <div className="request-flow-scattered-panel request-flow-scattered-summary">
              <div className="request-flow-scattered-panel-title">Request Flow Summary</div>
              <div className="request-flow-scattered-summary-line">
                Total Requests: <strong>{totalRequests}</strong>
              </div>
              <div className="request-flow-scattered-summary-line">
                Failed:{' '}
                <strong className={failedCount > 0 ? 'is-danger' : undefined}>{failedCount}</strong>
              </div>
              <div className="request-flow-scattered-summary-line">
                Success Rate: <strong>{successRate}</strong>
              </div>
              <div className="request-flow-scattered-summary-line">
                Slow ({'>='} p90): <strong>{slowCount}</strong>{' '}
                {p90 ? <span>{`(${p90.toFixed(0)}ms+)`}</span> : null}
              </div>
              <div className="request-flow-scattered-divider" />
              <label
                className={`request-flow-scattered-checkbox ${highlightCriticalPath ? 'is-active' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={highlightCriticalPath}
                  onChange={(event) => setHighlightCriticalPath(event.target.checked)}
                />
                <span>Highlight critical path</span>
              </label>
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </section>
  );
};

export default RequestFlowGraphView;
