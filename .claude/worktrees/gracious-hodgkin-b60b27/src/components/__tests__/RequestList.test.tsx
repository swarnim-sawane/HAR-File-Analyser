// src/components/__tests__/RequestList.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RequestList, { formatTimestamp } from '../RequestList';
import { Entry } from '../../types/har';

// Minimal entry factory — extend overrides per test
const makeEntry = (overrides: Partial<Entry> = {}): Entry => ({
  startedDateTime: '2026-03-18T06:17:56.461Z',
  time: 300,
  request: {
    method: 'GET',
    url: 'https://example.com/api/test',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [],
    queryString: [],
    headersSize: 200,
    bodySize: 1024,
  },
  response: {
    status: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [],
    content: { size: 2048, mimeType: 'application/json' },
    redirectURL: '',
    headersSize: 100,
    bodySize: 2048,
  },
  cache: {},
  timings: { send: 10, wait: 250, receive: 40 },
  ...overrides,
});

const noop = () => {};

describe('formatTimestamp', () => {
  it('extracts HH:MM:SS.mmm from a UTC ISO string', () => {
    expect(formatTimestamp('2026-03-18T06:17:56.461Z')).toBe('06:17:56.461');
  });

  it('extracts time from ISO string with positive offset', () => {
    expect(formatTimestamp('2026-03-18T14:30:00.123+05:30')).toBe('14:30:00.123');
  });

  it('handles ISO string without milliseconds', () => {
    expect(formatTimestamp('2026-03-18T09:00:00Z')).toBe('09:00:00');
  });

  it('returns the raw string if no T separator found', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });
});

describe('RequestList — timestamp sort', () => {
  const entries = [
    makeEntry({ startedDateTime: '2026-03-18T06:17:58.000Z', time: 100 }),
    makeEntry({ startedDateTime: '2026-03-18T06:17:56.000Z', time: 200 }),
    makeEntry({ startedDateTime: '2026-03-18T06:17:57.000Z', time: 150 }),
  ];

  it('renders entries in ascending timestamp order by default', () => {
    render(<RequestList entries={entries} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    const timestamps = screen.getAllByTestId('request-timestamp').map(el => el.textContent);
    expect(timestamps[0]).toBe('06:17:56.000');
    expect(timestamps[1]).toBe('06:17:57.000');
    expect(timestamps[2]).toBe('06:17:58.000');
  });

  it('reverses order to descending when Timestamp header is clicked', async () => {
    const user = userEvent.setup();
    render(<RequestList entries={entries} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    await user.click(screen.getByRole('button', { name: /timestamp/i }));
    const timestamps = screen.getAllByTestId('request-timestamp').map(el => el.textContent);
    expect(timestamps[0]).toBe('06:17:58.000');
    expect(timestamps[2]).toBe('06:17:56.000');
  });
});

describe('RequestList — size cell', () => {
  it('shows request and response sizes with labelled icons', () => {
    const entry = makeEntry({
      request: { ...makeEntry().request, bodySize: 1024 },
      response: { ...makeEntry().response, bodySize: 2048 },
    });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTestId('size-upload')).toBeInTheDocument();
    expect(screen.getByTestId('size-download')).toBeInTheDocument();
    expect(screen.getByTestId('size-upload').textContent).toContain('1 KB');
    expect(screen.getByTestId('size-download').textContent).toContain('2 KB');
  });

  it('shows — for unknown bodySize (-1)', () => {
    const entry = makeEntry({
      request: { ...makeEntry().request, bodySize: -1 },
      response: { ...makeEntry().response, bodySize: -1 },
    });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTestId('size-upload').textContent).toContain('—');
    expect(screen.getByTestId('size-download').textContent).toContain('—');
  });
});

describe('RequestList — analysis badges', () => {
  it('shows redirect badge for 3xx status', () => {
    const entry = makeEntry({ response: { ...makeEntry().response, status: 302 } });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTitle('Redirect')).toBeInTheDocument();
  });

  it('shows cached badge for 304 status', () => {
    const entry = makeEntry({ response: { ...makeEntry().response, status: 304, bodySize: 0 } });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTitle('Cached')).toBeInTheDocument();
  });

  it('shows cached badge for 200 with 0 bodySize', () => {
    const entry = makeEntry({ response: { ...makeEntry().response, status: 200, bodySize: 0 } });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTitle('Cached')).toBeInTheDocument();
  });

  it('shows slow badge when time > 3000ms', () => {
    const entry = makeEntry({ time: 3500 });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTitle('Slow (>3s)')).toBeInTheDocument();
  });

  it('shows large badge when response bodySize > 1MB', () => {
    const entry = makeEntry({ response: { ...makeEntry().response, bodySize: 1_100_000 } });
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.getByTitle('Large response (>1MB)')).toBeInTheDocument();
  });

  it('shows no badges for a normal 200 response', () => {
    const entry = makeEntry(); // 200, 2048 bytes, 300ms
    render(<RequestList entries={[entry]} selectedEntry={null} onSelectEntry={noop} timingType="relative" />);
    expect(screen.queryByTitle('Redirect')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Cached')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Slow (>3s)')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Large response (>1MB)')).not.toBeInTheDocument();
  });
});
