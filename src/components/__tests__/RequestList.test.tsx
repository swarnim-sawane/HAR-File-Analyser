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
