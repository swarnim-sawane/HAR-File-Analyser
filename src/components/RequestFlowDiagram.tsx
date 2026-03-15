// src/components/RequestFlowDiagram.tsx
import React, { useCallback, useMemo, useState } from 'react';
import ReactFlow, {
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  ConnectionLineType,
  Panel,
  MiniMap,
  Node,
  Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { Entry } from '../types/har';
import {
  analyzeRequestFlow,
  getCriticalPath,
  FlowNode,
  FlowEdge,
  FlowNodeData,
} from '../utils/requestFlowAnalyzer';
import { DefaultNode, ErrorNode } from './RequestFlowNodes';

interface RequestFlowDiagramProps {
  entries: Entry[];
  onNodeClick?: (entry: Entry) => void;
}

const nodeTypes = {
  defaultNode: DefaultNode,
  errorNode: ErrorNode,
};

const RequestFlowDiagram: React.FC<RequestFlowDiagramProps> = ({
  entries,
  onNodeClick,
}) => {
  // Initial nodes/edges from analysis
  const { nodes: baseNodes, edges: baseEdges, p90 } = useMemo(
    () => analyzeRequestFlow(entries),
    [entries]
  );

  // React Flow state
  const [nodes, , onNodesChange] = useNodesState<FlowNodeData>(
    baseNodes as Node<FlowNodeData>[]
  );
  const [edges, , onEdgesChange] = useEdgesState(
    baseEdges as Edge[]
  );

  // UI toggles
  const [showCriticalPath, setShowCriticalPath] = useState(true);
  const [highlightErrors, setHighlightErrors] = useState(true);
  const [hideNonCritical, setHideNonCritical] = useState(false);

  const criticalUrls = useMemo(
    () => getCriticalPath(entries),
    [entries]
  );

  // Enhance nodes with highlighting / opacity
  const enhancedNodes: FlowNode[] = useMemo(() => {
    return (nodes as FlowNode[]).map((n) => {
      const data = n.data as FlowNodeData;
      const isCritical =
        showCriticalPath && criticalUrls.includes(data.url);
      const isError = data.failed;

      let opacity = 1;
      if (highlightErrors && !isError) {
        opacity = 0.35;
      }

      return {
        ...n,
        style: {
          ...(n.style || {}),
          opacity,
          boxShadow: isCritical
            ? '0 0 12px rgba(168, 85, 247, 0.8)'
            : n.style?.boxShadow,
          borderColor: isCritical ? '#a855f7' : n.style?.borderColor,
        },
      };
    });
  }, [nodes, showCriticalPath, highlightErrors, criticalUrls]);

  // Enhance edges with opacity based on error chains
  const enhancedEdges: FlowEdge[] = useMemo(() => {
    return (edges as FlowEdge[]).map((e) => {
      const sourceNode = enhancedNodes.find((n) => n.id === e.source);
      const targetNode = enhancedNodes.find((n) => n.id === e.target);

      const sourceFailed =
        sourceNode && (sourceNode.data as FlowNodeData).failed;
      const targetFailed =
        targetNode && (targetNode.data as FlowNodeData).failed;

      const isError = !!(sourceFailed || targetFailed);

      let opacity = 1;
      if (highlightErrors && !isError) {
        opacity = 0.25;
      }

      return {
        ...e,
        style: {
          ...(e.style || {}),
          opacity,
        },
      };
    });
  }, [edges, enhancedNodes, highlightErrors]);

  // Optional filter: hide non-critical asset types
  const filteredNodes: FlowNode[] = useMemo(() => {
    if (!hideNonCritical) return enhancedNodes;

    const keepTypes = new Set(['document', 'script', 'xhr', 'stylesheet']);
    const keepIds = enhancedNodes
      .filter((n) => keepTypes.has((n.data as FlowNodeData).type))
      .map((n) => n.id);
    const keepSet = new Set(keepIds);

    return enhancedNodes.filter((n) => keepSet.has(n.id));
  }, [enhancedNodes, hideNonCritical]);

  const filteredEdges: FlowEdge[] = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    return enhancedEdges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    );
  }, [enhancedEdges, filteredNodes]);

  // Node click → bubble up original entry
  const onNodeClickHandler = useCallback(
    (event: React.MouseEvent, node: Node<FlowNodeData>) => {
      const index = parseInt(node.id.split('-')[1], 10);
      if (onNodeClick && entries[index]) {
        onNodeClick(entries[index]);
      }
    },
    [entries, onNodeClick]
  );

  // Summary stats
  const failedCount = entries.filter((e) => e.response.status >= 400).length;
  const totalRequests = entries.length;
  const slowCount = entries.filter((e) => (e.time || 0) >= p90).length;

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={filteredNodes}
        edges={filteredEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClickHandler}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        attributionPosition="bottom-left"
      >
        <Background gap={16} color="#e5e5e5" />
        <Controls />

        <MiniMap
          nodeColor={(node) => {
            const data = (node as Node<FlowNodeData>).data;
            if (data?.failed) return '#ef4444';
            switch (data?.type) {
              case 'document':
                return '#3b82f6';
              case 'script':
                return '#f59e0b';
              case 'xhr':
                return '#10b981';
              case 'stylesheet':
                return '#a78bfa';
              case 'image':
                return '#ec4899';
              default:
                return '#9ca3af';
            }
          }}
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
          }}
        />

        {/* Legend + filter */}
        <Panel
          position="top-left"
          style={{
            background: 'var(--bg-primary)',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            fontSize: '11px',
            color: 'var(--text-secondary)',
          }}
        >
          <div
            style={{
              fontWeight: 600,
              marginBottom: 8,
              color: 'var(--text-primary)',
            }}
          >
            Legend
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div>
              <span style={{ color: '#3b82f6' }}>●</span> Document
            </div>
            <div>
              <span style={{ color: '#f59e0b' }}>●</span> Script
            </div>
            <div>
              <span style={{ color: '#10b981' }}>●</span> XHR
            </div>
            <div>
              <span style={{ color: '#a78bfa' }}>●</span> Stylesheet
            </div>
            <div>
              <span style={{ color: '#ec4899' }}>●</span> Image
            </div>
            <div>
              <span style={{ color: '#ef4444' }}>●</span> Error
            </div>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 10,
            }}
          >
            <input
              type="checkbox"
              checked={hideNonCritical}
              onChange={(e) => setHideNonCritical(e.target.checked)}
            />
            <span>Hide images/fonts/other</span>
          </label>
        </Panel>

        {/* Summary + toggles */}
        <Panel
          position="top-right"
          style={{
            background: 'var(--bg-primary)',
            padding: '16px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            minWidth: '220px',
          }}
        >
          <div
            style={{
              marginBottom: 8,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            Request Flow Summary
          </div>
          <div>
            Total Requests: <strong>{totalRequests}</strong>
          </div>
          <div>
            Failed:{' '}
            <strong style={{ color: '#ef4444' }}>{failedCount}</strong>
          </div>
          <div>
            Success Rate:{' '}
            <strong>
              {totalRequests
                ? (
                    ((totalRequests - failedCount) / totalRequests) *
                    100
                  ).toFixed(1)
                : '0'}
              %
            </strong>
          </div>
          <div>
            Slow (≥ p90): <strong>{slowCount}</strong>{' '}
            {p90 ? `(${p90.toFixed(0)}ms+)` : ''}
          </div>

          <hr
            style={{
              border: 'none',
              borderTop: '1px solid var(--border-color)',
              margin: '10px 0',
            }}
          />

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <input
              type="checkbox"
              checked={showCriticalPath}
              onChange={(e) => setShowCriticalPath(e.target.checked)}
            />
            <span>Highlight critical path</span>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <input
              type="checkbox"
              checked={highlightErrors}
              onChange={(e) => setHighlightErrors(e.target.checked)}
            />
            <span>Emphasize error chains</span>
          </label>
        </Panel>
      </ReactFlow>
    </div>
  );
};

export default RequestFlowDiagram;
