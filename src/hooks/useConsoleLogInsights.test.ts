import { describe, expect, it } from 'vitest';
import { buildConsoleLogContext } from './useConsoleLogInsights';
import type { ConsoleLogFile } from '../types/consolelog';

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
});
