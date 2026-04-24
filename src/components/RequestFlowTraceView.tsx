import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Panel,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import type { Edge, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import type { Entry } from '../types/har';
import {
  analyzeSystemTrace,
  type SystemTraceEdge,
  type SystemTraceNode,
  type TraceRelationType,
} from '../utils/requestSystemTraceAnalyzer';
import { AlertIcon, GlobeIcon, InfoIcon, RouteIcon, ServerIcon } from './Icons';
import {
  DefaultNode,
  ErrorNode,
  type RequestFlowNodePayload,
} from './RequestFlowNodes';

interface RequestFlowTraceViewProps {
  entries: Entry[];
  onNodeClick?: (entry: Entry) => void;
}

const NODE_TYPES = {
  request: DefaultNode,
  requestError: ErrorNode,
};

const PRIMARY_X_START = 72;
const PRIMARY_X_GAP = 280;
const PRIMARY_Y = 240;
const BRANCH_X_OFFSET = 150;
const BRANCH_Y_OFFSET = 132;
const BRANCH_Y_STEP = 110;

const getRelationTone = (relationType: TraceRelationType, isPrimary: boolean) => {
  switch (relationType) {
    case 'redirect':
      return {
        stroke: '#f59e0b',
        strokeWidth: isPrimary ? 3 : 2,
        strokeDasharray: undefined,
      };
    case 'initiator':
      return {
        stroke: isPrimary ? '#5b8def' : '#93c5fd',
        strokeWidth: isPrimary ? 2.7 : 1.8,
        strokeDasharray: undefined,
      };
    default:
      return {
        stroke: isPrimary ? '#94a3b8' : '#cbd5e1',
        strokeWidth: isPrimary ? 2.1 : 1.6,
        strokeDasharray: '6 6',
      };
  }
};

const buildTraceGraph = (
  traceNodes: SystemTraceNode[],
  traceEdges: SystemTraceEdge[],
  primaryChainEntryIndexes: number[],
  onEntrySelect?: (entryIndex: number) => void
) => {
  const primaryOrderByIndex = new Map(
    primaryChainEntryIndexes.map((entryIndex, order) => [entryIndex, order])
  );
  const edgeByTarget = new Map(traceEdges.map((edge) => [edge.target, edge]));
  const positions = new Map<number, { x: number; y: number }>();
  const branchCountsByParent = new Map<number, number>();

  primaryChainEntryIndexes.forEach((entryIndex, order) => {
    positions.set(entryIndex, {
      x: PRIMARY_X_START + order * PRIMARY_X_GAP,
      y: PRIMARY_Y,
    });
  });

  traceNodes
    .filter((node) => node.traceRole === 'branch')
    .forEach((node) => {
      const parentEdge = edgeByTarget.get(node.entryIndex);
      const parentIndex = parentEdge?.source;
      const parentPosition =
        parentIndex !== undefined ? positions.get(parentIndex) : undefined;

      if (parentIndex === undefined || !parentPosition) {
        positions.set(node.entryIndex, {
          x: PRIMARY_X_START,
          y: PRIMARY_Y + BRANCH_Y_OFFSET,
        });
        return;
      }

      const branchCount = branchCountsByParent.get(parentIndex) ?? 0;
      const direction = branchCount % 2 === 0 ? -1 : 1;
      const tier = Math.floor(branchCount / 2) + 1;

      positions.set(node.entryIndex, {
        x: parentPosition.x + BRANCH_X_OFFSET,
        y: PRIMARY_Y + direction * (BRANCH_Y_OFFSET + (tier - 1) * BRANCH_Y_STEP),
      });

      branchCountsByParent.set(parentIndex, branchCount + 1);
    });

  const nodes: Array<Node<RequestFlowNodePayload>> = traceNodes.map((node) => ({
    id: node.id,
    type: node.failed ? 'requestError' : 'request',
    position: positions.get(node.entryIndex) ?? { x: PRIMARY_X_START, y: PRIMARY_Y },
    draggable: true,
    selectable: true,
    data: {
      type: node.type,
      status: node.status,
      method: node.method,
      url: node.url,
      time: node.time,
      isSlow: node.isSlow,
      isCritical: node.traceRole !== 'branch',
      entryIndex: node.entryIndex,
      domainLabel: node.domainLabel,
      productLabel: node.productLabel,
      traceRole: node.traceRole,
      onClick: onEntrySelect ? () => onEntrySelect(node.entryIndex) : undefined,
    },
  }));

  const edges: Edge[] = traceEdges.map((edge) => {
    const relationTone = getRelationTone(edge.relationType, edge.isPrimary);

    return {
      id: edge.id,
      source: `trace-${edge.source}`,
      target: `trace-${edge.target}`,
      type: 'simplebezier',
      animated: edge.isPrimary && edge.relationType === 'redirect',
      data: {
        relationType: edge.relationType,
        isPrimary: edge.isPrimary,
      },
      style: {
        stroke: relationTone.stroke,
        strokeWidth: relationTone.strokeWidth,
        strokeDasharray: relationTone.strokeDasharray,
        opacity: edge.isPrimary ? 1 : 0.58,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: relationTone.stroke,
      },
    };
  });

  return { nodes, edges };
};

const RequestFlowTraceView: React.FC<RequestFlowTraceViewProps> = ({ entries, onNodeClick }) => {
  const onNodeClickRef = useRef(onNodeClick);

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

  const traceModel = useMemo(() => analyzeSystemTrace(entries), [entries]);
  const graphModel = useMemo(
    () =>
      buildTraceGraph(
        traceModel.nodes,
        traceModel.edges,
        traceModel.primaryChainEntryIndexes,
        handleEntrySelection
      ),
    [traceModel, handleEntrySelection]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(graphModel.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphModel.edges);

  useEffect(() => {
    setNodes(graphModel.nodes);
    setEdges(graphModel.edges);
  }, [graphModel, setEdges, setNodes]);

  if (!entries.length) {
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

  const summary = traceModel.summary;

  return (
    <section className="request-flow-graph-shell">
      <div className="request-flow-graph-header">
        <div className="request-flow-graph-copy">
          <span className="request-flow-graph-kicker">
            <RouteIcon />
            <span>System Trace</span>
          </span>
          <h3>Trace the dominant request chain</h3>
          <p>Follow the dominant visible chain through redirects, initiators, and fallback links.</p>
        </div>

        {summary && (
          <div className="request-flow-graph-stats">
            <div className="request-flow-graph-stat">
              <span className="request-flow-graph-stat-icon">
                <ServerIcon />
              </span>
              <div>
                <strong>{summary.primaryReason}</strong>
                <span>Primary reason</span>
              </div>
            </div>

            <div className="request-flow-graph-stat">
              <span className="request-flow-graph-stat-icon is-warning">
                <AlertIcon />
              </span>
              <div>
                <strong>{summary.terminalStatus}</strong>
                <span>Terminal status</span>
              </div>
            </div>

            <div className="request-flow-graph-stat">
              <span className="request-flow-graph-stat-icon">
                <RouteIcon />
              </span>
              <div>
                <strong>{summary.hopCount}</strong>
                <span>Primary hops</span>
              </div>
            </div>

            <div className="request-flow-graph-stat">
              <span className="request-flow-graph-stat-icon">
                <InfoIcon />
              </span>
              <div>
                <strong>{summary.confidence}</strong>
                <span>Inference confidence</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="request-flow-graph-canvas">
        <ReactFlow
          className="request-flow-graph"
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          minZoom={0.2}
          maxZoom={1.35}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} color="#d6deeb" />
          <Controls />

          {summary && (
            <Panel position="top-right">
              <div className="request-flow-scattered-panel request-flow-scattered-summary">
                <div className="request-flow-scattered-panel-title">System Trace Summary</div>
                <div className="request-flow-scattered-summary-line">
                  Visible Requests: <strong>{traceModel.totalRequests}</strong>
                </div>
                <div className="request-flow-scattered-summary-line">
                  Primary Nodes: <strong>{traceModel.primaryChainEntryIndexes.length}</strong>
                </div>
                <div className="request-flow-scattered-summary-line">
                  Branches: <strong>{traceModel.branchCount}</strong>
                </div>
                <div className="request-flow-scattered-summary-line">
                  Duration: <strong>{Math.round(summary.totalDurationMs)}ms</strong>
                </div>
              </div>
            </Panel>
          )}

          <Panel position="top-left">
            <div className="request-flow-scattered-panel request-flow-scattered-legend">
              <div className="request-flow-scattered-panel-title">Relations</div>
              <div className="request-flow-scattered-legend-list">
                <div className="request-flow-scattered-legend-item">
                  <span className="request-flow-graph-legend-line tone-primary" />
                  <span>Initiator</span>
                </div>
                <div className="request-flow-scattered-legend-item">
                  <span className="request-flow-graph-legend-line tone-warning" />
                  <span>Redirect</span>
                </div>
                <div className="request-flow-scattered-legend-item">
                  <span className="request-flow-graph-legend-line tone-muted" />
                  <span>Sequential fallback</span>
                </div>
              </div>
            </div>
          </Panel>
        </ReactFlow>
      </div>

      <div className="request-flow-graph-footer">
        <div className="request-flow-graph-legend">
          <span className="request-flow-graph-legend-title">Trace cues</span>
          <span className="request-flow-graph-legend-item">
            <span className="request-flow-graph-legend-line tone-primary" />
            Primary chain
          </span>
          <span className="request-flow-graph-legend-item">
            <span className="request-flow-graph-legend-line tone-muted" />
            Secondary branch
          </span>
        </div>

        <div className="request-flow-graph-note">
          <InfoIcon />
          <span>Inferred from HAR request relationships, not backend span data.</span>
        </div>
      </div>
    </section>
  );
};

export default RequestFlowTraceView;
