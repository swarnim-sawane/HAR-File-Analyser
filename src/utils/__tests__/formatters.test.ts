import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatTime,
  formatDate,
  formatCapturedDate,
  formatUrl,
  formatDomain,
  formatHttpVersion,
  formatMimeType,
  formatPercentage,
} from '../formatters';

describe('formatBytes', () => {
  it('returns "0 Bytes" for 0', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
  });
  it('returns "N/A" for negative', () => {
    expect(formatBytes(-1)).toBe('N/A');
  });
  it('formats bytes correctly', () => {
    expect(formatBytes(500)).toBe('500 Bytes');
  });
  it('formats kilobytes correctly', () => {
    expect(formatBytes(1024)).toBe('1 KB');
  });
  it('formats megabytes correctly', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
  });
  it('respects decimals parameter', () => {
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });
});

describe('formatTime', () => {
  it('returns "N/A" for negative', () => {
    expect(formatTime(-1)).toBe('N/A');
  });
  it('returns "0ms" for 0', () => {
    expect(formatTime(0)).toBe('0ms');
  });
  it('formats milliseconds under 1s', () => {
    expect(formatTime(500)).toBe('500ms');
  });
  it('formats seconds', () => {
    expect(formatTime(1500)).toBe('1.50s');
  });
  it('formats minutes', () => {
    expect(formatTime(65000)).toBe('1m 5s');
  });
});

describe('formatDate', () => {
  it('returns a non-empty string for a valid ISO date', () => {
    const result = formatDate('2024-01-15T10:30:00.000Z');
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/2024/);
  });
  it('returns "Invalid Date" for unparseable input', () => {
    // new Date('not-a-date') doesn't throw — it produces an Invalid Date object
    // whose toLocaleString() returns the string "Invalid Date"
    const result = formatDate('not-a-date');
    expect(result).toBe('Invalid Date');
  });
});

describe('formatCapturedDate', () => {
  it('formats a valid ISO datetime string with Z timezone', () => {
    const result = formatCapturedDate('2024-01-15T10:30:45.000Z');
    expect(result).toBe('Jan 15, 2024, 10:30:45 GMT');
  });
  it('returns original string when not ISO format', () => {
    const input = 'Mon Jan 15 2024';
    expect(formatCapturedDate(input)).toBe(input);
  });
  it('handles +HH:MM timezone offsets', () => {
    const result = formatCapturedDate('2024-06-01T14:00:00+05:30');
    expect(result).toContain('GMT+05:30');
  });
  it('handles ISO without fractional seconds', () => {
    const result = formatCapturedDate('2024-03-20T08:00:00Z');
    expect(result).toBe('Mar 20, 2024, 08:00:00 GMT');
  });
});

describe('formatUrl', () => {
  it('returns the url unchanged when short enough', () => {
    const url = 'https://example.com/short';
    expect(formatUrl(url, 80)).toBe(url);
  });
  it('truncates long urls with ellipsis and respects maxLength', () => {
    const url = 'https://example.com/' + 'a'.repeat(100);
    const result = formatUrl(url, 40);
    expect(result).toContain('...');
    expect(result.length).toBeLessThanOrEqual(43); // maxLength + up to 3 chars for ellipsis
  });
  it('handles malformed URLs gracefully with truncation', () => {
    const result = formatUrl('not-a-url-' + 'x'.repeat(100), 20);
    expect(result).toContain('...');
    expect(result.length).toBeLessThanOrEqual(23);
  });
});

describe('formatDomain', () => {
  it('extracts hostname from valid URL', () => {
    expect(formatDomain('https://api.example.com/path?q=1')).toBe('api.example.com');
  });
  it('returns original string for invalid URL', () => {
    expect(formatDomain('not-a-url')).toBe('not-a-url');
  });
});

describe('formatHttpVersion', () => {
  it('maps HTTP/2.0 to HTTP/2', () => {
    expect(formatHttpVersion('HTTP/2.0')).toBe('HTTP/2');
  });
  it('maps h2 to HTTP/2', () => {
    expect(formatHttpVersion('h2')).toBe('HTTP/2');
  });
  it('maps h3 to HTTP/3', () => {
    expect(formatHttpVersion('h3')).toBe('HTTP/3');
  });
  it('passes through unknown versions', () => {
    expect(formatHttpVersion('SPDY/3')).toBe('SPDY/3');
  });
});

describe('formatMimeType', () => {
  it('maps application/json to JSON', () => {
    expect(formatMimeType('application/json')).toBe('JSON');
  });
  it('maps text/html to HTML', () => {
    expect(formatMimeType('text/html')).toBe('HTML');
  });
  it('strips charset params before lookup', () => {
    expect(formatMimeType('text/html; charset=utf-8')).toBe('HTML');
  });
  it('returns the raw type for unknown mimes', () => {
    expect(formatMimeType('application/x-custom')).toBe('application/x-custom');
  });
});

describe('formatPercentage', () => {
  it('returns "0%" when total is 0', () => {
    expect(formatPercentage(5, 0)).toBe('0%');
  });
  it('calculates percentage correctly', () => {
    expect(formatPercentage(1, 4)).toBe('25.0%');
  });
  it('handles 100%', () => {
    expect(formatPercentage(10, 10)).toBe('100.0%');
  });
});
