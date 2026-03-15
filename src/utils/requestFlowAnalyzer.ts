// src/utils/requestFlowAnalyzer.ts
import { Entry } from '../types/har';
import { Node, Edge } from 'reactflow';

export interface FlowNodeData {
  label: string;
  url: string;
  method: string;
  status: number;
  time: number;
  type: string;
  failed: boolean;
  isSlow: boolean;
}

export type FlowNode = Node<FlowNodeData>;
export type FlowEdge = Edge;

const getResourceType = (entry: Entry): string => {
  const extendedEntry = entry as any;
  if (extendedEntry._resourceType) return extendedEntry._resourceType;

  const contentType = entry.response.content.mimeType?.toLowerCase?.() || '';
  const url = entry.request.url.toLowerCase();

  if (contentType.includes('html')) return 'document';
  if (contentType.includes('javascript')) return 'script';
  if (contentType.includes('css')) return 'stylesheet';
  if (contentType.includes('image')) return 'image';
  if (contentType.includes('font')) return 'font';
  if (contentType.includes('xml') || contentType.includes('json')) return 'xhr';

  if (url.endsWith('.js')) return 'script';
  if (url.endsWith('.css')) return 'stylesheet';
  if (url.match(/\.(png|jpe?g|gif|svg|webp)$/)) return 'image';
  if (url.match(/\.(woff2?|ttf|eot|otf)$/)) return 'font';

  return 'other';
};

export const analyzeRequestFlow = (entries: Entry[]) => {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  if (!entries.length) return { nodes, edges, p90: 0 };

  const sortedEntries = [...entries].sort(
    (a, b) =>
      new Date(a.startedDateTime).getTime() -
      new Date(b.startedDateTime).getTime()
  );

  const times = sortedEntries.map((e) => e.time || 0).sort((a, b) => a - b);
  const p90Index = Math.floor(times.length * 0.9);
  const p90 = times[p90Index] || 0;

  const domainGroups: Record<string, number> = {};
  let currentY = 0;

  sortedEntries.forEach((entry, index) => {
    const urlObj = new URL(entry.request.url);
    const domain = urlObj.hostname;

    if (domainGroups[domain] === undefined) {
      domainGroups[domain] = currentY;
      currentY += 150;
    }

    const isFailed = entry.response.status >= 400;
    const resourceType = getResourceType(entry);
    const isSlow = (entry.time || 0) >= p90;

    const node: FlowNode = {
      id: `request-${index}`,
      type: isFailed ? 'errorNode' : 'defaultNode',
      position: {
        x: index * 260,
        y: domainGroups[domain],
      },
      data: {
        label: `${entry.request.method} ${entry.response.status}`,
        url: entry.request.url,
        method: entry.request.method,
        status: entry.response.status,
        time: entry.time,
        type: resourceType,
        failed: isFailed,
        isSlow,
      },
    };

    nodes.push(node);

    const initiator = (entry as any)._initiator;
    if (initiator && initiator.url) {
      const initiatorIndex = sortedEntries.findIndex(
        (e) => e.request.url === initiator.url
      );

      if (initiatorIndex !== -1 && initiatorIndex < index) {
        edges.push({
          id: `edge-${initiatorIndex}-${index}`,
          source: `request-${initiatorIndex}`,
          target: `request-${index}`,
          animated: isFailed,
          style: {
            stroke: isFailed ? '#ef4444' : '#94a3b8',
            strokeWidth: 2,
          },
        });
      }
    } else if (index > 0) {
      const prevEntry = sortedEntries[index - 1];
      const timeDiff =
        new Date(entry.startedDateTime).getTime() -
        new Date(prevEntry.startedDateTime).getTime();

      if (timeDiff < 100) {
        edges.push({
          id: `edge-${index - 1}-${index}`,
          source: `request-${index - 1}`,
          target: `request-${index}`,
          style: {
            stroke: isFailed ? '#ef4444' : '#d4d4d4',
            strokeWidth: 1,
            strokeDasharray: '5,5',
          },
        });
      }
    }
  });

  return { nodes, edges, p90 };
};

export const getCriticalPath = (entries: Entry[]): string[] => {
  if (!entries.length) return [];

  const sorted = [...entries].sort(
    (a, b) =>
      new Date(a.startedDateTime).getTime() -
      new Date(b.startedDateTime).getTime()
  );

  const criticalRequests = sorted.filter((entry) => {
    const resourceType = getResourceType(entry);
    return (
      resourceType === 'document' ||
      resourceType === 'script' ||
      entry.response.status >= 400
    );
  });

  return criticalRequests.map((e) => e.request.url);
};
