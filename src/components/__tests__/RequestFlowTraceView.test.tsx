import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Entry } from '../../types/har';

type AnalyzeSystemTraceFn = typeof import('../../utils/requestSystemTraceAnalyzer')['analyzeSystemTrace'];
type RequestFlowTraceViewComponent = typeof import('../RequestFlowTraceView').default;

let analyzeSystemTrace: AnalyzeSystemTraceFn | undefined;
let RequestFlowTraceView: RequestFlowTraceViewComponent | undefined;

vi.mock('reactflow', async () => {
  const ReactModule = await import('react');

  return {
    __esModule: true,
    default: ({ nodes, edges, nodeTypes, children, nodesDraggable, onNodesChange, onEdgesChange }: any) => (
      <div
        data-testid="react-flow-mock"
        data-nodes-draggable={String(nodesDraggable)}
        data-has-on-nodes-change={String(typeof onNodesChange === 'function')}
        data-has-on-edges-change={String(typeof onEdgesChange === 'function')}
      >
        {nodes.map((node: any) => {
          const NodeComponent = nodeTypes[node.type];

          return (
            <div
              key={node.id}
              data-testid="react-flow-node"
              data-node-type={node.type}
              data-node-trace-role={String(node.data?.traceRole || '')}
              data-node-draggable={node.draggable === undefined ? 'unset' : String(node.draggable)}
            >
              <NodeComponent
                id={node.id}
                type={node.type}
                data={node.data}
                selected={false}
                dragging={false}
                zIndex={1}
                xPos={node.position?.x ?? 0}
                yPos={node.position?.y ?? 0}
                isConnectable
                positionAbsoluteX={node.position?.x ?? 0}
                positionAbsoluteY={node.position?.y ?? 0}
              />
            </div>
          );
        })}
        {edges.map((edge: any) => (
          <div
            key={edge.id}
            data-testid="react-flow-edge"
            data-edge-type={edge.type ?? 'default'}
            data-edge-relation-type={edge.data?.relationType ?? ''}
            data-edge-primary={String(Boolean(edge.data?.isPrimary))}
          />
        ))}
        {children}
      </div>
    ),
    Background: () => <div data-testid="react-flow-background" />,
    Controls: () => <div data-testid="react-flow-controls" />,
    MiniMap: () => <div data-testid="react-flow-minimap" />,
    Panel: ({ children, position }: any) => (
      <div data-testid={`react-flow-panel-${position}`}>{children}</div>
    ),
    Handle: () => <span data-testid="react-flow-handle" />,
    Position: {
      Left: 'left',
      Right: 'right',
      Top: 'top',
      Bottom: 'bottom',
    },
    MarkerType: {
      ArrowClosed: 'arrowclosed',
    },
    useNodesState: (initialNodes: any) => {
      const [nodes, setNodes] = ReactModule.useState(initialNodes);
      return [nodes, setNodes, vi.fn()];
    },
    useEdgesState: (initialEdges: any) => {
      const [edges, setEdges] = ReactModule.useState(initialEdges);
      return [edges, setEdges, vi.fn()];
    },
  };
});

const createEntry = ({
  startedDateTime,
  url,
  status = 200,
  time = 220,
  method = 'GET',
  mimeType = 'application/json',
  initiatorUrl,
  redirectURL = '',
  locationHeader,
}: {
  startedDateTime: string;
  url: string;
  status?: number;
  time?: number;
  method?: string;
  mimeType?: string;
  initiatorUrl?: string;
  redirectURL?: string;
  locationHeader?: string;
}): Entry => {
  const entry = {
    startedDateTime,
    time,
    request: {
      method,
      url,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [],
      queryString: [],
      headersSize: 120,
      bodySize: 0,
    },
    response: {
      status,
      statusText: status >= 400 ? 'Error' : 'OK',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: locationHeader ? [{ name: 'Location', value: locationHeader }] : [],
      content: {
        size: 1024,
        mimeType,
      },
      redirectURL,
      headersSize: 160,
      bodySize: 1024,
    },
    cache: {},
    timings: {
      blocked: 10,
      dns: 15,
      connect: 20,
      ssl: 0,
      send: 10,
      wait: Math.max(20, time - 65),
      receive: 10,
    },
  } as Entry & { _initiator?: { url: string } };

  if (initiatorUrl) {
    entry._initiator = { url: initiatorUrl };
  }

  return entry;
};

beforeAll(async () => {
  const analyzerPath = '../../utils/requestSystemTraceAnalyzer';
  const componentPath = '../RequestFlowTraceView';

  try {
    ({ analyzeSystemTrace } = await import(/* @vite-ignore */ analyzerPath));
  } catch {
    analyzeSystemTrace = undefined;
  }

  try {
    ({ default: RequestFlowTraceView } = await import(/* @vite-ignore */ componentPath));
  } catch {
    RequestFlowTraceView = undefined;
  }
});

