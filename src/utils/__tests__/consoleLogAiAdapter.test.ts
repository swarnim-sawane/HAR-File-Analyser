import { describe, expect, it } from 'vitest';
import type { ConsoleLogFile } from '../../types/consolelog';
import { adaptConsoleLogForAI } from '../consoleLogAiAdapter';

function makeLog(message: string, overrides: Partial<ConsoleLogFile['entries'][number]> = {}): ConsoleLogFile {
  return {
    metadata: {
      fileName: 'console.log',
      uploadedAt: '2026-05-13T00:00:00.000Z',
      totalEntries: 1,
    },
    entries: [
      {
        id: 'entry-1',
        index: 0,
        timestamp: '2026-05-13T00:00:00.000Z',
        level: 'error',
        message,
        rawText: message,
        inferredSeverity: 'error',
        issueTags: [],
        ...overrides,
      },
    ],
  };
}

describe('consoleLogAiAdapter HTTP status mapping', () => {
  it('does not fabricate HTTP 500 for generic console errors', () => {
    const adapted = adaptConsoleLogForAI(
      makeLog('TypeError: Cannot read properties of undefined'),
    );

    expect(adapted.log.entries[0].response.status).toBe(0);
  });

  it('uses explicit HTTP status evidence when present', () => {
    const adapted = adaptConsoleLogForAI(
      makeLog('GET /ords/orders HTTP/1.1 503 Service Unavailable'),
    );

    expect(adapted.log.entries[0].response.status).toBe(503);
  });

  it('does not use access-log response size as the HTTP response status', () => {
    const adapted = adaptConsoleLogForAI(
      makeLog(
        '[09/May/2026:15:57:00 +0000] 252.177.147.165 - C6135B63D0AC31293BFAD982B55A4BCB "GET /ic/builder/rt/warehouse_reception_module/live/resources/data/GantryReplenishment?onlyData=true&q=retryStatus2%3D0+and+replenId%3D8206791&limit=23 HTTP/1.1" 200 507088 565',
      ),
    );

    expect(adapted.log.entries[0].response.status).toBe(200);
  });
});
