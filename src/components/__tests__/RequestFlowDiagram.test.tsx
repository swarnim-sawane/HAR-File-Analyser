import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import RequestFlowDiagram from '../RequestFlowDiagram';
import { Entry, FilterOptions } from '../../types/har';

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

const defaultFilters: FilterOptions = {
  statusCodes: {
    '0': false,
    '1xx': false,
    '2xx': true,
    '3xx': true,
    '4xx': true,
    '5xx': true,
  },
  searchTerm: '',
  timingType: 'relative',
};

describe('RequestFlowDiagram', () => {
  it('keeps domain zones visible when an external request filter narrows visible rows', () => {
    const portalEntry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://portal.example.com/app',
      },
    });
    const authErrorEntry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://idcs.example.com/favicon.ico',
      },
      response: {
        ...buildEntry().response,
        status: 401,
        statusText: 'Unauthorized',
      },
    });
    const staticEntry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://static.example.com/app.js',
      },
      response: {
        ...buildEntry().response,
        content: {
          size: 1024,
          mimeType: 'application/javascript',
        },
      },
    });

    render(
      <RequestFlowDiagram
        entries={[portalEntry, authErrorEntry, staticEntry]}
        visibleEntries={[authErrorEntry]}
      />
    );

    expect(screen.getAllByText('portal.example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('idcs.example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('static.example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('/favicon.ico')).toBeInTheDocument();
    expect(screen.queryByText('/app')).not.toBeInTheDocument();
    expect(screen.queryByText('/app.js')).not.toBeInTheDocument();
    expect(screen.getAllByText(/no requests match the current filters/i)).toHaveLength(2);
  });

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

  it('renders a shared request filter panel and forwards status and search changes', () => {
    const onFiltersChange = vi.fn();
    const entry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://portal.example.com/api/orders',
      },
    });

    render(
      <RequestFlowDiagram
        entries={[entry]}
        visibleEntries={[entry]}
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
      />
    );

    expect(screen.getByText('Request Filters')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /4xx/i }));
    expect(onFiltersChange).toHaveBeenCalledWith({
      statusCodes: {
        ...defaultFilters.statusCodes,
        '4xx': false,
      },
    });

    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'oraclecloud' },
    });
    expect(onFiltersChange).toHaveBeenCalledWith({ searchTerm: 'oraclecloud' });
  });
});
