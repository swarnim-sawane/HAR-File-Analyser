// src/utils/consoleLogAiAdapter.ts

import { ConsoleLogFile } from '../types/consolelog';
import { getConsoleDisplayLevel } from './consoleLogSeverity';
import { extractExplicitHttpStatusCodes } from '../../shared/consoleLogCore';

/**
 * Converts Console Log data to a format that AI can understand
 * Similar to HAR format but for console logs
 */
export const adaptConsoleLogForAI = (logData: ConsoleLogFile): any => {
  // Create a HAR-like structure for AI consumption
  return {
    log: {
      version: '1.0',
      creator: {
        name: 'Console Log Analyzer',
        version: '1.0'
      },
      entries: logData.entries.map((entry) => {
        const displayLevel = getConsoleDisplayLevel(entry);
        const evidenceText = entry.rawText || [entry.message, entry.stackTrace].filter(Boolean).join('\n');
        const explicitHttpStatus = extractExplicitHttpStatusCodes(evidenceText)[0] ?? 0;

        return {
          startedDateTime: entry.timestamp,
          time: 0,
          request: {
            method: 'LOG',
            url: entry.source || 'console',
            httpVersion: 'Console/1.0',
            headers: [],
            queryString: [],
            cookies: [],
            headersSize: -1,
            bodySize: -1
          },
          response: {
            status: explicitHttpStatus,
            statusText: explicitHttpStatus > 0 ? `HTTP ${explicitHttpStatus}` : displayLevel.toUpperCase(),
            httpVersion: 'Console/1.0',
            headers: [],
            cookies: [],
            content: {
              size: entry.message.length,
              mimeType: 'text/plain',
              text: JSON.stringify({
                level: displayLevel,
                message: entry.message,
                source: entry.source,
                lineNumber: entry.lineNumber,
                columnNumber: entry.columnNumber,
                stackTrace: entry.stackTrace,
                category: entry.category
              })
            },
            redirectURL: '',
            headersSize: -1,
            bodySize: entry.message.length
          },
          cache: {},
          timings: {
            send: 0,
            wait: 0,
            receive: 0
          },
          _logEntry: {
            ...entry,
            level: displayLevel,
          }
        };
      })
    }
  };
};
