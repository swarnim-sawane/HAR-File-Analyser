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
  originalLevel?: string;
  message: string;
  source?: string;
  stackTrace?: string;
  rawText?: string;
  inferredSeverity?: 'none' | 'warning' | 'error';
  issueTags?: string[];
  primaryIssue?: string;
  classificationReasons?: Array<{
    ruleId: string;
    label: string;
    tag?: string;
    severity?: 'none' | 'warning' | 'error';
    evidence: string;
  }>;
}

const CORS_FAILURE_PATTERN =
  /\b(CORS_BLOCKED|blocked by cors policy|cross-origin request blocked|preflight request[^.\n]*(?:fail|failed|doesn'?t pass|not pass|blocked|denied)|(?:no|missing)\s+['"]?access-control-allow-origin|access control check[^.\n]*(?:fail|failed|doesn'?t pass|not pass|blocked|denied)|cors policy[^.\n]*(?:fail|failed|blocked|denied))\b/i;
const NETWORK_ERROR_PATTERN =
  /\b(failed to fetch|network ?error|net::err_|request failed|load failed|connection (?:refused|reset|timed out)|err_connection|err_failed)\b/i;
const BROWSER_POLICY_PATTERN =
  /\b(autofocus processing was blocked|permissions policy|feature policy|document already has a focused element|refused to (?:load|apply|execute|frame)|content security policy)\b/i;
const EXCEPTION_PATTERN =
  /\b(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|AggregateError|DOMException|SecurityError|NetworkError|cannot read (?:properties|property) of undefined|is not defined|undefined is not|uncaught)\b/i;
const PROMISE_PATTERN =
  /\b(uncaught \(in promise\)|unhandled(?: promise)? rejection|unhandled promise|promise rejection)\b/i;
const REACT_PATTERN =
  /\b(react|react-dom|encountered two children with the same key|each child in a list should have a unique "key"|cannot update a component while rendering)\b/i;
const HTTP_STATUS_UNITS_PATTERN =
  /^(?:ms|msec|millisecond|milliseconds|s|sec|second|seconds|kb|mb|gb|bytes?|px|%)\b/i;
const HTTP_STATUS_EVIDENCE_PATTERNS = [
  /"(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+[^"]+\s+HTTP\/\d(?:\.\d)?"\s+([1-5]\d{2})\b/gi,
  /\bHTTP\/\d(?:\.\d)?\s+([1-5]\d{2})\b/gi,
  /\bHTTP\s+(?:status\s*)?([1-5]\d{2})\b/gi,
  /\b(?:status|statusCode|status_code|httpStatus|http_status)\s*(?:code)?\s*(?:is|was|of|:|=|-)?\s*([1-5]\d{2})\b/gi,
  /\bresponded\s+with\s+(?:an?\s+)?status\s+(?:of\s+)?([1-5]\d{2})\b/gi,
  /\bresponse\s+(?:status\s*)?(?:code\s*)?(?:is|was|of|:|=|-)?\s*([1-5]\d{2})\b/gi,
  /\b(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\S+\s+(?:HTTP\/\d(?:\.\d)?\s+)?([1-5]\d{2})\b/gi,
];

function hasCorsFailureEvidence(text: string): boolean {
  return CORS_FAILURE_PATTERN.test(text);
}

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
    
    const catalinaEntry = parseCatalinaBracketedIsoLine(trimmedLine, index, line);
    if (catalinaEntry) {
      return classifyParsedLogEntry(catalinaEntry);
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

function readLeadingBracketGroups(input: string): { groups: string[]; message: string } {
  const groups: string[] = [];
  let remaining = input;

  while (true) {
    const match = remaining.match(/^\s*\[([^\]]*)\]/);
    if (!match) break;
    groups.push(match[1].trim());
    remaining = remaining.slice(match[0].length);
  }

  return { groups, message: remaining.trim() };
}

function selectServerLogSource(groups: string[]): string | undefined {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group && !/^context\s*:/i.test(group)) {
      return group;
    }
  }

  return undefined;
}