describe('analyzeSystemTrace', () => {
  it('selects an error-first primary chain and keeps side requests as branches', () => {
    expect(analyzeSystemTrace).toBeTypeOf('function');
    if (!analyzeSystemTrace) return;

    const entries: Entry[] = [
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.000Z',
        url: 'https://portal.example.com/',
        mimeType: 'text/html',
      }),
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.120Z',
        url: 'https://static.examplecdn.com/app.js',
        mimeType: 'application/javascript',
        initiatorUrl: 'https://portal.example.com/',
        time: 180,
      }),
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.480Z',
        url: 'https://api.example.com/orders',
        status: 504,
        initiatorUrl: 'https://static.examplecdn.com/app.js',
        time: 2200,
      }),
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.520Z',
        url: 'https://images.examplecdn.com/hero.png',
        mimeType: 'image/png',
        initiatorUrl: 'https://portal.example.com/',
        time: 140,
      }),
    ];

    const trace = analyzeSystemTrace(entries);

    expect(trace.summary.selectionMode).toBe('5xx');
    expect(trace.summary.terminalStatus).toBe(504);
    expect(trace.primaryChainEntryIndexes).toEqual([0, 1, 2]);
    expect(trace.nodes.filter((node) => node.traceRole === 'branch').map((node) => node.entryIndex)).toEqual([3]);
    expect(trace.nodes.find((node) => node.entryIndex === 0)?.traceRole).toBe('root');
    expect(trace.nodes.find((node) => node.entryIndex === 2)?.traceRole).toBe('terminal');
  });

  it('falls back to the slowest visible chain when there are no failures', () => {
    expect(analyzeSystemTrace).toBeTypeOf('function');
    if (!analyzeSystemTrace) return;

    const entries: Entry[] = [
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.000Z',
        url: 'https://portal.example.com/',
        mimeType: 'text/html',
      }),
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.200Z',
        url: 'https://api.example.com/users',
        initiatorUrl: 'https://portal.example.com/',
        time: 1600,
      }),
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.240Z',
        url: 'https://static.examplecdn.com/app.js',
        mimeType: 'application/javascript',
        initiatorUrl: 'https://portal.example.com/',
        time: 160,
      }),
    ];

    const trace = analyzeSystemTrace(entries);

    expect(trace.summary.selectionMode).toBe('slow');
    expect(trace.summary.terminalStatus).toBe(200);
    expect(trace.primaryChainEntryIndexes).toEqual([0, 1]);
    expect(trace.terminalEntryIndex).toBe(1);
  });

  it('uses sequential fallback edges and marks lower confidence when explicit relationships are absent', () => {
    expect(analyzeSystemTrace).toBeTypeOf('function');
    if (!analyzeSystemTrace) return;

    const entries: Entry[] = [
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.000Z',
        url: 'https://portal.example.com/',
        mimeType: 'text/html',
        time: 140,
      }),
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.200Z',
        url: 'https://portal.example.com/bootstrap',
        time: 180,
      }),
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.420Z',
        url: 'https://portal.example.com/data',
        time: 1400,
      }),
    ];

    const trace = analyzeSystemTrace(entries);

    expect(trace.summary.selectionMode).toBe('slow');
    expect(trace.summary.confidence).toBe('low');
    expect(trace.primaryChainEntryIndexes).toEqual([0, 1, 2]);
    expect(
      trace.edges.filter((edge) => edge.isPrimary).map((edge) => edge.relationType)
    ).toEqual(['sequential', 'sequential']);
  });

  it('computes the trace only from the visible filtered entries it receives', () => {
    expect(analyzeSystemTrace).toBeTypeOf('function');
    if (!analyzeSystemTrace) return;

    const allEntries: Entry[] = [
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.000Z',
        url: 'https://api.example.com/hidden-error',
        status: 503,
        time: 2600,
      }),
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.200Z',
        url: 'https://portal.example.com/',
        mimeType: 'text/html',
      }),
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.420Z',
        url: 'https://api.example.com/users',
        initiatorUrl: 'https://portal.example.com/',
        time: 900,
      }),
    ];

    const trace = analyzeSystemTrace(allEntries.slice(1));

    expect(trace.summary.selectionMode).toBe('slow');
    expect(trace.summary.terminalStatus).toBe(200);
    expect(trace.nodes.every((node) => node.status < 400)).toBe(true);
  });
});

describe('RequestFlowTraceView', () => {
  it('renders the shared empty state when there are no entries', () => {
    expect(RequestFlowTraceView).toBeTruthy();
    if (!RequestFlowTraceView) return;

    render(<RequestFlowTraceView entries={[]} onNodeClick={vi.fn()} />);

    expect(screen.getByText(/no requests to display/i)).toBeInTheDocument();
    expect(screen.queryByTestId('react-flow-mock')).not.toBeInTheDocument();
  });

  it('renders the inferred trace canvas and forwards node clicks back to the analyzer', async () => {
    expect(RequestFlowTraceView).toBeTruthy();
    if (!RequestFlowTraceView) return;

    const user = userEvent.setup();
    const entries: Entry[] = [
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.000Z',
        url: 'https://portal.example.com/',
        mimeType: 'text/html',
      }),
      createEntry({
        startedDateTime: '2026-04-21T10:30:00.220Z',
        url: 'https://api.example.com/orders',
        status: 504,
        initiatorUrl: 'https://portal.example.com/',
        time: 1900,
      }),
    ];
    const handleNodeClick = vi.fn();

    render(<RequestFlowTraceView entries={entries} onNodeClick={handleNodeClick} />);

    expect(screen.getByTestId('react-flow-mock')).toBeInTheDocument();
    expect(screen.getByTestId('react-flow-controls')).toBeInTheDocument();
    expect(screen.getByText(/inferred from har request relationships/i)).toBeInTheDocument();
    expect(screen.getByText(/system trace summary/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-trace-role'))).toEqual([
      'root',
      'terminal',
    ]);

    await user.click(screen.getAllByRole('button', { name: /open in analyzer/i })[0]);

    expect(handleNodeClick).toHaveBeenCalledTimes(1);
    expect(handleNodeClick).toHaveBeenCalledWith(entries[0]);
  });
});
