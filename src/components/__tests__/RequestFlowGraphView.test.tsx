import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RequestFlowGraphView from '../RequestFlowGraphView';
import { Entry } from '../../types/har';

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
              data-node-draggable={node.draggable === undefined ? 'unset' : String(node.draggable)}
              data-node-critical={String(Boolean(node.data?.isCritical))}
              data-node-dimmed={String(Boolean(node.data?.isDimmed))}
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

const makeEntry = (overrides: Partial<Entry> = {}): Entry => ({
  startedDateTime: '2026-04-21T10:30:00.000Z',
  time: 320,
  request: {
    method: 'GET',
    url: 'https://portal.example.com/',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [],
    queryString: [],
    headersSize: 120,
    bodySize: 0,
  },
  response: {
    status: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [],
    content: {
      size: 2048,
      mimeType: 'text/html',
    },
    redirectURL: '',
    headersSize: 140,
    bodySize: 2048,
  },
  cache: {},
  timings: {
    blocked: 10,
    dns: 20,
    connect: 30,
    ssl: 0,
    send: 15,
    wait: 200,
    receive: 45,
  },
  ...overrides,
});

describe('RequestFlowGraphView', () => {
  it('renders the shared empty state when there are no entries', () => {
    render(<RequestFlowGraphView entries={[]} onNodeClick={vi.fn()} />);

    expect(screen.getByText(/no requests to display/i)).toBeInTheDocument();
    expect(screen.queryByTestId('react-flow-mock')).not.toBeInTheDocument();
  });

  it('renders the simple scattered flow chrome and mixed node states', () => {
    const entries: Entry[] = [
      makeEntry({
        startedDateTime: '2026-04-21T10:30:00.000Z',
        request: { ...makeEntry().request, url: 'https://portal.example.com/' },
        response: {
          ...makeEntry().response,
          status: 200,
          content: { size: 2048, mimeType: 'text/html' },
        },
      }),
      makeEntry({
        startedDateTime: '2026-04-21T10:30:01.000Z',
        request: { ...makeEntry().request, url: 'https://static.examplecdn.com/app.js' },
        response: {
          ...makeEntry().response,
          status: 503,
          statusText: 'Service Unavailable',
          content: { size: 512, mimeType: 'application/javascript' },
        },
        time: 5200,
        timings: {
          blocked: 20,
          dns: 40,
          connect: 60,
          ssl: 0,
          send: 15,
          wait: 4800,
          receive: 265,
        },
      }),
    ];

    render(<RequestFlowGraphView entries={entries} onNodeClick={vi.fn()} />);

    expect(screen.getByTestId('react-flow-mock')).toBeInTheDocument();
    expect(screen.getByTestId('react-flow-mock')).toHaveAttribute('data-nodes-draggable', 'true');
    expect(screen.getByTestId('react-flow-mock')).toHaveAttribute('data-has-on-nodes-change', 'true');
    expect(screen.getByTestId('react-flow-mock')).toHaveAttribute('data-has-on-edges-change', 'true');
    expect(screen.getByTestId('react-flow-controls')).toBeInTheDocument();
    expect(screen.getByTestId('react-flow-minimap')).toBeInTheDocument();
    expect(screen.getByTestId('react-flow-panel-top-left')).toBeInTheDocument();
    expect(screen.getByTestId('react-flow-panel-top-right')).toBeInTheDocument();
    expect(screen.getByText('Legend')).toBeInTheDocument();
    expect(screen.getByText('Request Flow Summary')).toBeInTheDocument();
    expect(screen.getByText(/total requests:/i)).toBeInTheDocument();
    expect(screen.getByText(/failed:/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-type'))).toEqual([
      'request',
      'requestError',
    ]);
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-draggable'))).toEqual([
      'true',
      'true',
    ]);
    expect(screen.getAllByTestId('react-flow-edge').map((edge) => edge.getAttribute('data-edge-type'))).toEqual([
      'default',
    ]);
    expect(screen.getAllByRole('button', { name: /open in analyzer/i })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /app\.js 503/i })).toBeInTheDocument();
  });

  it('forwards node selection back to the analyzer callback', async () => {
    const user = userEvent.setup();
    const entries: Entry[] = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://portal.example.com/dashboard' },
      }),
    ];
    const handleNodeClick = vi.fn();

    render(<RequestFlowGraphView entries={entries} onNodeClick={handleNodeClick} />);

    await user.click(screen.getByRole('button', { name: /open in analyzer/i }));

    expect(handleNodeClick).toHaveBeenCalledTimes(1);
    expect(handleNodeClick).toHaveBeenCalledWith(entries[0]);
  });

  it('adds a checkbox to highlight the critical path', async () => {
    const user = userEvent.setup();
    const entries: Entry[] = [
      makeEntry({
        startedDateTime: '2026-04-21T10:30:00.000Z',
        request: { ...makeEntry().request, url: 'https://portal.example.com/' },
        response: {
          ...makeEntry().response,
          status: 200,
          content: { size: 2048, mimeType: 'text/html' },
        },
      }),
      makeEntry({
        startedDateTime: '2026-04-21T10:30:01.000Z',
        request: { ...makeEntry().request, url: 'https://static.examplecdn.com/app.js' },
        response: {
          ...makeEntry().response,
          status: 200,
          content: { size: 512, mimeType: 'application/javascript' },
        },
      }),
      makeEntry({
        startedDateTime: '2026-04-21T10:30:02.000Z',
        request: { ...makeEntry().request, url: 'https://cdn.example.com/hero.png' },
        response: {
          ...makeEntry().response,
          status: 200,
          content: { size: 1024, mimeType: 'image/png' },
        },
      }),
    ];

    render(<RequestFlowGraphView entries={entries} onNodeClick={vi.fn()} />);

    const checkbox = screen.getByRole('checkbox', { name: /highlight critical path/i });
    expect(checkbox).not.toBeChecked();
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-critical'))).toEqual([
      'false',
      'false',
      'false',
    ]);

    await user.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-critical'))).toEqual([
      'true',
      'true',
      'false',
    ]);
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-dimmed'))).toEqual([
      'false',
      'false',
      'true',
    ]);
  });
});