function parseCatalinaBracketedIsoLine(
  trimmedLine: string,
  index: number,
  rawText: string,
): ParsedLogEntry | null {
  const match = trimmedLine.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?)\s+\[(\w+)\]\s+(.+)$/,
  );
  if (!match) {
    return null;
  }

  const { groups, message } = readLeadingBracketGroups(match[3]);
  if (!message) {
    return null;
  }

  return {
    index,
    timestamp: match[1],
    level: match[2].toLowerCase(),
    message,
    source: selectServerLogSource(groups) || 'console',
    rawText,
  };
}

function classifyParsedLogEntry(entry: ParsedLogEntry): ParsedLogEntry {
  const rawText = entry.rawText || entry.message;
  const text = `${entry.message}\n${rawText}\n${entry.stackTrace || ''}`;
  const tags = new Set<string>();
  const originalLevel = entry.originalLevel || entry.level;
  const evidence = text.replace(/\s+/g, ' ').trim().slice(0, 220);
  const classificationReasons: NonNullable<ParsedLogEntry['classificationReasons']> = [];

  const pushReason = (
    ruleId: string,
    label: string,
    tag: string,
    severity: 'warning' | 'error',
  ) => {
    if (classificationReasons.some((reason) => reason.ruleId === ruleId && reason.tag === tag)) {
      return;
    }

    classificationReasons.push({ ruleId, label, tag, severity, evidence });
  };

  if (hasCorsFailureEvidence(text)) {
    tags.add('cors');
    tags.add('network');
    pushReason('cors.failure', 'Explicit CORS failure language', 'cors', 'error');
    pushReason('network.cors', 'Network failure caused by CORS block', 'network', 'error');
  }
  if (NETWORK_ERROR_PATTERN.test(text)) {
    tags.add('network');
    pushReason('network.failure', 'Explicit network failure language', 'network', 'error');
  }
  if (BROWSER_POLICY_PATTERN.test(text)) {
    tags.add('browser-policy');
    pushReason('browser.policy', 'Browser policy restriction', 'browser-policy', 'warning');
  }
  if (EXCEPTION_PATTERN.test(text)) {
    tags.add('exception');
    pushReason('javascript.exception', 'JavaScript exception pattern', 'exception', 'error');
  }
  if (PROMISE_PATTERN.test(text)) {
    tags.add('promise');
    pushReason('javascript.promise', 'Unhandled promise failure', 'promise', 'error');
  }
  if (REACT_PATTERN.test(text)) {
    tags.add('react');
    pushReason('react.warning', 'React runtime warning', 'react', 'warning');
  }

  const httpStatusCodes = extractExplicitHttpStatusCodes(text);
  if (httpStatusCodes.some((code) => code >= 500)) {
    tags.add('http-5xx');
    pushReason('http.status.5xx', 'Explicit HTTP 5xx status', 'http-5xx', 'error');
  } else if (httpStatusCodes.some((code) => code >= 400)) {
    tags.add('http-4xx');
    pushReason('http.status.4xx', 'Explicit HTTP 4xx status', 'http-4xx', 'warning');
  }

  const issueTags = Array.from(tags);
  const inferredSeverity = getInferredSeverity(issueTags, text);

  return {
    ...entry,
    level: resolveDisplayLevel(entry.level, inferredSeverity),
    originalLevel,
    rawText,
    inferredSeverity,
    issueTags,
    primaryIssue: getPrimaryIssue(issueTags),
    classificationReasons,
  };
}

function hasMetricUnitAfterStatus(text: string, statusEndIndex: number): boolean {
  return HTTP_STATUS_UNITS_PATTERN.test(text.slice(statusEndIndex).trimStart());
}

function extractExplicitHttpStatusCodes(text: string): number[] {
  const codes: number[] = [];
  const seen = new Set<string>();

  for (const pattern of HTTP_STATUS_EVIDENCE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const rawCode = match[1];
      if (!rawCode || match.index === undefined) continue;

      const codeStart = match.index + match[0].lastIndexOf(rawCode);
      const codeEnd = codeStart + rawCode.length;
      const code = Number.parseInt(rawCode, 10);

      if (!Number.isFinite(code) || code < 100 || code > 599) continue;
      if (hasMetricUnitAfterStatus(text, codeEnd)) continue;

      const evidenceKey = `${codeStart}:${code}`;
      if (!seen.has(evidenceKey)) {
        seen.add(evidenceKey);
        codes.push(code);
      }
    }
  }

  return codes;
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
