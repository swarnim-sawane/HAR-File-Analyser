import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { createGunzip } from 'zlib';
import * as JSONStream from 'jsonstream';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

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

export interface ParsedLogEntry {
  index: number;
  timestamp: string;
  level: string;
  message: string;
  source?: string;
  stackTrace?: string;
  rawText?: string;
  inferredSeverity?: 'none' | 'warning' | 'error';
  issueTags?: string[];
  primaryIssue?: string;
}

const CORS_PATTERN =
  /\b(cors policy|blocked by cors policy|cross-origin request blocked|access-control-allow-origin|preflight request)\b/i;
const NETWORK_ERROR_PATTERN =
  /\b(failed to fetch|network ?error|net::err_|request failed|load failed|connection (?:refused|reset|timed out)|preflight request|err_connection|err_failed)\b/i;
const BROWSER_POLICY_PATTERN =
  /\b(autofocus processing was blocked|permissions policy|feature policy|document already has a focused element|refused to (?:load|apply|execute|frame)|content security policy)\b/i;
const EXCEPTION_PATTERN =
  /\b(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|AggregateError|DOMException|SecurityError|NetworkError|cannot read (?:properties|property) of undefined|is not defined|undefined is not|uncaught)\b/i;
const PROMISE_PATTERN =
  /\b(uncaught \(in promise\)|unhandled(?: promise)? rejection|unhandled promise|promise rejection)\b/i;
const REACT_PATTERN =
  /\b(react|react-dom|encountered two children with the same key|each child in a list should have a unique "key"|cannot update a component while rendering)\b/i;
const HTTP_STATUS_PATTERN = /\b([45]\d{2})\b/g;
const HTTP_CONTEXT_PATTERN =
  /\b(http|status|response|request|fetch|xhr|resource|load resource|preflight|get|post|put|patch|delete|options)\b/i;

/**
 * Stream parse HAR file without loading entire file into memory
 */
export async function streamParseHar(
  filePath: string,
  onEntry: (entry: ParsedHarEntry, index: number) => Promise<void>,
  options?: { compressed?: string }
): Promise<void> {
  let entryIndex = 0;
  const fileStream = createReadStream(filePath);
  const transformStage = new Transform({
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
          connection: entry.connection
        };

        await onEntry(parsedEntry, entryIndex++);

        // Yield to event loop every 1000 entries.
        // The original value of 100 caused ~500 forced context-switches for a
        // 50 000-entry file. On a VM where the event loop is shared with Redis,
        // MongoDB, and Ollama, each setImmediate pause is measurably costly.
        if (entryIndex % 1000 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }

        callback();
      } catch (error) {
        callback(error as Error);
      }
    }
  });

  try {
    if (options?.compressed === 'gzip') {
      await pipeline(fileStream, createGunzip(), JSONStream.parse('log.entries.*'), transformStage);
    } else {
      await pipeline(fileStream, JSONStream.parse('log.entries.*'), transformStage);
    }
  } catch (error) {
    console.error('HAR parsing error:', error);
    throw error;
  }
}

/**
 * Stream parse console log file line by line
 * ✅ FIXED: Better error handling for malformed lines
 */
