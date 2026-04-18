import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import HarTabContent from '../HarTabContent';

const { getHarDataMock, mockHarState } = vi.hoisted(() => {
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
      ],
    },
  };

  return {
    getHarDataMock: vi.fn().mockResolvedValue(sampleHarFile),
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
  default: () => <div>Request list mock</div>,
}));

vi.mock('../RequestDetails', () => ({
  default: () => <div>Request details mock</div>,
}));

vi.mock('../Toolbar', () => ({
  default: () => <div>Toolbar mock</div>,
}));

vi.mock('../FloatingAiChat', () => ({
  default: () => <div>Floating AI chat mock</div>,
}));

vi.mock('../RequestFlowDiagram', () => ({
  default: () => <div>Request flow mock</div>,
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
    mockHarState.loadHarData.mockClear();
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
    expect(screen.getByText('Toolbar mock')).toBeInTheDocument();
    expect(screen.getByText('Filter panel mock')).toBeInTheDocument();
    expect(screen.getByText('Request list mock')).toBeInTheDocument();
    expect(screen.getByText('Floating AI chat mock')).toBeInTheDocument();

    await waitFor(() => {
      expect(getHarDataMock).toHaveBeenCalledWith('file-1');
      expect(mockHarState.loadHarData).toHaveBeenCalled();
    });
  });
});
