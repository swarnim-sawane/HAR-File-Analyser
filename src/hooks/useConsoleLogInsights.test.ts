import { describe, expect, it } from 'vitest';
import { buildConsoleLogContext } from './useConsoleLogInsights';
import type { ConsoleLogFile } from '../types/consolelog';
import { ConsoleLogParser } from '../utils/consoleLogParser';

function makeConsoleLogFile(messages: Array<{ level: 'log' | 'info' | 'warn' | 'error'; message: string; source?: string }>): ConsoleLogFile {
  return {
    metadata: {
      fileName: '4489716-console.us-ashburn-1.log',
      uploadedAt: '2026-04-27T00:00:00.000Z',
      totalEntries: messages.length,
    },
    entries: messages.map((entry, index) => ({
      id: `log-${index}`,
      timestamp: `2026-04-27T00:00:0${index}.000Z`,
      level: entry.level,
      message: entry.message,
      source: entry.source,
      inferredSeverity: entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warning' : 'info',
      issueTags: [],
    })),
  };
}

describe('buildConsoleLogContext CORS root-cause signals', () => {
  it('promotes log-level CORS preflight failures ahead of unrelated warnings', () => {
    const corsMessage =
      "webapp/:1 Access to fetch at 'https://ords.consolenergy.com/ords/pdbttest/mpr/mpr_module/ceix_mine_location_lov' from origin 'https://vbcs.example.oraclecloud.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.";
    const failedFetchMessage = 'TypeError: Failed to fetch';
    const deprecationWarning =
      'ArrayDataProvider constructor option keyAttributes is deprecated and should be migrated later.';

    const context = buildConsoleLogContext(
      makeConsoleLogFile([
        { level: 'warn', message: deprecationWarning, source: 'oraclejet.js' },
        { level: 'log', message: corsMessage, source: 'webapp/:1' },
        { level: 'error', message: failedFetchMessage, source: 'servicesManager.js' },
      ])
    );

    expect(context).toContain('CORS / PREFLIGHT BLOCKING ERRORS');
    expect(context).toContain('https://ords.consolenergy.com/ords/pdbttest/mpr/mpr_module/ceix_mine_location_lov');
    expect(context).toContain("origin 'https://vbcs.example.oraclecloud.com'");
    expect(context).toContain('Access-Control-Allow-Origin');
    expect(context).toContain('TypeError: Failed to fetch');

    const corsIndex = context.indexOf('CORS / PREFLIGHT BLOCKING ERRORS');
    const warningIndex = context.indexOf('LOW-PRIORITY WARNINGS');

    expect(corsIndex).toBeGreaterThanOrEqual(0);
    expect(warningIndex).toBeGreaterThanOrEqual(0);
    expect(corsIndex).toBeLessThan(warningIndex);
  });

  it('does not promote harmless CORS header counters as blocking evidence', () => {
    const context = buildConsoleLogContext(
      makeConsoleLogFile([
        { level: 'info', message: 'Access-Control-Allow-Origin: count 1' },
      ])
    );

    expect(context).not.toContain('CORS / PREFLIGHT BLOCKING ERRORS');
    expect(context).not.toContain('CORS_BLOCKED');
  });
});

describe('buildConsoleLogContext server error evidence', () => {
  it('includes parsed Catalina JPX errors as concrete analyzer evidence', () => {
    const logData = ConsoleLogParser.parsePlainText(
      [
        '2026-05-09T17:20:53.362Z [INFO] [http-nio-10.89.0.2-8012-exec-2] [Context: {tenantId=7712EB5F949146B4910EB86BD8EBF46F}] [com.oracle.breeze.metrics.HourlyVisitorTrackingFilter@1007] VB_OPID_HOURLY_VISIT: Added one to TenantHourlyPK for URI /rt/warehouse_reception_module/live/resources/data/GantryOblpnInfo Headers: User-Agent = oracle-cloud-rest/21.2.1',
        '2026-05-09T17:20:53.443Z [ERROR] [vb-data-rt-pool-thread-9403] [Context: {tenantId=7712EB5F949146B4910EB86BD8EBF46F}] [oracle.adf.model.log.Jpx@2240] JPX Namespace /sitedef does not have a writable MetadataStore, forcing mMergedJpxPersisted to DISABLE',
      ].join('\n'),
      'catalina.log',
    );

    const context = buildConsoleLogContext(logData);

    expect(context).toContain('ERRORS (1 total)');
    expect(context).toContain('oracle.adf.model.log.Jpx@2240');
    expect(context).toContain('JPX Namespace /sitedef does not have a writable MetadataStore');
  });
});

describe('buildConsoleLogContext HTTP status extraction', () => {
  it('does not report 5xx for successful responses with 500ms timings', () => {
    const context = buildConsoleLogContext(
      makeConsoleLogFile([
        { level: 'warn', message: 'GET /ords/status completed with status 200 in 500ms' },
        { level: 'warn', message: 'response 200 took 503ms for /ords/data' },
      ])
    );

    expect(context).not.toContain('HTTP 5XX SERVER ERRORS IN LOGS');
  });

  it('still reports real 5xx status evidence', () => {
    const context = buildConsoleLogContext(
      makeConsoleLogFile([
        { level: 'error', message: 'GET /ords/orders HTTP/1.1 503 Service Unavailable' },
      ])
    );

    expect(context).toContain('HTTP 5XX SERVER ERRORS IN LOGS');
    expect(context).toContain('503');
  });

  it('does not report 5xx for access-log response sizes after a 200 status', () => {
    const context = buildConsoleLogContext(
      makeConsoleLogFile([
        {
          level: 'warn',
          message:
            '[09/May/2026:15:57:00 +0000] 252.177.147.165 - C6135B63D0AC31293BFAD982B55A4BCB "GET /ic/builder/rt/warehouse_reception_module/live/resources/data/GantryReplenishment?onlyData=true&q=retryStatus2%3D0+and+replenId%3D8206791&limit=23 HTTP/1.1" 200 507088 565',
        },
      ])
    );

    expect(context).not.toContain('HTTP 5XX SERVER ERRORS IN LOGS');
  });

  it('reports real quoted access-log 5xx status evidence', () => {
    const context = buildConsoleLogContext(
      makeConsoleLogFile([
        {
          level: 'error',
          message:
            '[09/May/2026:15:57:00 +0000] 252.177.147.165 - C6135B63D0AC31293BFAD982B55A4BCB "GET /ords/orders HTTP/1.1" 503 507088 565',
        },
      ])
    );

    expect(context).toContain('HTTP 5XX SERVER ERRORS IN LOGS');
  });
});
