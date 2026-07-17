import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HarTabContent from '../HarTabContent';

const { getHarDataMock, mockHarState, requestFlowDiagramMock, requestFlowGraphViewMock, requestListMock } = vi.hoisted(() => {
  const sampleHarFile = {
    log: {
      version: '1.2',
      creator: { name: 'TestBrowser', version: '1.0' },
      entries: [
        {
          startedDateTime: '2024-01-15T10:30:00.000Z',
          time: 250,
          request: {
            method: 'GET',
            url: 'https://example.com/api/data',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: [{ name: 'Accept', value: 'application/json' }],
            queryString: [],
            headersSize: 40,
            bodySize: 0,
          },
          response: {
            status: 200,
            statusText: 'OK',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            content: { size: 1024, mimeType: 'application/json', text: '{"data":"value"}' },
            redirectURL: '',
            headersSize: 60,
            bodySize: 1024,
          },
          cache: {},
          timings: {
            blocked: 10,
            dns: 20,
            connect: 30,
            ssl: 0,
            send: 5,
            wait: 170,
            receive: 15,
          },
        },
        {
          startedDateTime: '2024-01-15T10:30:01.000Z',
          time: 125,
          request: {
            method: 'GET',
            url: 'https://idcs.example.com/favicon.ico',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: [{ name: 'Accept', value: 'image/x-icon' }],
            queryString: [],
            headersSize: 40,
            bodySize: 0,
          },
          response: {
            status: 401,
            statusText: 'Unauthorized',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: [{ name: 'Content-Type', value: 'image/x-icon' }],
            content: { size: 546, mimeType: 'image/x-icon' },
            redirectURL: '',
            headersSize: 60,
            bodySize: 546,
          },
          cache: {},
          timings: {
            blocked: 5,
            dns: 8,
            connect: 12,
            ssl: 0,
            send: 3,
            wait: 80,
            receive: 17,
          },
        },
      ],
    },
  };

  return {
    getHarDataMock: vi.fn().mockResolvedValue(sampleHarFile),
    requestFlowDiagramMock: vi.fn(),
    requestFlowGraphViewMock: vi.fn(),
    requestListMock: vi.fn(),
    mockHarState: {
      harData: sampleHarFile,
      filteredEntries: sampleHarFile.log.entries,
      selectedEntry: null,
      filters: {
        statusCodes: {
          '0': false,
          '1xx': false,
          '2xx': true,
          '3xx': true,
          '4xx': true,
          '5xx': true,
        },
        searchTerm: '',
      },
      isLoading: false,
      error: null,
      loadHarFile: vi.fn(),
      loadHarData: vi.fn(),
      setSelectedEntry: vi.fn(),
      updateFilters: vi.fn(),
      clearData: vi.fn(),
      exportFilteredData: vi.fn(),
    },
  };
});

vi.mock('../../hooks/useHarData', () => ({
  useHarData: () => mockHarState,
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    getHarData: getHarDataMock,
  },
}));

vi.mock('../FilterPanel', () => ({
  default: () => <div>Filter panel mock</div>,
}));

vi.mock('../RequestList', () => ({
  default: (props: any) => {
    requestListMock(props);
    return <div>Request list mock</div>;
  },
}));

vi.mock('../RequestDetails', () => ({
  default: () => <div>Request details mock</div>,
}));

vi.mock('../FloatingAiChat', () => ({
  default: () => <div>Floating AI chat mock</div>,
}));

vi.mock('../RequestFlowDiagram', () => ({
  default: (props: any) => {
    requestFlowDiagramMock(props);
    return <div>Journey map mock</div>;
  },
}));

vi.mock('../RequestFlowGraphView', () => ({
  default: (props: any) => {
    requestFlowGraphViewMock(props);
    return <div>Scattered view mock</div>;
  },
}));

vi.mock('../RequestFlowTraceView', () => ({
  default: () => <div>System trace mock</div>,
}));

vi.mock('../PerformanceScorecard', () => ({
  default: () => <div>Scorecard mock</div>,
}));

vi.mock('../AiInsights', () => ({
  default: () => <div>AI insights mock</div>,
}));

