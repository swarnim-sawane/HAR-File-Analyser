import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RequestFlowGraphView from '../RequestFlowGraphView';
import { Entry, FilterOptions } from '../../types/har';
import type { RequestFlowFocusMode } from '../../types/requestFlow';
import type { RequestFlowFocusPath } from '../../utils/requestFlowFocus';

const { reactFlowFitViewMock } = vi.hoisted(() => ({
  reactFlowFitViewMock: vi.fn(),
}));

vi.mock('reactflow', async () => {
  const ReactModule = await import('react');

  return {
    __esModule: true,
    default: ({ nodes, edges, nodeTypes, children, nodesDraggable, onNodesChange, onEdgesChange, onInit }: any) => {
      ReactModule.useEffect(() => {
        onInit?.({ fitView: reactFlowFitViewMock });
      }, [onInit]);

      return (
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
                data-node-error-selected={String(Boolean(node.data?.isErrorJumpSelected))}
                data-node-focus-anchor={String(Boolean(node.data?.isFocusAnchor))}
                data-node-focus-path={String(Boolean(node.data?.isFocusPath))}
                data-node-focus-step={node.data?.focusStep ?? ''}
                data-node-start-here={String(Boolean(node.data?.isFocusAnchor))}
                data-node-focus-reason={node.data?.focusReason ?? ''}
                data-node-style-opacity={node.style?.opacity === undefined ? 'unset' : String(node.style.opacity)}
                data-node-style-z-index={node.style?.zIndex === undefined ? 'unset' : String(node.style.zIndex)}
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
              data-edge-focus-path={String(Boolean(edge.data?.isFocusPath))}
              data-edge-style-opacity={edge.style?.opacity === undefined ? 'unset' : String(edge.style.opacity)}
              data-edge-style-stroke-width={edge.style?.strokeWidth === undefined ? 'unset' : String(edge.style.strokeWidth)}
            />
          ))}
          {children}
        </div>
      );
    },
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

const defaultFilters: FilterOptions = {
  statusCodes: {
    '0': false,
    '1xx': false,
    '2xx': true,
    '3xx': true,
    '4xx': true,
    '5xx': true,
  },
  searchTerm: '',
  timingType: 'relative',
};

const makeFocusPath = (overrides: Partial<RequestFlowFocusPath> = {}): RequestFlowFocusPath => ({
  anchorIndex: 0,
  nodeIndexes: [0],
  edgeKeys: [],
  score: 36,
  severity: 'notice',
  confidence: 'low',
  reasons: ['http-4xx'],
  reasonLabels: ['HTTP 404'],
  nextInspection: 'general',
  summary: 'HTTP 404 on /logo.png',
  candidates: [],
  ...overrides,
});

function renderGraphView({
  entries,
  visibleEntries = entries,
  filters = defaultFilters,
  focusMode = 'all',
  onFiltersChange = vi.fn(),
  onFocusModeChange = vi.fn(),
  issueFocusPath,
  issueFocusEnabled,
  onIssueFocusEnabledChange,
  onNodeClick = vi.fn(),
}: {
  entries: Entry[];
  visibleEntries?: Entry[];
  filters?: FilterOptions;
  focusMode?: RequestFlowFocusMode;
  onFiltersChange?: (filters: Partial<FilterOptions>) => void;
  onFocusModeChange?: (mode: RequestFlowFocusMode) => void;
  issueFocusPath?: RequestFlowFocusPath | null;
  issueFocusEnabled?: boolean;
  onIssueFocusEnabledChange?: (enabled: boolean) => void;
  onNodeClick?: (entry: Entry) => void;
}) {
  return render(
    <RequestFlowGraphView
      entries={entries}
      visibleEntries={visibleEntries}
      filters={filters}
      focusMode={focusMode}
      onFiltersChange={onFiltersChange}
      onFocusModeChange={onFocusModeChange}
      issueFocusPath={issueFocusPath}
      issueFocusEnabled={issueFocusEnabled}
      onIssueFocusEnabledChange={onIssueFocusEnabledChange}
      onNodeClick={onNodeClick}
    />
  );
}

