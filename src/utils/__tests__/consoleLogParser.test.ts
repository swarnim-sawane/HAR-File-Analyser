import { describe, expect, it } from 'vitest';
import { ConsoleLogParser } from '../consoleLogParser';

describe('ConsoleLogParser', () => {
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

    it('marks a CORS-blocked fetch as inferred error while keeping the raw level', () => {
      const parsed = ConsoleLogParser.parsePlainText(
        [
          "webapp/:1 Access to fetch at 'https://api.example.com/ords/test' from origin 'https://app.example.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
        ].join('\n'),
        'console.log',
      );

      expect(parsed.entries).toHaveLength(1);

      const entry = parsed.entries[0] as any;
      expect(entry.level).toBe('log');
      expect(entry.inferredSeverity).toBe('error');
      expect(entry.issueTags).toEqual(expect.arrayContaining(['cors', 'network']));
      expect(entry.primaryIssue).toBe('cors');
    });

    it('marks browser policy blocks as warnings', () => {
      const parsed = ConsoleLogParser.parsePlainText(
        [
          'index.html?root=application:1 Autofocus processing was blocked because a document already has a focused element.',
        ].join('\n'),
        'console.log',
      );

      const entry = parsed.entries[0] as any;
      expect(entry.level).toBe('log');
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
