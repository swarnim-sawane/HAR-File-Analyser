import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConsoleLogTabContent from '../ConsoleLogTabContent';

const apiClientMocks = vi.hoisted(() => ({
  getLogStatus: vi.fn(),
  getLogEntries: vi.fn(),
  getLogEntry: vi.fn(),
  getLogStats: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    getLogStatus: apiClientMocks.getLogStatus,
    getLogEntries: apiClientMocks.getLogEntries,
    getLogEntry: apiClientMocks.getLogEntry,
    getLogStats: apiClientMocks.getLogStats,
  },
}));

vi.mock('../ConsoleLogFilterPanel', () => ({
  default: () => <div>Console filters mock</div>,
}));

vi.mock('../ConsoleLogStatistics', () => ({
  default: () => <div>Console statistics mock</div>,
}));

vi.mock('../ConsoleLogAiInsights', () => ({
  default: () => <div data-testid="console-ai-insights">Console AI insights mock</div>,
}));

describe('ConsoleLogTabContent', () => {
  beforeEach(() => {
    apiClientMocks.getLogStatus.mockReset();
    apiClientMocks.getLogEntries.mockReset();
    apiClientMocks.getLogEntry.mockReset();
    apiClientMocks.getLogStats.mockReset();

    apiClientMocks.getLogStatus.mockResolvedValue({
      fileId: 'file-1',
      fileName: 'console.log',
      status: 'ready',
      totalEntries: 1,
      uploadedAt: '2026-04-23T10:37:00.000Z',
    });

    apiClientMocks.getLogEntries.mockResolvedValue({
      entries: [
        {
          _id: 'db-entry-1',
          index: 0,
          timestamp: '2026-04-23T10:37:00.000Z',
          level: 'log',
          message:
            "webapp/:1 Access to fetch at 'https://api.example.com/ords/test' has been blocked by CORS policy.",
          source: 'webapp/',
          inferredSeverity: 'error',
          issueTags: ['cors', 'network'],
          primaryIssue: 'cors',
        },
      ],
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalEntries: 1,
        hasMore: false,
        limit: 200,
      },
      facets: {
        levelCounts: { error: 1 },
        issueTagCounts: { cors: 1, network: 1 },
        topSources: [{ source: 'webapp/', count: 1 }],
      },
    });

    apiClientMocks.getLogStats.mockResolvedValue({
      totalLogs: 1,
      levels: { error: 1 },
      sources: { 'webapp/': 1 },
      errors: 1,
      warnings: 0,
      infos: 0,
    });

    apiClientMocks.getLogEntry.mockResolvedValue({
      id: 'db-entry-1',
      index: 0,
      timestamp: '2026-04-23T10:37:00.000Z',
      level: 'log',
      message:
        "webapp/:1 Access to fetch at 'https://api.example.com/ords/test' has been blocked by CORS policy.",
      rawText: [
        "webapp/:1 Access to fetch at 'https://api.example.com/ords/test' has been blocked by CORS policy.",
        'TypeError: Failed to fetch',
      ].join('\n'),
      source: 'webapp/',
      inferredSeverity: 'error',
      issueTags: ['cors', 'network'],
      primaryIssue: 'cors',
    });
  });

  it('loads the full backend detail payload when a row is selected', async () => {
    const { container } = render(
      <ConsoleLogTabContent
        tabId="console-tab-1"
        fileId="file-1"
        fileName="console.log"
        initialData={null}
        isActive={true}
        backendUrl="http://localhost:4000"
      />,
    );

    const rowMessage = await screen.findByText(/blocked by cors policy/i);
    expect(container.querySelector('.request-list-header')).not.toBeNull();
    expect(apiClientMocks.getLogEntries).toHaveBeenCalledWith(
      'file-1',
      expect.objectContaining({
        limit: 200,
        sortBy: 'timestamp',
      }),
    );
    fireEvent.click(rowMessage.closest('.request-item') as HTMLElement);

    await waitFor(() => {
      expect(apiClientMocks.getLogEntry).toHaveBeenCalledWith('file-1', 0);
    });

    const rawEventTab = await screen.findByRole('tab', { name: /raw event/i });
    fireEvent.click(rawEventTab);

    expect(screen.getByText(/TypeError: Failed to fetch/i)).toBeInTheDocument();
  });

  it('uses the backend-paged query path for server processed logs', async () => {
    render(
      <ConsoleLogTabContent
        tabId="console-tab-1"
        fileId="file-1"
        fileName="console.log"
        initialData={null}
        isActive={true}
        backendUrl="http://localhost:4000"
      />,
    );

    await screen.findByText(/blocked by cors policy/i);

    expect(apiClientMocks.getLogEntries).toHaveBeenCalledWith(
      'file-1',
      expect.objectContaining({
        page: 1,
        limit: 200,
        sortBy: 'timestamp',
        sortDir: 'desc',
      }),
    );
    expect(screen.getByText(/matching full file/i)).toBeInTheDocument();
  });

  it('does not mount AI Insights while the analyzer tab is active', async () => {
    render(
      <ConsoleLogTabContent
        tabId="console-tab-1"
        fileId="file-1"
        fileName="console.log"
        initialData={null}
        isActive={true}
        backendUrl="http://localhost:4000"
      />,
    );

    await screen.findByText(/blocked by cors policy/i);
    expect(screen.queryByTestId('console-ai-insights')).not.toBeInTheDocument();
  });
});
