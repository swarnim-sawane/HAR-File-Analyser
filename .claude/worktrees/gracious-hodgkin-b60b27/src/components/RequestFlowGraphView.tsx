import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Entry } from '../types/har';
import { analyzeFlow, TYPE_COLOR, type ZoneRequest } from '../utils/requestFlowAnalyzer';
import { GlobeIcon } from './Icons';
import {
  DefaultNode,
  ErrorNode,
  type RequestFlowNodePayload,
} from './RequestFlowNodes';

interface RequestFlowGraphViewProps {
  entries: Entry[];
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

const RequestFlowGraphView: React.FC<RequestFlowGraphViewProps> = ({ entries, onNodeClick }) => {
  const onNodeClickRef = useRef(onNodeClick);
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

  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => {
        const isCritical = highlightCriticalPath && criticalNodeIdSet.has(node.id);
        const isDimmed = highlightCriticalPath && !isCritical;

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
    [nodes, highlightCriticalPath, criticalNodeIdSet]
  );

  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => {
        if (!highlightCriticalPath) {
          return edge;
        }

        const edgeIsCritical =
          criticalNodeIdSet.has(edge.source) && criticalNodeIdSet.has(edge.target);
        const baseStyle = edge.style || {};
        const baseStroke = String(baseStyle.stroke || '#94a3b8');
        const highlightStroke = baseStroke === '#d4d4d4' ? '#5b8def' : baseStroke;
        const markerEnd =
          edge.markerEnd && typeof edge.markerEnd === 'object'
            ? {
                ...edge.markerEnd,
                color: edgeIsCritical ? highlightStroke : baseStroke,
              }
            : edge.markerEnd;

        return {
          ...edge,
          animated: edgeIsCritical ? edge.animated : false,
          style: {
            ...baseStyle,
            opacity: edgeIsCritical ? 1 : 0.14,
            stroke: edgeIsCritical ? highlightStroke : baseStroke,
            strokeWidth: edgeIsCritical
              ? Math.max(Number(baseStyle.strokeWidth ?? 1.2), 2.4)
              : Number(baseStyle.strokeWidth ?? 1.2),
          },
          markerEnd,
        };
      }),
    [edges, highlightCriticalPath, criticalNodeIdSet]
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
