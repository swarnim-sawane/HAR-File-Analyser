import React from 'react';
import { render, screen, within } from '@testing-library/react';
import PerformanceScorecard from '../PerformanceScorecard';
import type { Entry, HarFile } from '../../types/har';

const buildEntry = (overrides: Partial<Entry> = {}): Entry => ({
  startedDateTime: '2026-04-22T10:30:00.000Z',
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
    dns: 20,
    connect: 15,
    ssl: 0,
    send: 5,
    wait: 220,
    receive: 50,
  },
  ...overrides,
});

const buildHar = (entries: Entry[]): HarFile => ({
  log: {
    version: '1.2',
    creator: {
      name: 'vitest',
      version: '1.0.0',
    },
    entries,
  },
});

describe('PerformanceScorecard scorecard finding URLs', () => {
  it('renders auth finding URL segments as external links while keeping the status prefix visible', () => {
    const authUrl = 'https://auth.example.com/favicon.ico';
    const entry = buildEntry({
      request: {
        ...buildEntry().request,
        url: authUrl,
      },
      response: {
        ...buildEntry().response,
        status: 401,
        statusText: 'Unauthorized',
      },
    });

    render(<PerformanceScorecard harData={buildHar([entry])} />);

    const link = screen.getByRole('link', { name: authUrl });

    expect(link).toHaveAttribute('href', authUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    expect(within(link.closest('li') as HTMLElement).getByText(/HTTP 401/i)).toBeInTheDocument();
  });

  it('keeps sensitive-parameter URLs highlighted but not clickable', () => {
    const sensitiveUrl =
      'https://secure.example.com/logout?access_token=super-secret-token&foo=bar';
    const entry = buildEntry({
      request: {
        ...buildEntry().request,
        url: sensitiveUrl,
      },
    });

    render(<PerformanceScorecard harData={buildHar([entry])} />);

    const sensitiveToken = screen.getByText(sensitiveUrl);

    expect(screen.queryByRole('link', { name: sensitiveUrl })).not.toBeInTheDocument();
    expect(sensitiveToken.tagName).toBe('SPAN');
    expect(sensitiveToken).toHaveAttribute('tabindex', '0');
  });

  it('leaves non-URL meta rows as plain text', () => {
    const entries = [
      buildEntry({
        request: {
          ...buildEntry().request,
          url: 'https://a.example.com/app.js',
        },
        timings: {
          ...buildEntry().timings,
          dns: 120,
        },
      }),
      buildEntry({
        request: {
          ...buildEntry().request,
          url: 'https://b.example.com/app.js',
        },
        timings: {
          ...buildEntry().timings,
          dns: 140,
        },
      }),
      buildEntry({
        request: {
          ...buildEntry().request,
          url: 'https://c.example.com/app.js',
        },
        timings: {
          ...buildEntry().timings,
          dns: 160,
        },
      }),
    ];

    render(<PerformanceScorecard harData={buildHar(entries)} />);

    expect(
      screen.getByText(/Hosts: a\.example\.com, b\.example\.com, c\.example\.com/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps long cache-header URLs visible after splitting prefix and link text', () => {
    const longUrl =
      'https://static.example.com/assets/styles/really-long-enterprise-login-theme-v2/main.css?v=2026-04-22&theme=dark&locale=en-US';
    const entry = buildEntry({
      request: {
        ...buildEntry().request,
        url: longUrl,
      },
      response: {
        ...buildEntry().response,
        content: {
          size: 4096,
          mimeType: 'text/css',
        },
      },
    });

    render(<PerformanceScorecard harData={buildHar([entry])} />);

    const link = screen.getByRole('link', { name: longUrl });

    expect(link).toBeInTheDocument();
    expect(within(link.closest('li') as HTMLElement).getByText(/stylesheet/i)).toBeInTheDocument();
  });
});
