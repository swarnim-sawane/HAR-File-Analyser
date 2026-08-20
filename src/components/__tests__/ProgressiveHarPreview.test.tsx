import React from 'react';
import { render, screen } from '@testing-library/react';
import ProgressiveHarPreview from '../ProgressiveHarPreview';
import type { HarPreviewSnapshot } from '../../services/progressiveHarPreview';

const snapshot: HarPreviewSnapshot = {
  previewId: 'preview-1',
  fileName: 'large-capture.har',
  fileSize: 8_000_000,
  phase: 'uploading',
  revision: 1,
  requests: [
    {
      id: 'preview-request-0',
      index: 0,
      startedDateTime: '2026-08-18T10:00:00.000Z',
      method: 'GET',
      url: 'https://example.com/orders',
      status: 200,
      statusText: 'OK',
      durationMs: 24.7,
      encodedBytes: 128,
    },
  ],
  totalParsed: 1,
  skippedOversizedEntries: 0,
  isTruncated: false,
  maxRequests: 250,
};

describe('ProgressiveHarPreview', () => {
  it('shows a neutral incremental loader and withholds authoritative analysis', () => {
    const { container } = render(<ProgressiveHarPreview snapshot={snapshot} />);

    expect(screen.getAllByText('Loading HAR file')).toHaveLength(1);
    expect(screen.getByText(/loading har file - 1 request read/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/1 request read incrementally/i);
    expect(screen.getByRole('status')).toHaveTextContent(/likely issue will appear and auto-scroll/i);
    expect(screen.queryByText('EARLY PREVIEW')).not.toBeInTheDocument();
    expect(screen.queryByText('Uploading the complete HAR')).not.toBeInTheDocument();
    expect(container.querySelector('.progressive-analyzer__loader-mark')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Request Flow' })).toBeDisabled();
    expect(screen.getByTitle('https://example.com/orders')).toBeInTheDocument();
    expect(screen.queryByText(/access_token|secret/i)).not.toBeInTheDocument();
  });

  it('keeps safe rows visible when an oversized request is omitted', () => {
    render(
      <ProgressiveHarPreview
        snapshot={{ ...snapshot, skippedOversizedEntries: 1, isTruncated: true }}
      />,
    );

    expect(screen.getByText(/1 oversized request omitted locally/i)).toBeInTheDocument();
    expect(screen.getByText(/server validation continues/i)).toBeInTheDocument();
    expect(document.querySelector('.progressive-analyzer__notice')).not.toBeInTheDocument();
    expect(document.querySelector('.progressive-analyzer__loader-note')).toBeInTheDocument();
    expect(screen.getByTitle('https://example.com/orders')).toBeInTheDocument();
  });

  it('does not describe a terminal validation failure as still loading', () => {
    render(
      <ProgressiveHarPreview
        snapshot={{
          ...snapshot,
          phase: 'failed',
          error: 'HAR file contains an invalid request entry.',
        }}
      />,
    );

    expect(screen.getAllByText('HAR file could not be processed')).toHaveLength(1);
    expect(screen.queryByText(/likely issue will appear/i)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid request entry/i);
  });
});