export async function streamParseConsoleLog(
  filePath: string,
  onLine: (entry: ParsedLogEntry, index: number) => Promise<void>
): Promise<void> {
  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  let lineIndex = 0;
  let skippedLines = 0;
  
  try {
    for await (const line of rl) {
      // ✅ FIXED: Skip empty or whitespace-only lines
      if (!line || !line.trim()) continue;
      
      try {
        const parsed = parseLogLine(line, lineIndex);
        
        // ✅ FIXED: Only call onLine if parsing succeeded
        if (parsed) {
          await onLine(parsed, lineIndex);
        } else {
          skippedLines++;
          // Log occasionally to avoid spam
          if (skippedLines % 100 === 0) {
            console.warn(`Skipped ${skippedLines} unparseable lines so far`);
          }
        }
      } catch (lineError) {
        // ✅ FIXED: Don't throw on individual line errors, just skip
        skippedLines++;
        if (skippedLines <= 10) {
          console.warn(`Skipping unparseable line ${lineIndex}:`, line.substring(0, 100));
        }
      }
      
      lineIndex++;
      
      // Yield to event loop every 1000 lines
      if (lineIndex % 1000 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    
    if (skippedLines > 0) {
      console.log(`ℹ️ Skipped ${skippedLines} unparseable lines out of ${lineIndex} total`);
    }
  } catch (error) {
    console.error('Log parsing error:', error);
    throw error;
  }
}

/**
 * Parse individual log line
 * ✅ FIXED: More robust JSON parsing and error handling
 */
function parseLogLine(line: string, index: number): ParsedLogEntry | null {
  try {
    // ✅ FIXED: Skip empty or whitespace-only lines
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      return null;
    }

    // ✅ FIXED: Try JSON format first, but with better validation
    if (trimmedLine.startsWith('{') && trimmedLine.endsWith('}')) {
      try {
        const json = JSON.parse(trimmedLine);
        
        // ✅ Validate that it's actually a log object
        if (typeof json === 'object' && json !== null) {
          return classifyParsedLogEntry({
            index,
            timestamp: json.timestamp || json.time || json.date || new Date().toISOString(),
            level: (json.level || json.severity || json.type || 'info').toString().toLowerCase(),
            message: json.message || json.msg || json.text || JSON.stringify(json),
            source: json.source || json.logger || json.name || 'console',
            stackTrace: json.stack || json.stackTrace || json.error?.stack,
            rawText: line
          });
        }
      } catch (jsonError) {
        // ✅ FIXED: If JSON parse fails, fall through to regex patterns
        // Don't log error here to avoid spam, will be caught by outer try-catch if needed
      }
    }
    
    // ✅ Common log patterns
    const patterns = [
      // [2024-01-15 10:30:45] ERROR: Message
      /^\[([\d\-\s:.,]+)\]\s+(\w+):\s+(.+)$/,
      // 2024-01-15 10:30:45 ERROR Message
      /^([\d\-\s:.,]+)\s+(\w+)\s+(.+)$/,
      // ERROR: Message (timestamp missing)
      /^(\w+):\s+(.+)$/,
      // [ERROR] Message
      /^\[(\w+)\]\s+(.+)$/
    ];
    
    for (const pattern of patterns) {
      const match = trimmedLine.match(pattern);
      if (match) {
        if (match.length === 4) {
          // Pattern with timestamp and level
          return classifyParsedLogEntry({
            index,
            timestamp: match[1].trim(),
            level: match[2].toLowerCase(),
            message: match[3].trim(),
            source: 'console',
            rawText: line
          });
        } else if (match.length === 3) {
          // Pattern without timestamp
          return classifyParsedLogEntry({
            index,
            timestamp: new Date().toISOString(),
            level: match[1].toLowerCase(),
            message: match[2].trim(),
            source: 'console',
            rawText: line
          });
        }
      }
    }
    
    // ✅ FIXED: Fallback - treat entire line as info message
    // This ensures all lines are captured, even if format is unknown
    return classifyParsedLogEntry({
      index,
      timestamp: new Date().toISOString(),
      level: 'info',
      message: trimmedLine,
      source: 'console',
      rawText: line
    });
    
  } catch (error) {
    // ✅ FIXED: Return null instead of throwing - let caller decide what to do
    console.warn(`Error parsing log line ${index}:`, error);
    return null;
  }
}

function classifyParsedLogEntry(entry: ParsedLogEntry): ParsedLogEntry {
  const rawText = entry.rawText || entry.message;
  const text = `${entry.message}\n${rawText}\n${entry.stackTrace || ''}`;
  const tags = new Set<string>();

  if (CORS_PATTERN.test(text)) {
    tags.add('cors');
    tags.add('network');
  }
  if (NETWORK_ERROR_PATTERN.test(text)) tags.add('network');
  if (BROWSER_POLICY_PATTERN.test(text)) tags.add('browser-policy');
  if (EXCEPTION_PATTERN.test(text)) tags.add('exception');
  if (PROMISE_PATTERN.test(text)) tags.add('promise');
  if (REACT_PATTERN.test(text)) tags.add('react');

  if (HTTP_CONTEXT_PATTERN.test(text)) {
    const codes = Array.from(text.matchAll(HTTP_STATUS_PATTERN))
      .map((match) => Number.parseInt(match[1], 10))
      .filter((code) => Number.isFinite(code));

    if (codes.some((code) => code >= 500)) tags.add('http-5xx');
    else if (codes.some((code) => code >= 400)) tags.add('http-4xx');
  }

  const issueTags = Array.from(tags);
  const inferredSeverity = getInferredSeverity(issueTags, text);

  return {
    ...entry,
    level: resolveDisplayLevel(entry.level, inferredSeverity),
    rawText,
    inferredSeverity,
    issueTags,
    primaryIssue: getPrimaryIssue(issueTags),
  };
}

function getInferredSeverity(issueTags: string[], text: string): 'none' | 'warning' | 'error' {
  if (
    issueTags.includes('cors') ||
    issueTags.includes('exception') ||
    issueTags.includes('promise') ||
    issueTags.includes('http-5xx') ||
    (issueTags.includes('network') && NETWORK_ERROR_PATTERN.test(text))
  ) {
    return 'error';
  }

  if (
    issueTags.includes('browser-policy') ||
    issueTags.includes('react') ||
    issueTags.includes('http-4xx')
  ) {
    return 'warning';
  }

  return 'none';
}

function resolveDisplayLevel(level: string, inferredSeverity: 'none' | 'warning' | 'error'): string {
  if (inferredSeverity === 'error') return 'error';
  if (inferredSeverity === 'warning' && level !== 'error' && level !== 'warn') return 'warn';
  return level;
}

function getPrimaryIssue(issueTags: string[]): string | undefined {
  return ['cors', 'http-5xx', 'promise', 'exception', 'network', 'http-4xx', 'react', 'browser-policy']
    .find((tag) => issueTags.includes(tag));
}

/**
 * Convert entry to text for embedding
 */
export function harEntryToText(entry: ParsedHarEntry): string {
  const parts = [
    `Request: ${entry.request?.method} ${entry.request?.url}`,
    `Status: ${entry.response?.status} ${entry.response?.statusText}`,
    `Time: ${entry.time}ms`,
    `Size: ${entry.response?.bodySize || 0} bytes`
  ];
  
  if (entry.response?.content?.mimeType) {
    parts.push(`Type: ${entry.response.content.mimeType}`);
  }
  
  return parts.join(' | ');
}

export function logEntryToText(entry: ParsedLogEntry): string {
  return `[${entry.level.toUpperCase()}] ${entry.message}`;
}
