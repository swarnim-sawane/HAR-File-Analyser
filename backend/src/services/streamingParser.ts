import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import * as JSONStream from 'jsonstream';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { ConsoleTextEventParser, type SharedConsoleLogEntryCore } from '../../../shared/consoleLogCore';

export interface ParsedHarEntry {
  index: number;
  startedDateTime: string;
  time: number;
  request: any;
  response: any;
  cache: any;
  timings: any;
  serverIPAddress?: string;
  connection?: string;
}

export interface ParsedLogEntry extends SharedConsoleLogEntryCore {
  index: number;
}

/**
 * Stream parse HAR file without loading entire file into memory
 */
export async function streamParseHar(
  filePath: string,
  onEntry: (entry: ParsedHarEntry, index: number) => Promise<void>,
): Promise<void> {
  let entryIndex = 0;

  try {
    await pipeline(
      createReadStream(filePath),
      JSONStream.parse('log.entries.*'),
      new Transform({
        objectMode: true,
        async transform(entry, encoding, callback) {
          try {
            const parsedEntry: ParsedHarEntry = {
              index: entryIndex,
              startedDateTime: entry.startedDateTime,
              time: entry.time,
              request: entry.request,
              response: entry.response,
              cache: entry.cache,
              timings: entry.timings,
              serverIPAddress: entry.serverIPAddress,
              connection: entry.connection,
            };

            await onEntry(parsedEntry, entryIndex);
            entryIndex += 1;

            if (entryIndex % 1000 === 0) {
              await new Promise((resolve) => setImmediate(resolve));
            }

            callback();
          } catch (error) {
            callback(error as Error);
          }
        },
      }),
    );
  } catch (error) {
    console.error('HAR parsing error:', error);
    throw error;
  }
}

/**
 * Stream parse console log file while preserving multiline browser events.
 */
export async function streamParseConsoleLog(
  filePath: string,
  onLine: (entry: ParsedLogEntry, index: number) => Promise<void>,
): Promise<void> {
  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const parser = new ConsoleTextEventParser();
  let lineIndex = 0;
  let entryIndex = 0;

  try {
    for await (const line of rl) {
      if (line && line.trim()) {
        const completedEntries = parser.pushLine(line);
        for (const entry of completedEntries) {
          await onLine(
            {
              index: entryIndex,
              ...entry,
            },
            entryIndex,
          );
          entryIndex += 1;
        }
      }

      lineIndex += 1;
      if (lineIndex % 1000 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    const finalEntries = parser.flush();
    for (const entry of finalEntries) {
      await onLine(
        {
          index: entryIndex,
          ...entry,
        },
        entryIndex,
      );
      entryIndex += 1;
    }
  } catch (error) {
    console.error('Log parsing error:', error);
    throw error;
  }
}

/**
 * Convert entry to text for embedding
 */
export function harEntryToText(entry: ParsedHarEntry): string {
  const parts = [
    `Request: ${entry.request?.method} ${entry.request?.url}`,
    `Status: ${entry.response?.status} ${entry.response?.statusText}`,
    `Time: ${entry.time}ms`,
    `Size: ${entry.response?.bodySize || 0} bytes`,
  ];

  if (entry.response?.content?.mimeType) {
    parts.push(`Type: ${entry.response.content.mimeType}`);
  }

  return parts.join(' | ');
}

export function logEntryToText(entry: ParsedLogEntry): string {
  return `[${entry.level.toUpperCase()}] ${entry.rawText || entry.message}`;
}