describe('HarTabContent Redwood theme smoke test', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'redwood';
    document.documentElement.style.colorScheme = 'light';
    window.localStorage.setItem('theme', 'redwood');
    getHarDataMock.mockClear();
    mockHarState.filteredEntries = mockHarState.harData.log.entries;
    mockHarState.filters = {
      statusCodes: {
        '0': false,
        '1xx': false,
        '2xx': true,
        '3xx': true,
        '4xx': true,
        '5xx': true,
      },
      searchTerm: '',
    };
    mockHarState.loadHarData.mockClear();
    requestFlowDiagramMock.mockClear();
    requestFlowGraphViewMock.mockClear();
    requestListMock.mockClear();
    mockHarState.setSelectedEntry.mockClear();
    mockHarState.updateFilters.mockClear();
  });

  it('renders the HAR analyzer shell in Redwood mode', async () => {
    render(
      <HarTabContent
        tabId="tab-1"
        fileId="file-1"
        fileName="session.har"
        isActive
        backendUrl="http://localhost:4000"
        recentFiles={[]}
        onAddNewTab={vi.fn()}
        onLoadRecentNewTab={vi.fn()}
        onClearRecent={vi.fn()}
      />
    );

    expect(document.documentElement.dataset.theme).toBe('redwood');
    expect(screen.getByRole('button', { name: /analyzer/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
    expect(screen.getByText('Filter panel mock')).toBeInTheDocument();
    expect(screen.getByText('Request list mock')).toBeInTheDocument();
    expect(screen.getByText('Floating AI chat mock')).toBeInTheDocument();

    await waitFor(() => {
      expect(getHarDataMock).toHaveBeenCalledWith('file-1');
      expect(mockHarState.loadHarData).toHaveBeenCalled();
    });
  });

  it('renders a request flow view toggle with journey and scattered views', async () => {
    const user = userEvent.setup();

    render(
      <HarTabContent
        tabId="tab-1"
        fileId="file-1"
        fileName="session.har"
        isActive
        backendUrl="http://localhost:4000"
        recentFiles={[]}
        onAddNewTab={vi.fn()}
        onLoadRecentNewTab={vi.fn()}
        onClearRecent={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getHarDataMock).toHaveBeenCalledWith('file-1');
      expect(mockHarState.loadHarData).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: /request flow/i }));

    expect(document.querySelector('.har-tab-content')).toHaveClass('is-active', 'is-flow-active');

    const flowToggle = screen.getByRole('radiogroup', { name: /request flow view/i });
    expect(flowToggle).toBeInTheDocument();

    const journeyMapToggle = screen.getByRole('radio', { name: /journey map/i });
    const nodeGraphToggle = screen.getByRole('radio', { name: /scattered view/i });

    expect(journeyMapToggle).toHaveAttribute('aria-checked', 'false');
    expect(nodeGraphToggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Scattered view mock')).toBeInTheDocument();
    expect(screen.queryByText('Journey map mock')).not.toBeInTheDocument();

    await user.click(journeyMapToggle);

    expect(journeyMapToggle).toHaveAttribute('aria-checked', 'true');
    expect(nodeGraphToggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Journey map mock')).toBeInTheDocument();
    expect(screen.queryByText('Scattered view mock')).not.toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('redwood');
  });

  it('passes full HAR entries to the journey map while preserving the analyzer-filtered visible subset', async () => {
    const user = userEvent.setup();
    const allEntries = mockHarState.harData.log.entries;
    mockHarState.filteredEntries = [allEntries[1]];

    render(
      <HarTabContent
        tabId="tab-1"
        fileId="file-1"
        fileName="session.har"
        isActive
        backendUrl="http://localhost:4000"
        recentFiles={[]}
        onAddNewTab={vi.fn()}
        onLoadRecentNewTab={vi.fn()}
        onClearRecent={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getHarDataMock).toHaveBeenCalledWith('file-1');
      expect(mockHarState.loadHarData).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: /request flow/i }));
    await user.click(screen.getByRole('radio', { name: /journey map/i }));

    expect(requestFlowDiagramMock).toHaveBeenCalled();
    expect(requestFlowDiagramMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entries: allEntries,
        visibleEntries: [allEntries[1]],
        filters: mockHarState.filters,
        onFiltersChange: mockHarState.updateFilters,
        focusMode: 'all',
      })
    );
  });

  it('passes full HAR entries and shared filters to the scattered view while preserving the analyzer-filtered visible subset', async () => {
    const user = userEvent.setup();
    const allEntries = mockHarState.harData.log.entries;
    mockHarState.filteredEntries = [allEntries[1]];

    render(
      <HarTabContent
        tabId="tab-1"
        fileId="file-1"
        fileName="session.har"
        isActive
        backendUrl="http://localhost:4000"
        recentFiles={[]}
        onAddNewTab={vi.fn()}
        onLoadRecentNewTab={vi.fn()}
        onClearRecent={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getHarDataMock).toHaveBeenCalledWith('file-1');
      expect(mockHarState.loadHarData).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: /request flow/i }));

    expect(requestFlowGraphViewMock).toHaveBeenCalled();
    expect(requestFlowGraphViewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entries: allEntries,
        visibleEntries: [allEntries[1]],
        filters: mockHarState.filters,
        onFiltersChange: mockHarState.updateFilters,
        focusMode: 'all',
      })
    );
  });

  it('redirects Request Flow node clicks back to Analyzer and requests selected-row scrolling', async () => {
    const user = userEvent.setup();
    const allEntries = mockHarState.harData.log.entries;
    mockHarState.filters = {
      ...mockHarState.filters,
      searchTerm: 'currently-hiding-the-clicked-row',
      statusCodes: {
        ...mockHarState.filters.statusCodes,
        '4xx': false,
      },
    };

    render(
      <HarTabContent
        tabId="tab-1"
        fileId="file-1"
        fileName="session.har"
        isActive
        backendUrl="http://localhost:4000"
        recentFiles={[]}
        onAddNewTab={vi.fn()}
        onLoadRecentNewTab={vi.fn()}
        onClearRecent={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getHarDataMock).toHaveBeenCalledWith('file-1');
      expect(mockHarState.loadHarData).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: /request flow/i }));
    const flowProps = requestFlowGraphViewMock.mock.calls.at(-1)?.[0];
    expect(flowProps).toBeTruthy();

    act(() => {
      flowProps.onNodeClick(allEntries[1]);
    });

    await waitFor(() => {
      expect(screen.getByText('Request list mock')).toBeInTheDocument();
    });

    expect(mockHarState.setSelectedEntry).toHaveBeenCalledWith(allEntries[1]);
    expect(mockHarState.updateFilters).toHaveBeenCalledWith(
      expect.objectContaining({
        searchTerm: '',
        statusCodes: expect.objectContaining({ '4xx': true }),
      })
    );

    await waitFor(() => {
      expect(requestListMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scrollToSelectedSignal: expect.any(Number),
        })
      );
    });
  });
});
