import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import RequestFlowDiagram from '../RequestFlowDiagram';
import { Entry, FilterOptions } from '../../types/har';
import type { RequestFlowFocusPath } from '../../utils/requestFlowFocus';

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

const makeFocusPath = (overrides: Partial<RequestFlowFocusPath> = {}): RequestFlowFocusPath => ({
  anchorIndex: 0,
  nodeIndexes: [0],
  edgeKeys: [],
  score: 36,
  severity: 'notice',
  confidence: 'low',
  reasons: ['http-4xx'],
  reasonLabels: ['HTTP 404'],
  nextInspection: 'general',
  summary: 'HTTP 404 on /logo.png',
  candidates: [],
  ...overrides,
});

function mockElementRect(element: Element, rect: Partial<DOMRect>) {
  const top = rect.top ?? 0;
  const left = rect.left ?? 0;
  const width = rect.width ?? 0;
  const height = rect.height ?? 0;

  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: rect.right ?? left + width,
    bottom: rect.bottom ?? top + height,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('RequestFlowDiagram', () => {
  it('renders a phase timeline for the cross-domain journey', () => {
    const portalEntry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://portal.example.com/app',
      },
    });
    const authEntry = buildEntry({
      startedDateTime: '2026-04-21T10:30:00.500Z',
      request: {
        ...buildEntry().request,
        url: 'https://idcs.example.com/oauth2/v1/authorize',
      },
      response: {
        ...buildEntry().response,
        status: 302,
        statusText: 'Found',
        redirectURL: 'https://portal.example.com/callback',
      },
    });
    const callbackEntry = buildEntry({
      startedDateTime: '2026-04-21T10:30:01.000Z',
      request: {
        ...buildEntry().request,
        url: 'https://portal.example.com/cloudgate/v1/oauth2/callback',
      },
      response: {
        ...buildEntry().response,
        status: 302,
        statusText: 'Found',
        redirectURL: '/app',
      },
    });

    render(<RequestFlowDiagram entries={[portalEntry, authEntry, callbackEntry]} />);

    expect(screen.queryByRole('heading', { name: /cross domain journey/i })).not.toBeInTheDocument();
    expect(screen.getByText('Request Filters')).toBeInTheDocument();
    expect(screen.getAllByText('Initial app request').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Identity / authentication').length).toBeGreaterThan(0);
    expect(screen.getAllByText('OAuth callback').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /zoom/i })).not.toBeInTheDocument();
  });

  it('renders a horizontal phase overview and scrolls the selected phase below sticky controls', () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const scrollTo = vi.fn();
    const portalEntry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://portal.example.com/app',
      },
    });
    const authEntry = buildEntry({
      startedDateTime: '2026-04-21T10:30:00.500Z',
      request: {
        ...buildEntry().request,
        url: 'https://idcs.example.com/oauth2/v1/authorize',
      },
      response: {
        ...buildEntry().response,
        status: 302,
        statusText: 'Found',
        redirectURL: 'https://portal.example.com/cloudgate/v1/oauth2/callback',
      },
    });
    const callbackEntry = buildEntry({
      startedDateTime: '2026-04-21T10:30:01.000Z',
      request: {
        ...buildEntry().request,
        url: 'https://portal.example.com/cloudgate/v1/oauth2/callback',
      },
      response: {
        ...buildEntry().response,
        status: 302,
        statusText: 'Found',
        redirectURL: '/app',
      },
    });

    render(<RequestFlowDiagram entries={[portalEntry, authEntry, callbackEntry]} />);

    expect(screen.getByLabelText(/journey phase overview/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to initial app request phase/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to identity \/ authentication phase/i })).toBeInTheDocument();
    expect(screen.getByText('portal.example.com -> idcs.example.com')).toBeInTheDocument();
    expect(screen.getByText('idcs.example.com | redirect')).toBeInTheDocument();
    expect(screen.getByText('portal.example.com | callback')).toBeInTheDocument();
    expect(screen.getAllByText('redirect').length).toBeGreaterThan(0);
    expect(screen.getByText('callback')).toBeInTheDocument();

    const stage = document.querySelector<HTMLElement>('.request-flow-stage');
    const stickyStack = document.querySelector<HTMLElement>('.request-flow-sticky-stack');
    const callbackPhase = Array.from(document.querySelectorAll<HTMLElement>('[data-phase-id]')).find((element) =>
      element.textContent?.includes('OAuth callback')
    );
    if (!stage || !stickyStack || !callbackPhase) throw new Error('Journey map test elements were not rendered');

    Object.defineProperty(stage, 'scrollTop', { configurable: true, value: 120, writable: true });
    stage.scrollTo = scrollTo as unknown as typeof stage.scrollTo;
    mockElementRect(stage, { top: 300, height: 500 });
    mockElementRect(stickyStack, { top: 300, height: 90 });
    mockElementRect(callbackPhase, { top: 850, height: 72 });

    fireEvent.click(screen.getByRole('button', { name: /go to oauth callback phase/i }));

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 568 });
  });

  it('keeps journey phases visible when an external request filter narrows visible rows', () => {
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

    expect(screen.getAllByText('Initial app request').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Identity / authentication').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Static dependencies').length).toBeGreaterThan(0);
    expect(screen.getAllByText('portal.example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('idcs.example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('static.example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('/favicon.ico')).toBeInTheDocument();
    expect(screen.queryByText('/app')).not.toBeInTheDocument();
    expect(screen.queryByText('/app.js')).not.toBeInTheDocument();
    const collapsedInitialPhase = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-expanded') === 'false' && button.textContent?.includes('Initial app request'));
    expect(collapsedInitialPhase).toBeDefined();

    fireEvent.click(collapsedInitialPhase!);

    expect(screen.getByText('1 request in this phase is hidden by current filters.')).toBeInTheDocument();
    expect(screen.queryByText(/no requests match the current filters/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show initial app request requests/i }));

    expect(screen.getByText('/app')).toBeInTheDocument();
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

  it('forwards request row clicks to the Analyzer', () => {
    const onNodeClick = vi.fn();
    const entry = buildEntry({
      request: {
        ...buildEntry().request,
        method: 'POST',
        url: 'https://portal.example.com/api/orders',
      },
    });

    (entry as Entry & { _resourceType: string })._resourceType = 'fetch';

    render(<RequestFlowDiagram entries={[entry]} onNodeClick={onNodeClick} />);

    fireEvent.click(screen.getByText('/api/orders'));

    expect(onNodeClick).toHaveBeenCalledWith(entry);
  });

  it('visually emphasizes likely issue requests inside journey phases', () => {
    const entries = [
      buildEntry({
        request: {
          ...buildEntry().request,
          url: 'https://app.example.com/dashboard',
        },
        response: {
          ...buildEntry().response,
          status: 200,
        },
      }),
      buildEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: {
          ...buildEntry().request,
          url: 'https://app.example.com/api/save',
        },
        response: {
          ...buildEntry().response,
          status: 500,
          statusText: 'Server Error',
        },
        time: 4100,
      }),
    ];

    render(<RequestFlowDiagram entries={entries} />);

    expect(document.querySelectorAll('.is-focus-path').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.is-focus-anchor').length).toBe(1);
    expect(screen.queryByText(/likely issue/i)?.closest('.request-flow-request-row')).toBeTruthy();
    expect(screen.queryByText(/root cause/i)).not.toBeInTheDocument();
  });

  it('surfaces the highest-signal phase as the diagnostic starting point', () => {
    const portalEntry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://portal.example.com/app',
      },
      response: {
        ...buildEntry().response,
        status: 302,
        statusText: 'Found',
        redirectURL: 'https://idcs.example.com/oauth2/v1/authorize',
      },
    });
    const cancelledAuthEntry = buildEntry({
      startedDateTime: '2026-04-21T10:30:00.500Z',
      request: {
        ...buildEntry().request,
        url: 'https://idcs.example.com/oauth2/v1/authorize',
      },
      response: {
        ...buildEntry().response,
        status: 0,
        statusText: '',
      },
    });
    const staticEntry = buildEntry({
      startedDateTime: '2026-04-21T10:30:01.000Z',
      request: {
        ...buildEntry().request,
        url: 'https://static.example.com/app.js',
      },
      response: {
        ...buildEntry().response,
        content: { size: 1024, mimeType: 'application/javascript' },
      },
    });

    render(<RequestFlowDiagram entries={[portalEntry, cancelledAuthEntry, staticEntry]} />);

    expect(screen.getByRole('button', { name: /go to identity \/ authentication phase/i })).toHaveTextContent(/start here/i);
    expect(screen.getAllByText('1 auth request cancelled').length).toBeGreaterThan(0);
    expect(screen.getByText('/oauth2/v1/authorize')).toBeInTheDocument();
    expect(screen.queryByText('/app.js')).not.toBeInTheDocument();
  });

  it('focuses the exact request inside the journey when an issue chip is clicked', () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const onNodeClick = vi.fn();
    const portalEntry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://portal.example.com/app',
      },
    });
    const cancelledAuthEntry = buildEntry({
      startedDateTime: '2026-04-21T10:30:00.500Z',
      request: {
        ...buildEntry().request,
        url: 'https://idcs.example.com/oauth2/v1/authorize',
      },
      response: {
        ...buildEntry().response,
        status: 0,
        statusText: '',
      },
    });

    render(
      <RequestFlowDiagram
        entries={[portalEntry, cancelledAuthEntry]}
        onNodeClick={onNodeClick}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /focus issue: 1 auth request cancelled/i }));

    expect(onNodeClick).not.toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(screen.getByText('/oauth2/v1/authorize').closest('.request-flow-request-row')).toHaveClass('is-guided-target');
  });

  it('uses worth-checking wording for low-confidence shared focus metadata', () => {
    const entry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://cdn.example.com/logo.png',
      },
      response: {
        ...buildEntry().response,
        status: 404,
        statusText: 'Not Found',
        content: { size: 0, mimeType: 'image/png' },
      },
    });

    render(
      <RequestFlowDiagram
        entries={[entry]}
        issueFocusPath={makeFocusPath()}
        issueFocusEnabled
      />
    );

    expect(screen.getByText('Worth checking')).toBeInTheDocument();
    expect(screen.queryByText('Likely issue')).not.toBeInTheDocument();
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
    expect(screen.queryByRole('searchbox', { name: /search/i })).not.toBeInTheDocument();

    const filtersButton = screen.getByRole('button', { name: /show request filters/i });
    expect(filtersButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(filtersButton);

    expect(screen.getByRole('button', { name: /hide request filters/i })).toHaveAttribute('aria-expanded', 'true');

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
