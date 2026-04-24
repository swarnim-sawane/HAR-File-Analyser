// src/utils/consoleLogParser.ts

import { v4 as uuidv4 } from 'uuid';
import { parseConsoleText, normalizeStructuredConsoleEntry } from '../../shared/consoleLogCore';
import { ConsoleLogEntry, ConsoleLogFile } from '../types/consolelog';

export class ConsoleLogParser {
  static parseJSON(content: string, fileName: string): ConsoleLogFile {
    try {
      const parsed = JSON.parse(content) as
        | { metadata?: Record<string, unknown>; entries?: unknown[]; logs?: unknown[] }
        | unknown[];

      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'metadata' in parsed &&
        'entries' in parsed &&
        Array.isArray(parsed.entries)
      ) {
        const entries = parsed.entries.map((entry, index) =>
          this.toConsoleLogEntry((entry ?? {}) as Record<string, unknown>, index),
        );

        return {
          metadata: {
            fileName:
              typeof parsed.metadata?.fileName === 'string' ? parsed.metadata.fileName : fileName,
            uploadedAt:
              typeof parsed.metadata?.uploadedAt === 'string'
                ? parsed.metadata.uploadedAt
                : new Date().toISOString(),
            totalEntries:
              typeof parsed.metadata?.totalEntries === 'number'
                ? parsed.metadata.totalEntries
                : entries.length,
            browser:
              typeof parsed.metadata?.browser === 'string' ? parsed.metadata.browser : undefined,
            version:
              typeof parsed.metadata?.version === 'string' ? parsed.metadata.version : undefined,
            truncatedAt:
              typeof parsed.metadata?.truncatedAt === 'number'
                ? parsed.metadata.truncatedAt
                : undefined,
          },
          entries,
        };
      }

      if (Array.isArray(parsed)) {
        return this.parseJSONArray(parsed, fileName);
      }

      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'logs' in parsed &&
        Array.isArray(parsed.logs)
      ) {
        return this.parseJSONArray(parsed.logs, fileName);
      }

      throw new Error('Unrecognized JSON format');
    } catch (error) {
      throw new Error(
        `Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private static parseJSONArray(logs: unknown[], fileName: string): ConsoleLogFile {
    const entries = logs.map((log, index) =>
      this.toConsoleLogEntry((log ?? {}) as Record<string, unknown>, index),
    );

    return {
      metadata: {
        fileName,
        uploadedAt: new Date().toISOString(),
        totalEntries: entries.length,
      },
      entries,
    };
  }

  private static toConsoleLogEntry(
    log: Record<string, unknown>,
    index: number,
  ): ConsoleLogEntry {
    const normalized = normalizeStructuredConsoleEntry(log, new Date().toISOString());
    const id =
      typeof log.id === 'string'
        ? log.id
        : typeof log._id === 'string'
          ? log._id
          : uuidv4();

    return {
      id,
      index: typeof log.index === 'number' ? log.index : index,
      _id: typeof log._id === 'string' ? log._id : undefined,
      fileId: typeof log.fileId === 'string' ? log.fileId : undefined,
      ...normalized,
    };
  }

  static parsePlainText(content: string, fileName: string): ConsoleLogFile {
    const entries = parseConsoleText(content).map((entry, index) => ({
      id: uuidv4(),
      index,
      ...entry,
    }));

    return {
      metadata: {
        fileName,
        uploadedAt: new Date().toISOString(),
        totalEntries: entries.length,
      },
      entries,
    };
  }

  static async parseFile(file: File): Promise<ConsoleLogFile> {
    const content = await file.text();

    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
      try {
        return this.parseJSON(content, file.name);
      } catch {
        // Fall back to plain text parsing when JSON parsing fails.
      }
    }

    return this.parsePlainText(content, file.name);
  }
}
