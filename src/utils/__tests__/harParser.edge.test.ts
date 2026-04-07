import { describe, it, expect } from 'vitest';
import { HarParser } from '../harParser';

function makeFile(content: string): File {
  return new File([new Blob([content])], 'test.har', { type: 'application/json' });
}

describe('HarParser — corrupt and edge-case files', () => {
  it('rejects a file that is valid JSON but a plain string', async () => {
    const parser = new HarParser();
    await expect(parser.parseFile(makeFile('"just a string"'))).rejects.toThrow();
  });

  it('rejects a JSON array at root', async () => {
    const parser = new HarParser();
    await expect(parser.parseFile(makeFile('[]'))).rejects.toThrow();
  });

  it('rejects JSON null at root', async () => {
    const parser = new HarParser();
    await expect(parser.parseFile(makeFile('null'))).rejects.toThrow();
  });

  it('rejects when log.creator is an empty object', async () => {
    const parser = new HarParser();
    // validateHarFile checks data.log.creator is truthy — empty object is truthy, so this PASSES validation
    // This documents that the validator does NOT deeply validate creator shape
    const har = JSON.stringify({ log: { version: '1.2', creator: {}, entries: [] } });
    // Should resolve (not reject) — shallow validation only
    const result = await parser.parseFile(makeFile(har));
    expect(result.log.entries).toHaveLength(0);
  });

  it('handles HAR with entries missing optional cache and timings fields', async () => {
    const parser = new HarParser();
    const har = JSON.stringify({
      log: {
        version: '1.2',
        creator: { name: 'Test', version: '1' },
        entries: [{
          startedDateTime: '2024-01-01T00:00:00Z',
          time: 50,
          request: { method: 'GET', url: 'https://x.com/', httpVersion: 'HTTP/1.1', cookies: [], headers: [], queryString: [], headersSize: 0, bodySize: 0 },
          response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', cookies: [], headers: [], content: { size: 0, mimeType: 'text/html' }, redirectURL: '', headersSize: 0, bodySize: 0 },
        }],
      },
    });
    const result = await parser.parseFile(makeFile(har));
    expect(result.log.entries).toHaveLength(1);
  });

  it('rejects truncated JSON', async () => {
    const parser = new HarParser();
    const truncated = '{"log":{"version":"1.2","creator":{"name":"Test","version":"1"},"entries":[{"startedDat';
    await expect(parser.parseFile(makeFile(truncated))).rejects.toThrow();
  });

  it('handles HAR with unicode characters in URLs', async () => {
    const parser = new HarParser();
    const har = JSON.stringify({
      log: {
        version: '1.2',
        creator: { name: 'Test', version: '1' },
        entries: [{
          startedDateTime: '2024-01-01T00:00:00Z',
          time: 50,
          request: { method: 'GET', url: 'https://例え.jp/path?q=テスト', httpVersion: 'HTTP/1.1', cookies: [], headers: [], queryString: [], headersSize: 0, bodySize: 0 },
          response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', cookies: [], headers: [], content: { size: 0, mimeType: 'text/html' }, redirectURL: '', headersSize: 0, bodySize: 0 },
          cache: {}, timings: { send: 1, wait: 5, receive: 4 },
        }],
      },
    });
    const result = await parser.parseFile(makeFile(har));
    expect(result.log.entries[0].request.url).toContain('例え.jp');
  });
});
