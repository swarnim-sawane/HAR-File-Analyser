import React from 'react';
import { render, screen } from '@testing-library/react';
import RequestFlowDiagram from '../RequestFlowDiagram';
import { Entry } from '../../types/har';

const buildEntry = (overrides: Partial<Entry> = {}): Entry => ({
  startedDateTime: '2026-04-21T10:30:00.000Z',
  time: 320,
  request: {
    method: 'GET',
    url: 'https://portal.example.com/api/default',
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
      size: 256,
      mimeType: 'application/json',
    },
    redirectURL: '',
    headersSize: 140,
    bodySize: 256,
  },
  cache: {},
  timings: {
    blocked: 10,
    dns: 15,
    connect: 20,
    ssl: 0,
    send: 5,
    wait: 220,
    receive: 50,
  },
  ...overrides,
});

describe('RequestFlowDiagram', () => {
  it('shows fetch-based 5xx requests in the zone body', () => {
    const entry = buildEntry({
      time: 710,
      request: {
        ...buildEntry().request,
        method: 'POST',
        url: 'https://portal.example.com/api/orders',
      },
      response: {
        ...buildEntry().response,
        status: 504,
        statusText: 'Gateway Timeout',
      },
    });

    (entry as Entry & { _resourceType: string })._resourceType = 'fetch';

    render(<RequestFlowDiagram entries={[entry]} />);

    expect(screen.queryByText(/no requests match the current filters/i)).not.toBeInTheDocument();
    expect(screen.getByText('/api/orders')).toBeInTheDocument();
  });

  it('shows fetch-based 1xx requests in the zone body', () => {
    const entry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://portal.example.com/api/progress',
      },
      response: {
        ...buildEntry().response,
        status: 103,
        statusText: 'Early Hints',
      },
    });

    (entry as Entry & { _resourceType: string })._resourceType = 'fetch';

    render(<RequestFlowDiagram entries={[entry]} />);

    expect(screen.queryByText(/no requests match the current filters/i)).not.toBeInTheDocument();
    expect(screen.getByText('/api/progress')).toBeInTheDocument();
  });
});