describe('RequestFlowGraphView', () => {
  beforeEach(() => {
    reactFlowFitViewMock.mockClear();
  });

  it('renders the shared empty state when there are no entries', () => {
    renderGraphView({ entries: [] });

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

    renderGraphView({ entries });

    expect(screen.getByTestId('react-flow-mock')).toBeInTheDocument();
    expect(screen.getByTestId('react-flow-mock')).toHaveAttribute('data-nodes-draggable', 'true');
    expect(screen.getByTestId('react-flow-mock')).toHaveAttribute('data-has-on-nodes-change', 'true');
    expect(screen.getByTestId('react-flow-mock')).toHaveAttribute('data-has-on-edges-change', 'true');
    expect(screen.getByTestId('react-flow-controls')).toBeInTheDocument();
    expect(screen.getByTestId('react-flow-minimap')).toBeInTheDocument();
    expect(screen.getByTestId('react-flow-panel-top-left')).toBeInTheDocument();
    expect(screen.queryByTestId('react-flow-panel-top-right')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/scattered view diagnostic controls/i)).toBeInTheDocument();
    expect(screen.queryByText('Legend')).not.toBeInTheDocument();
    expect(screen.queryByText('Request Flow Summary')).not.toBeInTheDocument();
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

  it('renders a compact diagnostic toolbar instead of separate legend and summary panels', () => {
    const entries: Entry[] = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://portal.example.com/' },
      }),
      makeEntry({
        startedDateTime: '2026-04-21T10:30:01.000Z',
        request: { ...makeEntry().request, url: 'https://portal.example.com/api/error' },
        response: { ...makeEntry().response, status: 500, statusText: 'Server Error' },
      }),
    ];

    renderGraphView({ entries });

    expect(screen.getByLabelText(/scattered view diagnostic controls/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /all/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /errors/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /slow/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /focus issue/i })).toBeInTheDocument();
    expect(screen.getByText(/shown/i)).toBeInTheDocument();
    expect(screen.queryByText('Legend')).not.toBeInTheDocument();
    expect(screen.queryByText('Request Flow Summary')).not.toBeInTheDocument();
  });

  it('lists failed requests as jump targets and focuses the selected error in the graph', async () => {
    const user = userEvent.setup();
    const handleNodeClick = vi.fn();
    const entries: Entry[] = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://portal.example.com/' },
        response: { ...makeEntry().response, status: 200 },
      }),
      makeEntry({
        startedDateTime: '2026-04-21T10:30:01.000Z',
        request: { ...makeEntry().request, url: 'https://portal.example.com/api/orders?debug=true' },
        response: { ...makeEntry().response, status: 500, statusText: 'Server Error' },
      }),
      makeEntry({
        startedDateTime: '2026-04-21T10:30:02.000Z',
        request: { ...makeEntry().request, url: 'https://cdn.example.com/missing-logo.png' },
        response: { ...makeEntry().response, status: 404, statusText: 'Not Found' },
      }),
    ];

    renderGraphView({ entries, onNodeClick: handleNodeClick });

    expect(screen.getByLabelText('Failed request jump list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open error 500 \/api\/orders/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open error 404 \/missing-logo\.png/i })).toBeInTheDocument();

    reactFlowFitViewMock.mockClear();
    await user.click(screen.getByRole('button', { name: /open error 500 \/api\/orders/i }));

    expect(handleNodeClick).not.toHaveBeenCalled();
    expect(reactFlowFitViewMock).toHaveBeenCalledWith({
      nodes: [{ id: 'request-1' }],
      padding: 0.62,
      maxZoom: 1.12,
      duration: 420,
    });
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-error-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
  });

  it('forwards node selection back to the analyzer callback', async () => {
    const user = userEvent.setup();
    const entries: Entry[] = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://portal.example.com/dashboard' },
      }),
    ];
    const handleNodeClick = vi.fn();

    renderGraphView({ entries, onNodeClick: handleNodeClick });

    await user.click(screen.getByRole('button', { name: /open in analyzer/i }));

    expect(handleNodeClick).toHaveBeenCalledTimes(1);
    expect(handleNodeClick).toHaveBeenCalledWith(entries[0]);
  });

  it('renders request details in node preview cards for scattered view hover access', async () => {
    const user = userEvent.setup();
    const entries: Entry[] = [
      makeEntry({
        request: {
          ...makeEntry().request,
          method: 'POST',
          url: 'https://portal.example.com/api/orders?id=42',
          bodySize: 348,
        },
        response: {
          ...makeEntry().response,
          status: 404,
          statusText: 'Not Found',
          bodySize: 0,
          content: { size: 0, mimeType: 'application/json' },
        },
        time: 379,
        timings: {
          blocked: 1,
          dns: 2,
          connect: 4,
          ssl: 0,
          send: 5,
          wait: 340,
          receive: 27,
        },
      }),
    ];

    renderGraphView({ entries });

    const preview = screen.getByRole('tooltip', {
      name: /POST \/api\/orders\?id=42 404 request preview/i,
    });

    expect(preview).toHaveTextContent('Request preview');
    expect(preview).toHaveTextContent('POST 404');
    expect(preview).toHaveTextContent('/api/orders?id=42');
    expect(preview).toHaveTextContent('portal.example.com');
    expect(preview).toHaveTextContent('404 Not Found');
    expect(preview).toHaveTextContent('379ms');
    expect(preview).toHaveTextContent('0 B');
    expect(preview).toHaveTextContent('application/json');
    expect(preview).toHaveTextContent('Wait 340ms');
    expect(preview).toHaveTextContent('Receive 27ms');
    expect(preview).toHaveTextContent('Missing response body');

    const requestNode = screen.getByRole('button', { name: /open in analyzer post/i });
    expect(screen.getByTestId('react-flow-node')).toHaveAttribute('data-node-style-z-index', '3');

    await user.hover(requestNode);

    expect(screen.getByTestId('react-flow-node')).toHaveAttribute('data-node-style-z-index', '1000');
  });

  it('auto-focuses the likely issue path and can restore the normal graph', async () => {
    const user = userEvent.setup();
    const entries: Entry[] = [
      makeEntry({
        startedDateTime: '2026-04-21T10:30:00.000Z',
        request: { ...makeEntry().request, url: 'https://portal.example.com/dashboard' },
        response: {
          ...makeEntry().response,
          status: 200,
          content: { size: 2048, mimeType: 'text/html' },
        },
      }),
      makeEntry({
        startedDateTime: '2026-04-21T10:30:01.000Z',
        request: { ...makeEntry().request, url: 'https://portal.example.com/api/checkout' },
        response: {
          ...makeEntry().response,
          status: 503,
          statusText: 'Service Unavailable',
          content: { size: 512, mimeType: 'application/json' },
        },
        time: 5200,
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

    renderGraphView({ entries });

    const checkbox = screen.getByRole('checkbox', { name: /focus issue/i });
    expect(checkbox).toBeChecked();
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-focus-path'))).toEqual([
      'true',
      'true',
      'false',
    ]);
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-focus-anchor'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-dimmed'))).toEqual([
      'false',
      'false',
      'true',
    ]);

    await user.click(checkbox);

    expect(checkbox).not.toBeChecked();
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-dimmed'))).toEqual([
      'false',
      'false',
      'false',
    ]);
  });

  it('does not dim healthy graphs when no likely issue exists', () => {
    const entries = [
      makeEntry({ time: 120 }),
      makeEntry({ startedDateTime: '2026-04-21T10:30:01.000Z', time: 180 }),
    ];

    renderGraphView({ entries });

    const checkbox = screen.getByRole('checkbox', { name: /focus issue/i });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-dimmed'))).toEqual([
      'false',
      'false',
    ]);
  });

  it('uses shared low-confidence focus wording and controlled focus toggle', async () => {
    const user = userEvent.setup();
    const handleIssueFocusChange = vi.fn();
    const entries: Entry[] = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://cdn.example.com/logo.png' },
        response: {
          ...makeEntry().response,
          status: 404,
          statusText: 'Not Found',
          content: { size: 0, mimeType: 'image/png' },
        },
      }),
    ];

    renderGraphView({
      entries,
      issueFocusPath: makeFocusPath(),
      issueFocusEnabled: true,
      onIssueFocusEnabledChange: handleIssueFocusChange,
    });

    expect(screen.getByText('Worth checking')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /focus issue/i }));

    expect(handleIssueFocusChange).toHaveBeenCalledWith(false);
  });

  it('marks the diagnostic path with ordered start metadata and focus reason', () => {
    const entries: Entry[] = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://portal.example.com/' },
      }),
      makeEntry({
        startedDateTime: '2026-04-21T10:30:01.000Z',
        request: { ...makeEntry().request, url: 'https://portal.example.com/api/error' },
        response: { ...makeEntry().response, status: 500, statusText: 'Server Error' },
      }),
      makeEntry({
        startedDateTime: '2026-04-21T10:30:02.000Z',
        request: { ...makeEntry().request, url: 'https://cdn.example.com/app.css' },
      }),
    ];

    renderGraphView({
      entries,
      issueFocusPath: makeFocusPath({
        nodeIndexes: [0, 1],
        anchorIndex: 1,
        reasonLabels: ['HTTP 500', 'Failed after redirect'],
      }),
      issueFocusEnabled: true,
    });

    const nodes = screen.getAllByTestId('react-flow-node');

    expect(nodes.map((node) => node.getAttribute('data-node-focus-step'))).toEqual(['2', '1', '']);
    expect(nodes.map((node) => node.getAttribute('data-node-start-here'))).toEqual(['false', 'true', 'false']);
    expect(nodes[1]).toHaveAttribute('data-node-focus-reason', 'HTTP 500');
    expect(screen.getByText('Start here')).toBeInTheDocument();
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
  });

  it('keeps analyzer-filtered requests in the scattered graph and dims nonmatching nodes', () => {
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
        request: { ...makeEntry().request, url: 'https://portal.example.com/api/error' },
        response: {
          ...makeEntry().response,
          status: 404,
          statusText: 'Not Found',
          content: { size: 128, mimeType: 'application/json' },
        },
      }),
    ];

    renderGraphView({
      entries,
      visibleEntries: [entries[1]],
      filters: {
        ...defaultFilters,
        statusCodes: {
          '0': false,
          '1xx': false,
          '2xx': false,
          '3xx': false,
          '4xx': true,
          '5xx': false,
        },
      },
    });

    expect(screen.getAllByTestId('react-flow-node')).toHaveLength(2);
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-dimmed'))).toEqual([
      'true',
      'false',
    ]);
    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-style-opacity'))).toEqual([
      'unset',
      'unset',
    ]);
    expect(screen.getAllByRole('button', { name: /open in analyzer/i })[0]).toHaveStyle({
      opacity: '0.54',
      filter: 'grayscale(0.72) saturate(0.48)',
    });
    expect(screen.getAllByTestId('react-flow-edge').map((edge) => edge.getAttribute('data-edge-style-opacity'))).toEqual([
      '0.38',
    ]);
  });

  it('uses flow focus chips to dim nonmatching requests without changing analyzer filters', async () => {
    const user = userEvent.setup();
    const onFocusModeChange = vi.fn();
    const onFiltersChange = vi.fn();
    const entries: Entry[] = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://portal.example.com/' },
        response: { ...makeEntry().response, status: 200 },
      }),
      makeEntry({
        request: { ...makeEntry().request, url: 'https://portal.example.com/api/error' },
        response: { ...makeEntry().response, status: 500, statusText: 'Server Error' },
      }),
    ];

    renderGraphView({
      entries,
      focusMode: 'errors',
      onFocusModeChange,
      onFiltersChange,
    });

    expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-dimmed'))).toEqual([
      'true',
      'false',
    ]);

    await user.click(screen.getByRole('button', { name: /slow/i }));

    expect(onFocusModeChange).toHaveBeenCalledWith('slow');
    expect(onFiltersChange).not.toHaveBeenCalled();
  });
});
