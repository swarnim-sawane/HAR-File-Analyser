import React from 'react';
import { readFileSync } from 'node:fs';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HarTabContent from '../HarTabContent';

const globalsCss = readFileSync('src/styles/globals.css', 'utf8');

const { getHarDataMock, mockHarState, requestListMock, requestDetailsMock, requestFlowDiagramMock, requestFlowGraphViewMock } = vi.hoisted(() => {
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
    requestListMock: vi.fn(),
    requestDetailsMock: vi.fn(),
    requestFlowDiagramMock: vi.fn(),
    requestFlowGraphViewMock: vi.fn(),
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
        timingType: 'relative' as const,
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
  default: (props: any) => {
    requestDetailsMock(props);
    return <div>Request details mock</div>;
  },
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
    mockHarState.selectedEntry = null;
    mockHarState.loadHarData.mockClear();
    mockHarState.setSelectedEntry.mockClear();
    requestListMock.mockClear();
    requestDetailsMock.mockClear();
    requestFlowDiagramMock.mockClear();
    requestFlowGraphViewMock.mockClear();
  });

  it('renders the HAR analyzer shell in Redwood mode', async () => {
    render(
      <HarTabContent
        tabId="tab-1"
        fileId="file-1"
        fileName="session.har"
        isActive
        backendUrl="http://localhost:4000"
      />
    );

    expect(document.documentElement.dataset.theme).toBe('redwood');
    expect(screen.getByRole('button', { name: /analyzer/i })).toBeInTheDocument();
    expect(screen.getByText('Filter panel mock')).toBeInTheDocument();
    expect(screen.getByText('Request list mock')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ai assistant/i })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(getHarDataMock).toHaveBeenCalledWith('file-1');
      expect(mockHarState.loadHarData).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockHarState.setSelectedEntry).toHaveBeenCalledWith(mockHarState.harData.log.entries[1]);
    });

    expect(requestListMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        focusEntry: mockHarState.harData.log.entries[1],
        focusPath: expect.objectContaining({
          anchorIndex: 1,
          confidence: 'high',
        }),
      })
    );
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
      />
    );

    await waitFor(() => {
      expect(getHarDataMock).toHaveBeenCalledWith('file-1');
      expect(mockHarState.loadHarData).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: /request flow/i }));

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

  it('keeps long HAR analysis surfaces in scrollable tab panels', async () => {
    const user = userEvent.setup();

    render(
      <HarTabContent
        tabId="tab-1"
        fileId="file-1"
        fileName="session.har"
        isActive
        backendUrl="http://localhost:4000"
      />
    );

    await waitFor(() => {
      expect(getHarDataMock).toHaveBeenCalledWith('file-1');
      expect(mockHarState.loadHarData).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: /request flow/i }));
    expect(screen.getByText('Scattered view mock').closest('.flow-tab-panel')).toHaveClass('har-tab-scroll-panel');

    await user.click(screen.getByRole('button', { name: /scorecard/i }));
    expect(screen.getByText('Scorecard mock').closest('.har-tab-scroll-panel')).toHaveClass('scorecard-wrapper');

    await user.click(screen.getByRole('button', { name: /ai insights/i }));
    expect(screen.getByText('AI insights mock').closest('.har-tab-scroll-panel')).toHaveClass('har-insights-scroll-panel');

    expect(globalsCss).toMatch(/\.har-tab-scroll-panel\s*\{[\s\S]*overflow-y:\s*auto/);
    expect(globalsCss).toMatch(/\.har-tab-scroll-panel\s*\{[\s\S]*min-height:\s*0/);
    expect(globalsCss).toMatch(/\.flow-tab-panel\s*\{[\s\S]*overflow-y:\s*auto/);
    expect(globalsCss).toMatch(/\.flow-tab-panel \.request-flow-shell\s*\{[\s\S]*height:\s*auto/);
    expect(globalsCss).toMatch(/\.flow-view-toggle-bar\s*\{[\s\S]*grid-template-columns:\s*minmax\(120px,\s*1fr\)\s*auto\s*minmax\(120px,\s*1fr\)/);
    expect(globalsCss).toMatch(/\.flow-view-toggle\s*\{[\s\S]*justify-self:\s*center/);
    expect(globalsCss).toMatch(/\.basic-file-analyzer\s*\{[\s\S]*overflow-y:\s*auto/);
    expect(globalsCss).toMatch(/\.basic-file-image-stage\s*\{[\s\S]*overflow:\s*visible/);
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
        issueFocusPath: expect.objectContaining({ anchorIndex: 1 }),
        issueFocusEnabled: true,
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
        issueFocusPath: expect.objectContaining({ anchorIndex: 1 }),
        issueFocusEnabled: true,
      })
    );
  });
});
