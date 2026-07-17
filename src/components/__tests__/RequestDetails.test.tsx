import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RequestDetails from '../RequestDetails';
import type { Entry } from '../../types/har';

const entry: Entry = {
  startedDateTime: '2026-07-17T08:00:00.000Z',
  time: 120,
  request: {
    method: 'POST',
    url: 'https://example.test/upload',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [
      { name: 'Accept-Encoding', value: 'gzip, deflate, gzip' },
      { name: 'Content-Type', value: 'application/json' },
    ],
    queryString: [],
    headersSize: 180,
    bodySize: 12,
  },
  response: {
    status: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [{ name: 'Content-Encoding', value: 'gzip' }],
    content: {
      size: 42,
      mimeType: 'application/json',
      text: '{"status":"ok"}',
    },
    redirectURL: '',
    headersSize: 120,
    bodySize: 42,
  },
  cache: {},
  timings: {
    blocked: 1,
    dns: 2,
    connect: 3,
    ssl: 4,
    send: 5,
    wait: 90,
    receive: 15,
  },
};

describe('RequestDetails search navigation', () => {
  it('opens the first matching section, highlights repeated matches, and navigates across sections', async () => {
    const user = userEvent.setup();
    render(<RequestDetails entry={entry} onClose={vi.fn()} searchTerm="gzip" />);

    const requestHeadersTab = screen.getByRole('tab', { name: /request headers.*2 search matches/i });
    const responseHeadersTab = screen.getByRole('tab', { name: /response headers.*1 search matches/i });

    await waitFor(() => expect(requestHeadersTab).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(document.querySelectorAll('mark.details-search-match')).toHaveLength(2);
    expect(document.querySelectorAll('mark.details-search-match.is-current')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /next search match/i }));
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(requestHeadersTab).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('button', { name: /next search match/i }));
    await waitFor(() => expect(responseHeadersTab).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    expect(document.querySelectorAll('mark.details-search-match')).toHaveLength(1);
    expect(document.querySelector('mark.details-search-match.is-current')).toHaveTextContent('gzip');
  });

  it('explains when a filter match exists only in metadata not shown by the details tabs', () => {
    render(
      <RequestDetails
        entry={{ ...entry, comment: 'internal-trace-marker' }}
        onClose={vi.fn()}
        searchTerm="internal-trace-marker"
      />
    );

    expect(screen.getByText('No visible match')).toBeInTheDocument();
    expect(screen.getByText(/match is in HAR metadata not displayed here/i)).toBeInTheDocument();
  });
});
