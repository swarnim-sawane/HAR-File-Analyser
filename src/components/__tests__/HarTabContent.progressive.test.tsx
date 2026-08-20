import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import HarTabContent from '../HarTabContent';
import { clearHarDataCache } from '../../services/harDataCache';
import type { HarPreviewSnapshot } from '../../services/progressiveHarPreview';
import type { HarFile } from '../../types/har';

const mocks = vi.hoisted(() => ({
  getHarData: vi.fn(),
  getHarStatus: vi.fn(),
  requestList: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: { getHarData: mocks.getHarData, getHarStatus: mocks.getHarStatus },
}));

vi.mock('../FilterPanel', () => ({ default: () => <div>Authoritative filters</div> }));
vi.mock('../RequestList', () => ({
  default: (props: any) => {
    mocks.requestList(props);
    return <div>Authoritative request list</div>;
  },
}));
vi.mock('../RequestDetails', () => ({ default: () => <div>Request details</div> }));
vi.mock('../FloatingAiChat', () => ({ default: () => <div>AI chat</div> }));
vi.mock('../RequestFlowDiagram', () => ({ default: () => <div>Journey map</div> }));
vi.mock('../RequestFlowGraphView', () => ({ default: () => <div>Graph view</div> }));
vi.mock('../RequestFlowTraceView', () => ({ default: () => <div>Trace view</div> }));
vi.mock('../PerformanceScorecard', () => ({ default: () => <div>Scorecard</div> }));
vi.mock('../AiInsights', () => ({ default: () => <div>Insights</div> }));

const preview: HarPreviewSnapshot = {
  previewId: 'preview-1',
  fileName: 'capture.har',
  fileSize: 4096,
  phase: 'processing',
  revision: 3,
  requests: [{
    id: 'preview-request-0',
    index: 0,
    startedDateTime: '2026-08-19T10:00:00.000Z',
    method: 'GET',
    url: 'https://example.com/orders',
    status: 200,
    statusText: 'OK',
    durationMs: 24,
    encodedBytes: 128,
  }],
  totalParsed: 1,
  skippedOversizedEntries: 0,
  isTruncated: false,
  maxRequests: 250,
};

const authoritativeHar: HarFile = {
  log: {
    version: '1.2',
    creator: { name: 'Browser', version: '1' },
    entries: [{
      startedDateTime: '2026-08-19T10:00:00.000Z',
      time: 120,
      request: {
        method: 'GET', url: 'https://example.com/orders?real=1', httpVersion: 'HTTP/2',
        cookies: [], headers: [], queryString: [{ name: 'real', value: '1' }], headersSize: 0, bodySize: 0,
      },
      response: {
        status: 500, statusText: 'Server Error', httpVersion: 'HTTP/2', cookies: [], headers: [],
        content: { size: 32, mimeType: 'application/json' }, redirectURL: '', headersSize: 0, bodySize: 32,
      },
      cache: {},
      timings: { send: 1, wait: 118, receive: 1 },
    }],
  },
};

const baseProps = {
  tabId: 'tab-preview',
  fileName: 'capture.har',
  isActive: true,
  backendUrl: 'http://localhost:4000',
  recentFiles: [],
  onAddNewTab: vi.fn(),
  onLoadRecentNewTab: vi.fn(),
  onClearRecent: vi.fn(),
};

describe('HarTabContent progressive analyzer handoff', () => {
  beforeEach(() => {
    clearHarDataCache();
    mocks.getHarData.mockReset();
    mocks.getHarStatus.mockReset();
    mocks.requestList.mockReset();
  });

  it('keeps the redacted preview visible, then enables authoritative focus and auto-scroll', async () => {
    let resolveHar!: (har: HarFile) => void;
    const pendingHar = new Promise<HarFile>((resolve) => { resolveHar = resolve; });
    mocks.getHarData.mockReturnValue(pendingHar);
    const onPreviewConsumed = vi.fn();

    const { rerender } = render(
      <HarTabContent
        key="preview-generation"
        {...baseProps}
        fileId=""
        previewSnapshot={preview}
        onPreviewConsumed={onPreviewConsumed}
      />,
    );

    expect(screen.getByLabelText('Progressive HAR analyzer preview')).toBeInTheDocument();
    expect(screen.getByTitle('https://example.com/orders')).toBeInTheDocument();
    expect(screen.getByText(/likely issue will appear and auto-scroll/i)).toBeInTheDocument();
    expect(mocks.requestList).not.toHaveBeenCalled();

    rerender(
      <HarTabContent
        key="authoritative-generation"
        {...baseProps}
        fileId="server-file-id"
        previewSnapshot={preview}
        onPreviewConsumed={onPreviewConsumed}
      />,
    );

    expect(screen.getByLabelText('Progressive HAR analyzer preview')).toBeInTheDocument();
    await act(async () => resolveHar(authoritativeHar));

    await waitFor(() => expect(screen.getByText('Authoritative request list')).toBeInTheDocument());
    expect(screen.queryByLabelText('Progressive HAR analyzer preview')).not.toBeInTheDocument();
    await waitFor(() => {
      const latestCall = mocks.requestList.mock.calls[mocks.requestList.mock.calls.length - 1];
      const latestProps = latestCall?.[0];
      expect(latestProps.focusEntry).toBe(authoritativeHar.log.entries[0]);
      expect(latestProps.scrollToSelectedSignal).toBeGreaterThan(0);
    });
    expect(onPreviewConsumed).toHaveBeenCalledTimes(1);
  });

  it('stops retrying as soon as the authoritative worker reports an error', async () => {
    mocks.getHarData.mockRejectedValue({ response: { status: 404 } });
    mocks.getHarStatus.mockResolvedValue({
      status: 'error',
      error: 'HAR file is invalid or contains unsupported request entries.',
    });

    render(
      <HarTabContent
        {...baseProps}
        fileId="server-invalid-id"
        previewSnapshot={preview}
      />,
    );

    expect(await screen.findByText(
      'HAR file is invalid or contains unsupported request entries.',
    )).toBeInTheDocument();
    expect(mocks.getHarData).toHaveBeenCalledTimes(1);
    expect(mocks.getHarStatus).toHaveBeenCalledTimes(1);
  });
});
