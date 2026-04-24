import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConsoleLogTabContent from '../ConsoleLogTabContent';

const apiClientMocks = vi.hoisted(() => ({
  getLogStatus: vi.fn(),
  getLogEntries: vi.fn(),
  getLogEntry: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    getLogStatus: apiClientMocks.getLogStatus,
    getLogEntries: apiClientMocks.getLogEntries,
    getLogEntry: apiClientMocks.getLogEntry,
  },
}));

vi.mock('../ConsoleLogFilterPanel', () => ({
  default: () => <div>Console filters mock</div>,
}));

vi.mock('../ConsoleLogStatistics', () => ({
  default: () => <div>Console statistics mock</div>,
}));

vi.mock('../ConsoleLogAiInsights', () => ({
  default: () => <div>Console AI insights mock</div>,
}));

vi.mock('../Toolbar', () => ({
  default: () => <div>Console toolbar mock</div>,
}));

vi.mock('../FloatingAiChat', () => ({
  default: () => null,
}));

describe('ConsoleLogTabContent', () => {
  beforeEach(() => {
    apiClientMocks.getLogStatus.mockReset();
    apiClientMocks.getLogEntries.mockReset();
    apiClientMocks.getLogEntry.mockReset();

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
        limit: 1000,
      },
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
    const user = userEvent.setup();

    const { container } = render(
      <ConsoleLogTabContent
        tabId="console-tab-1"
        fileId="file-1"
        fileName="console.log"
        initialData={null}
        isActive={true}
        backendUrl="http://localhost:4000"
        recentFiles={[]}
        onAddNewTab={vi.fn()}
        onLoadRecentNewTab={vi.fn()}
        onClearRecent={vi.fn()}
      />,
    );

    const rowMessage = await screen.findByText(/blocked by cors policy/i);
    expect(container.querySelector('.request-list-header')).not.toBeNull();
    await user.click(rowMessage);

    await waitFor(() => {
      expect(apiClientMocks.getLogEntry).toHaveBeenCalledWith('file-1', 0);
    });

    const rawEventTab = await screen.findByRole('tab', { name: /raw event/i });
    await user.click(rawEventTab);

    expect(screen.getByText(/TypeError: Failed to fetch/i)).toBeInTheDocument();
  });
});
