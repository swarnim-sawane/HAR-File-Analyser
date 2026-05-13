import { describe, expect, it } from 'vitest';
import { ConsoleLogParser } from '../consoleLogParser';

describe('ConsoleLogParser', () => {
  describe('parseJSON', () => {
    it('removes stale stored HTTP 5xx tags when access-log status is 200', () => {
      const parsed = ConsoleLogParser.parseJSON(
        JSON.stringify({
          metadata: { fileName: 'access.log', totalEntries: 1 },
          entries: [
            {
              id: 'stale-entry',
              timestamp: '2026-05-13T00:00:00.000Z',
              level: 'error',
              message:
                '[09/May/2026:15:57:00 +0000] 252.177.147.165 - C6135B63D0AC31293BFAD982B55A4BCB "GET /ic/builder/rt/warehouse_reception_module/live/resources/data/GantryReplenishment?onlyData=true&q=retryStatus2%3D0+and+replenId%3D8206791&limit=23 HTTP/1.1" 200 507088 565',
              rawText:
                '[09/May/2026:15:57:00 +0000] 252.177.147.165 - C6135B63D0AC31293BFAD982B55A4BCB "GET /ic/builder/rt/warehouse_reception_module/live/resources/data/GantryReplenishment?onlyData=true&q=retryStatus2%3D0+and+replenId%3D8206791&limit=23 HTTP/1.1" 200 507088 565',
              issueTags: ['http-5xx'],
              inferredSeverity: 'error',
              primaryIssue: 'http-5xx',
            },
          ],
        }),
        'access.log',
      );

      const entry = parsed.entries[0] as any;
      expect(entry.issueTags).not.toContain('http-5xx');
      expect(entry.primaryIssue).not.toBe('http-5xx');
      expect(entry.level).not.toBe('error');
      expect(entry.inferredSeverity).not.toBe('error');
    });
  });

  describe('parsePlainText', () => {
    it('keeps multiline browser console errors as one event with raw text', () => {
      const parsed = ConsoleLogParser.parsePlainText(
        [
          "TypeError: Cannot read properties of undefined (reading 'layoutTypes')",
          'Object',
          '    at resolveLayoutTypes (vbcs.min.js:299:17)',
        ].join('\n'),
        'console.log',
      );

      expect(parsed.entries).toHaveLength(1);

      const entry = parsed.entries[0] as any;
      expect(entry.message).toContain('TypeError: Cannot read properties of undefined');
      expect(entry.rawText).toContain('Object');
      expect(entry.stackTrace).toContain('resolveLayoutTypes');
      expect(entry.inferredSeverity).toBe('error');
      expect(entry.issueTags).toContain('exception');
    });

    it('promotes a CORS-blocked fetch to an error level', () => {
      const parsed = ConsoleLogParser.parsePlainText(
        [
          "webapp/:1 Access to fetch at 'https://api.example.com/ords/test' from origin 'https://app.example.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
        ].join('\n'),
        'console.log',
      );

      expect(parsed.entries).toHaveLength(1);

      const entry = parsed.entries[0] as any;
      expect(entry.level).toBe('error');
      expect(entry.inferredSeverity).toBe('error');
      expect(entry.issueTags).toEqual(expect.arrayContaining(['cors', 'network']));
      expect(entry.primaryIssue).toBe('cors');
    });

    it('does not classify successful HTTP logs with millisecond timings as 5xx', () => {
      const status200With500ms = ConsoleLogParser.parsePlainText(
        'GET /ords/status completed with status 200 in 500ms',
        'console.log',
      );
      const response200With503ms = ConsoleLogParser.parsePlainText(
        'response 200 took 503ms for /ords/data',
        'console.log',
      );

      expect((status200With500ms.entries[0] as any).issueTags).not.toContain('http-5xx');
      expect((response200With503ms.entries[0] as any).issueTags).not.toContain('http-5xx');
    });

    it('classifies explicit HTTP 5xx and 4xx status evidence', () => {
      const serverError = ConsoleLogParser.parsePlainText(
        'GET /ords/orders HTTP/1.1 503 Service Unavailable',
        'console.log',
      );
      const clientError = ConsoleLogParser.parsePlainText(
        'Request to /ords/users responded with a status of 404',
        'console.log',
      );

      expect((serverError.entries[0] as any).issueTags).toContain('http-5xx');
      expect((clientError.entries[0] as any).issueTags).toContain('http-4xx');
    });

    it('does not classify access-log response sizes as HTTP 5xx statuses', () => {
      const parsed = ConsoleLogParser.parsePlainText(
        '[09/May/2026:15:57:00 +0000] 252.177.147.165 - C6135B63D0AC31293BFAD982B55A4BCB "GET /ic/builder/rt/warehouse_reception_module/live/resources/data/GantryReplenishment?onlyData=true&q=retryStatus2%3D0+and+replenId%3D8206791&limit=23 HTTP/1.1" 200 507088 565',
        'access.log',
      );

      const entry = parsed.entries[0] as any;
      expect(entry.issueTags).not.toContain('http-5xx');
      expect(entry.inferredSeverity).not.toBe('error');
    });

    it('classifies quoted access-log HTTP statuses from the status field only', () => {
      const parsed = ConsoleLogParser.parsePlainText(
        '[09/May/2026:15:57:00 +0000] 252.177.147.165 - C6135B63D0AC31293BFAD982B55A4BCB "GET /ords/orders HTTP/1.1" 503 507088 565',
        'access.log',
      );

      expect((parsed.entries[0] as any).issueTags).toContain('http-5xx');
    });

    it('marks browser policy blocks as warnings', () => {
      const parsed = ConsoleLogParser.parsePlainText(
        [
          'index.html?root=application:1 Autofocus processing was blocked because a document already has a focused element.',
        ].join('\n'),
        'console.log',
      );

      const entry = parsed.entries[0] as any;
      expect(entry.level).toBe('warn');
      expect(entry.inferredSeverity).toBe('warning');
      expect(entry.issueTags).toContain('browser-policy');
    });

    it('preserves unknown continuation lines in raw text', () => {
      const parsed = ConsoleLogParser.parsePlainText(
        [
          'ERROR: Failed to bootstrap application shell',
          'Additional diagnostic context from browser renderer',
        ].join('\n'),
        'console.log',
      );

      expect(parsed.entries).toHaveLength(1);
      expect((parsed.entries[0] as any).rawText).toContain(
        'Additional diagnostic context from browser renderer',
      );
    });
  });
});
