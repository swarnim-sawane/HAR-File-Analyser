import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { streamParseHar, streamParseConsoleLog } from '../streamingParser';
import { makeHarJsonString } from '../../test-utils/fixtures';

const tempFiles: string[] = [];

function writeTempFile(content: string, ext = '.har'): string {
  const path = join(tmpdir(), `har-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  writeFileSync(path, content, 'utf-8');
  tempFiles.push(path);
  return path;
}

afterEach(() => {
  for (const f of tempFiles.splice(0)) {
    if (existsSync(f)) unlinkSync(f);
  }
});

// ── streamParseHar ──────────────────────────────────────────────────────────

describe('streamParseHar', () => {
  it('yields all entries from a 3-entry HAR file', async () => {
    const path = writeTempFile(makeHarJsonString(3));
    const collected: any[] = [];
    await streamParseHar(path, async (entry) => { collected.push(entry); });
    expect(collected).toHaveLength(3);
  });

  it('assigns sequential index starting from 0', async () => {
    const path = writeTempFile(makeHarJsonString(4));
    const indices: number[] = [];
    await streamParseHar(path, async (entry) => { indices.push(entry.index); });
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it('yields zero entries for empty entries array', async () => {
    const har = JSON.stringify({ log: { version: '1.2', creator: { name: 'T', version: '1' }, entries: [] } });
    const path = writeTempFile(har);
    const collected: any[] = [];
    await streamParseHar(path, async (entry) => { collected.push(entry); });
    expect(collected).toHaveLength(0);
  });

  it('preserves request.method and request.url', async () => {
    const path = writeTempFile(makeHarJsonString(1));
    const collected: any[] = [];
    await streamParseHar(path, async (entry) => { collected.push(entry); });
    expect(collected[0].request.method).toBe('GET');
    expect(collected[0].request.url).toContain('example.com');
  });

  it('preserves response.status', async () => {
    const path = writeTempFile(makeHarJsonString(1));
    const collected: any[] = [];
    await streamParseHar(path, async (entry) => { collected.push(entry); });
    expect(collected[0].response.status).toBe(200);
  });

  it('throws on a non-existent file path', async () => {
    await expect(
      streamParseHar('/tmp/does-not-exist-xyz-abc.har', async () => {})
    ).rejects.toThrow();
  });

  it('throws on a file with invalid JSON', async () => {
    const path = writeTempFile('this is not json');
    await expect(streamParseHar(path, async () => {})).rejects.toThrow();
  });

  it('yields zero entries for truncated JSON (JSONStream does not throw on incomplete input)', async () => {
    // JSONStream silently stops when the stream ends mid-parse; no entries are emitted
    const path = writeTempFile('{"log":{"version":"1.2","entries":[{"startedDate');
    const collected: any[] = [];
    await streamParseHar(path, async (entry) => { collected.push(entry); });
    expect(collected).toHaveLength(0);
  });
});

// ── streamParseConsoleLog ───────────────────────────────────────────────────

describe('streamParseConsoleLog', () => {
  it('parses JSON-format log lines', async () => {
    const lines = [
      JSON.stringify({ timestamp: '2024-01-01T00:00:00Z', level: 'info', message: 'Server started' }),
      JSON.stringify({ timestamp: '2024-01-01T00:00:01Z', level: 'error', message: 'Connection failed' }),
    ].join('\n');
    const path = writeTempFile(lines, '.log');
    const collected: any[] = [];
    await streamParseConsoleLog(path, async (entry) => { collected.push(entry); });
    expect(collected).toHaveLength(2);
    expect(collected[0].level).toBe('info');
    expect(collected[0].message).toBe('Server started');
    expect(collected[1].level).toBe('error');
  });

  it('parses bracket-format log lines', async () => {
    const line = '[2024-01-15 10:30:45] ERROR: Something went wrong';
    const path = writeTempFile(line, '.log');
    const collected: any[] = [];
    await streamParseConsoleLog(path, async (entry) => { collected.push(entry); });
    expect(collected).toHaveLength(1);
    expect(collected[0].level).toBe('error');
    expect(collected[0].message).toContain('Something went wrong');
  });

  it('skips empty lines without throwing', async () => {
    const content = 'line one\n\n\nline two';
    const path = writeTempFile(content, '.log');
    const collected: any[] = [];
    await streamParseConsoleLog(path, async (entry) => { collected.push(entry); });
    expect(collected).toHaveLength(2);
  });

  it('falls back to info level for unrecognised format lines', async () => {
    const path = writeTempFile('random log text here', '.log');
    const collected: any[] = [];
    await streamParseConsoleLog(path, async (entry) => { collected.push(entry); });
    expect(collected).toHaveLength(1);
    expect(collected[0].level).toBe('info');
    expect(collected[0].message).toBe('random log text here');
  });

  it('throws on a non-existent file path', async () => {
    await expect(
      streamParseConsoleLog('/tmp/does-not-exist-xyz-abc.log', async () => {})
    ).rejects.toThrow();
  });
});
