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

  it('promotes CORS policy blocks to error entries', async () => {
    const line =
      "webapp/:1 Access to fetch at 'https://api.example.com/ords/test' from origin 'https://app.example.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.";
    const path = writeTempFile(line, '.log');
    const collected: any[] = [];

    await streamParseConsoleLog(path, async (entry) => { collected.push(entry); });

    expect(collected).toHaveLength(1);
    expect(collected[0].level).toBe('error');
    expect(collected[0].originalLevel).toBe('info');
    expect(collected[0].inferredSeverity).toBe('error');
    expect(collected[0].issueTags).toEqual(expect.arrayContaining(['cors', 'network']));
    expect(collected[0].primaryIssue).toBe('cors');
    expect(collected[0].classificationReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'cors.failure', tag: 'cors', severity: 'error' }),
      ]),
    );
  });

  it('parses Catalina bracketed ISO INFO and ERROR rows with source fields', async () => {
    const path = writeTempFile(
      [
        '2026-05-09T17:20:53.362Z [INFO] [http-nio-10.89.0.2-8012-exec-2] [Context: {tenantId=7712EB5F949146B4910EB86BD8EBF46F}] [com.oracle.breeze.metrics.HourlyVisitorTrackingFilter@1007] VB_OPID_HOURLY_VISIT: Added one to TenantHourlyPK for URI /rt/warehouse_reception_module/live/resources/data/GantryOblpnInfo Headers: User-Agent = oracle-cloud-rest/21.2.1',
        '2026-05-09T17:20:53.443Z [ERROR] [vb-data-rt-pool-thread-9403] [Context: {tenantId=7712EB5F949146B4910EB86BD8EBF46F}] [oracle.adf.model.log.Jpx@2240] JPX Namespace /sitedef does not have a writable MetadataStore, forcing mMergedJpxPersisted to DISABLE',
      ].join('\n'),
      '.log',
    );
    const collected: any[] = [];

    await streamParseConsoleLog(path, async (entry) => { collected.push(entry); });

    expect(collected).toHaveLength(2);
    expect(collected[0]).toMatchObject({
      level: 'info',
      source: 'com.oracle.breeze.metrics.HourlyVisitorTrackingFilter@1007',
    });
    expect(collected[0].issueTags).not.toEqual(expect.arrayContaining(['cors', 'network']));
    expect(collected[1]).toMatchObject({
      level: 'error',
      originalLevel: 'error',
      source: 'oracle.adf.model.log.Jpx@2240',
    });
    expect(collected[1].message).toContain('writable MetadataStore');
  });

  it('does not classify harmless CORS header counters as CORS failures', async () => {
    const path = writeTempFile('Access-Control-Allow-Origin: count 1', '.log');
    const collected: any[] = [];

    await streamParseConsoleLog(path, async (entry) => { collected.push(entry); });

    expect(collected).toHaveLength(1);
    expect(collected[0].issueTags).not.toEqual(expect.arrayContaining(['cors', 'network']));
    expect(collected[0].inferredSeverity).not.toBe('error');
  });

  it('does not classify neutral preflight access-control notes as CORS or network failures', async () => {
    const path = writeTempFile('Preflight request completed access control check for /ords/data', '.log');
    const collected: any[] = [];

    await streamParseConsoleLog(path, async (entry) => { collected.push(entry); });

    expect(collected).toHaveLength(1);
    expect(collected[0].issueTags).not.toEqual(expect.arrayContaining(['cors', 'network']));
    expect(collected[0].inferredSeverity).not.toBe('error');
  });

  it('does not classify successful HTTP logs with millisecond timings as 5xx', async () => {
    const path = writeTempFile(
      [
        'GET /ords/status completed with status 200 in 500ms',
        'response 200 took 503ms for /ords/data',
      ].join('\n'),
      '.log',
    );
    const collected: any[] = [];

    await streamParseConsoleLog(path, async (entry) => { collected.push(entry); });

    expect(collected).toHaveLength(2);
    expect(collected[0].issueTags).not.toContain('http-5xx');
    expect(collected[1].issueTags).not.toContain('http-5xx');
  });

  it('classifies explicit HTTP 5xx and 4xx status evidence', async () => {
    const path = writeTempFile(
      [
        'GET /ords/orders HTTP/1.1 503 Service Unavailable',
        'Request to /ords/users responded with a status of 404',
      ].join('\n'),
      '.log',
    );
    const collected: any[] = [];

    await streamParseConsoleLog(path, async (entry) => { collected.push(entry); });

    expect(collected).toHaveLength(2);
    expect(collected[0].issueTags).toContain('http-5xx');
    expect(collected[1].issueTags).toContain('http-4xx');
  });

  it('does not classify access-log response sizes as HTTP 5xx statuses', async () => {
    const path = writeTempFile(
      '[09/May/2026:15:57:00 +0000] 252.177.147.165 - C6135B63D0AC31293BFAD982B55A4BCB "GET /ic/builder/rt/warehouse_reception_module/live/resources/data/GantryReplenishment?onlyData=true&q=retryStatus2%3D0+and+replenId%3D8206791&limit=23 HTTP/1.1" 200 507088 565',
      '.log',
    );
    const collected: any[] = [];

    await streamParseConsoleLog(path, async (entry) => { collected.push(entry); });

    expect(collected).toHaveLength(1);
    expect(collected[0].issueTags).not.toContain('http-5xx');
    expect(collected[0].inferredSeverity).not.toBe('error');
  });

  it('classifies quoted access-log HTTP statuses from the status field only', async () => {
    const path = writeTempFile(
      '[09/May/2026:15:57:00 +0000] 252.177.147.165 - C6135B63D0AC31293BFAD982B55A4BCB "GET /ords/orders HTTP/1.1" 503 507088 565',
      '.log',
    );
    const collected: any[] = [];

    await streamParseConsoleLog(path, async (entry) => { collected.push(entry); });

    expect(collected).toHaveLength(1);
    expect(collected[0].issueTags).toContain('http-5xx');
  });

  it('throws on a non-existent file path', async () => {
    await expect(
      streamParseConsoleLog('/tmp/does-not-exist-xyz-abc.log', async () => {})
    ).rejects.toThrow();
  });
});
