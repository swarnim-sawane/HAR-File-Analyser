export type SharedLogLevel =
  | 'log'
  | 'info'
  | 'warn'
  | 'error'
  | 'debug'
  | 'trace'
  | 'verbose';

export type ConsoleIssueTag =
  | 'cors'
  | 'network'
  | 'exception'
  | 'promise'
  | 'react'
  | 'browser-policy'
  | 'http-4xx'
  | 'http-5xx';

export type ConsoleInferredSeverity = 'none' | 'warning' | 'error';

export interface SharedConsoleLogEntryCore {
  timestamp: string;
  level: SharedLogLevel;
  message: string;
  source?: string;
  lineNumber?: number;
  columnNumber?: number;
  stackTrace?: string;
  args?: unknown[];
  url?: string;
  category?: string;
  rawText: string;
  inferredSeverity: ConsoleInferredSeverity;
  issueTags: ConsoleIssueTag[];
  primaryIssue?: ConsoleIssueTag;
}

type CoreDraft = Omit<
  SharedConsoleLogEntryCore,
  'rawText' | 'inferredSeverity' | 'issueTags' | 'primaryIssue'
> & {
  rawText?: string;
  inferredSeverity?: ConsoleInferredSeverity;
  issueTags?: ConsoleIssueTag[];
  primaryIssue?: ConsoleIssueTag;
};

interface ParsedHeader extends Partial<CoreDraft> {
  message: string;
  explicit: boolean;
}

interface DraftEvent {
  header: ParsedHeader;
  lines: string[];
  stackLines: string[];
}

const VALID_LEVELS = new Set<SharedLogLevel>([
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'verbose',
]);

const LEVEL_MAP: Record<string, SharedLogLevel> = {
  warning: 'warn',
  err: 'error',
  fatal: 'error',
  critical: 'error',
  panic: 'error',
  information: 'info',
  inf: 'info',
  dbg: 'debug',
  notice: 'info',
  emerg: 'error',
  emergency: 'error',
  alert: 'error',
  crit: 'error',
  notification: 'info',
  severe: 'error',
  incident_error: 'error',
  incident: 'error',
};

const JS_EXCEPTION_NAMES = [
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'URIError',
  'EvalError',
  'AggregateError',
  'DOMException',
  'SecurityError',
  'NetworkError',
];

const PRIMARY_ISSUE_PRIORITY: ConsoleIssueTag[] = [
  'cors',
  'http-5xx',
  'promise',
  'exception',
  'network',
  'http-4xx',
  'react',
  'browser-policy',
];

const LOCATION_PATTERN = /((?:https?:\/\/)?[^()\s]+):(\d+)(?::(\d+))?/g;
const HTTP_STATUS_PATTERN = /\b([45]\d{2})\b/g;
const HTTP_CONTEXT_PATTERN =
  /\b(http|status|response|request|fetch|xhr|resource|load resource|preflight|get|post|put|patch|delete|options)\b/i;
const NETWORK_ERROR_PATTERN =
  /\b(failed to fetch|network ?error|net::err_|request failed|load failed|connection (?:refused|reset|timed out)|preflight request|err_connection|err_failed)\b/i;
const CORS_PATTERN =
  /\b(cors policy|blocked by cors policy|cross-origin request blocked|access-control-allow-origin|preflight request)\b/i;
const PROMISE_PATTERN =
  /\b(uncaught \(in promise\)|unhandled(?: promise)? rejection|unhandled promise|promise rejection)\b/i;
const REACT_PATTERN =
  /\b(react|react-dom|encountered two children with the same key|each child in a list should have a unique "key"|cannot update a component while rendering)\b/i;
const BROWSER_POLICY_PATTERN =
  /\b(autofocus processing was blocked|permissions policy|feature policy|document already has a focused element|refused to (?:load|apply|execute|frame)|content security policy)\b/i;
const EXCEPTION_PATTERN = new RegExp(
  `\\b(${JS_EXCEPTION_NAMES.join('|')}|cannot read (?:properties|property) of undefined|is not defined|undefined is not)\\b`,
  'i',
);

export function normalizeLogLevel(level: unknown): SharedLogLevel {
  const normalized = typeof level === 'string' ? level.toLowerCase().trim() : '';
  if (VALID_LEVELS.has(normalized as SharedLogLevel)) {
    return normalized as SharedLogLevel;
  }
  return LEVEL_MAP[normalized] || 'log';
}

export function normalizeTimestamp(timestamp: unknown, fallback = new Date().toISOString()): string {
  if (typeof timestamp !== 'string' || !timestamp.trim()) {
    return fallback;
  }

  try {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  } catch {
    // Keep the original text when the date parser cannot normalize it.
  }

  if (/^\d{2}:\d{2}:\d{2}/.test(timestamp)) {
    const today = fallback.split('T')[0] ?? new Date().toISOString().split('T')[0];
    return `${today}T${timestamp.replace(',', '.')}Z`;
  }

  return timestamp;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  const stringValue = asString(value);
  if (!stringValue) {
    return undefined;
  }

  const trimmed = stringValue.trim();
  return trimmed ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return undefined;
  }

  return [value];
}

function stringifyArg(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildRawText(entry: CoreDraft): string {
  const explicitRawText = asString(entry.rawText);
  if (explicitRawText && explicitRawText.trim()) {
    return explicitRawText;
  }

  const parts: string[] = [];

  if (entry.message?.trim()) {
    parts.push(entry.message);
  }

  if (entry.stackTrace?.trim()) {
    parts.push(entry.stackTrace);
  }

  if (entry.args?.length) {
    const argBlock = entry.args.map((arg) => stringifyArg(arg)).join('\n');
    if (argBlock.trim()) {
      parts.push(argBlock);
    }
  }

  return parts.join('\n').trim();
}

function uniqueTags(tags: Iterable<ConsoleIssueTag>): ConsoleIssueTag[] {
  return Array.from(new Set(tags));
}

function severityRank(severity: ConsoleInferredSeverity): number {
  switch (severity) {
    case 'error':
      return 2;
    case 'warning':
      return 1;
    default:
      return 0;
  }
}

function determinePrimaryIssue(tags: ConsoleIssueTag[], suggested?: ConsoleIssueTag): ConsoleIssueTag | undefined {
  if (suggested && tags.includes(suggested)) {
    return suggested;
  }

  return PRIMARY_ISSUE_PRIORITY.find((tag) => tags.includes(tag));
}

function determineSeverity(tags: ConsoleIssueTag[], textLower: string): ConsoleInferredSeverity {
  if (
    tags.includes('cors') ||
    tags.includes('exception') ||
    tags.includes('promise') ||
    tags.includes('http-5xx') ||
    (tags.includes('network') && NETWORK_ERROR_PATTERN.test(textLower))
  ) {
    return 'error';
  }

  if (tags.includes('react') || tags.includes('browser-policy') || tags.includes('http-4xx')) {
    return 'warning';
  }

  return 'none';
}

function findHttpIssueTag(text: string): ConsoleIssueTag | undefined {
  if (!HTTP_CONTEXT_PATTERN.test(text)) {
    return undefined;
  }

  const matches = Array.from(text.matchAll(HTTP_STATUS_PATTERN));
  if (!matches.length) {
    return undefined;
  }

  const codes = matches
    .map((match) => Number.parseInt(match[1], 10))
    .filter((code) => Number.isFinite(code));

  if (codes.some((code) => code >= 500)) {
    return 'http-5xx';
  }

  if (codes.some((code) => code >= 400 && code < 500)) {
    return 'http-4xx';
  }

  return undefined;
}

export function classifyConsoleEvent<T extends CoreDraft>(
  entry: T,
): T & Pick<SharedConsoleLogEntryCore, 'rawText' | 'inferredSeverity' | 'issueTags' | 'primaryIssue'> {
  const rawText = buildRawText(entry);
  const text = `${entry.message ?? ''}\n${rawText}`.trim();
  const lowerText = text.toLowerCase();
  const existingTags = Array.isArray(entry.issueTags) ? entry.issueTags : [];
  const tags = new Set<ConsoleIssueTag>(existingTags);

  if (CORS_PATTERN.test(text)) {
    tags.add('cors');
    tags.add('network');
  }

  if (NETWORK_ERROR_PATTERN.test(text)) {
    tags.add('network');
  }

  if (PROMISE_PATTERN.test(text)) {
    tags.add('promise');
  }

  if (REACT_PATTERN.test(text)) {
    tags.add('react');
  }

  if (BROWSER_POLICY_PATTERN.test(text)) {
    tags.add('browser-policy');
  }

  if (EXCEPTION_PATTERN.test(text) || /\buncaught\b/i.test(text)) {
    tags.add('exception');
  }

  const httpIssue = findHttpIssueTag(text);
  if (httpIssue) {
    tags.add(httpIssue);
  }

  const issueTags = uniqueTags(tags);
  const inferredSeverity =
    severityRank(entry.inferredSeverity ?? 'none') > severityRank(determineSeverity(issueTags, lowerText))
      ? (entry.inferredSeverity ?? 'none')
      : determineSeverity(issueTags, lowerText);
  const primaryIssue = determinePrimaryIssue(issueTags, entry.primaryIssue);

  return {
    ...entry,
    rawText,
    inferredSeverity,
    issueTags,
    primaryIssue,
  };
}

export function normalizeStructuredConsoleEntry(
  entry: Record<string, unknown>,
  fallbackTimestamp = new Date().toISOString(),
): SharedConsoleLogEntryCore {
  const message =
    asString(entry.message) ??
    asString(entry.msg) ??
    asString(entry.text) ??
    JSON.stringify(entry);

  const stackTrace =
    asString(entry.stackTrace) ??
    asString(entry.stack) ??
    asString(entry.trace) ??
    (typeof entry.error === 'object' && entry.error
      ? asString((entry.error as Record<string, unknown>).stack)
      : undefined);

  const source =
    asTrimmedString(entry.source) ??
    asTrimmedString(entry.file) ??
    asTrimmedString(entry.filename) ??
    asTrimmedString(entry.logger) ??
    asTrimmedString(entry.name);

  const normalized = classifyConsoleEvent({
    timestamp: normalizeTimestamp(
      entry.timestamp ?? entry.time ?? entry.timeStamp ?? entry.date,
      fallbackTimestamp,
    ),
    level: normalizeLogLevel(entry.level ?? entry.type ?? entry.severity),
    message,
    source,
    lineNumber: asNumber(entry.lineNumber ?? entry.line ?? entry.lineno),
    columnNumber: asNumber(entry.columnNumber ?? entry.column ?? entry.colno),
    stackTrace,
    args: asArray(entry.args ?? entry.arguments ?? entry.data),
    url:
      asTrimmedString(entry.url) ??
      asTrimmedString(entry.uri) ??
      asTrimmedString(entry.location),
    category: asTrimmedString(entry.category) ?? asTrimmedString(entry.tag),
    rawText: asString(entry.rawText),
    issueTags: Array.isArray(entry.issueTags)
      ? (entry.issueTags.filter((tag): tag is ConsoleIssueTag =>
          typeof tag === 'string' && PRIMARY_ISSUE_PRIORITY.includes(tag as ConsoleIssueTag),
        ) as ConsoleIssueTag[])
      : undefined,
    inferredSeverity:
      entry.inferredSeverity === 'error' || entry.inferredSeverity === 'warning'
        ? (entry.inferredSeverity as ConsoleInferredSeverity)
        : 'none',
    primaryIssue:
      typeof entry.primaryIssue === 'string' &&
      PRIMARY_ISSUE_PRIORITY.includes(entry.primaryIssue as ConsoleIssueTag)
        ? (entry.primaryIssue as ConsoleIssueTag)
        : undefined,
  });

  if ((!normalized.source || normalized.lineNumber === undefined) && normalized.stackTrace) {
    const sourceInfo = extractSourceInfo(normalized.stackTrace);
    return {
      ...normalized,
      source: normalized.source ?? sourceInfo.source,
      lineNumber: normalized.lineNumber ?? sourceInfo.lineNumber,
      columnNumber: normalized.columnNumber ?? sourceInfo.columnNumber,
      url: normalized.url ?? sourceInfo.url,
    };
  }

  return normalized;
}

function isJsonLogLine(line: string): boolean {
  return line.startsWith('{') && line.endsWith('}');
}

function isLogLevelWord(level: string): boolean {
  const normalized = level.toLowerCase().trim();
  return VALID_LEVELS.has(normalized as SharedLogLevel) || normalized in LEVEL_MAP;
}

function looksLikeSourceCandidate(source: string): boolean {
  return (
    /[/.?]/.test(source) ||
    /^(?:https?:|webpack:|blob:|file:|localhost)/i.test(source) ||
    /^<anonymous>$/i.test(source) ||
    /^VM\d+$/i.test(source)
  );
}

function extractSourceInfo(text: string): Partial<SharedConsoleLogEntryCore> {
  const matches = Array.from(text.matchAll(LOCATION_PATTERN));
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const [, sourceCandidate, lineNumber, columnNumber] = matches[index];
    if (!sourceCandidate || !looksLikeSourceCandidate(sourceCandidate)) {
      continue;
    }

    return {
      source: sourceCandidate,
      url: /^https?:\/\//i.test(sourceCandidate) ? sourceCandidate : undefined,
      lineNumber: Number.parseInt(lineNumber, 10),
      columnNumber: columnNumber ? Number.parseInt(columnNumber, 10) : undefined,
    };
  }

  return {};
}

export function isStackTraceLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('at ') ||
    /^\s+at\s+/.test(line) ||
    /^\s+\w+@/.test(line) ||
    /^[\w$.()\s<>]+\s*@\s*\S+:\d+/.test(trimmed) ||
    /^\(anonymous\)\s*@\s*\S+:\d+/.test(trimmed) ||
    /^Promise\.(then|catch|finally|all|race|allSettled|any)$/.test(trimmed)
  );
}

function extractOdlRest(rest: string): { message: string; attrs: Record<string, string> } {
  const attrs: Record<string, string> = {};
  const source = rest.trimStart();
  let cursor = 0;
  let messageStart = 0;

  while (cursor < source.length) {
    if (source[cursor] !== '[') {
      messageStart = cursor;
      break;
    }

    let depth = 1;
    let end = cursor + 1;
    while (end < source.length && depth > 0) {
      if (source[end] === '[') depth += 1;
      else if (source[end] === ']') depth -= 1;
      end += 1;
    }

    const content = source.slice(cursor + 1, end - 1);
    const separatorIndex = content.indexOf(': ');
    if (separatorIndex > 0) {
      attrs[content.slice(0, separatorIndex).trim()] = content.slice(separatorIndex + 2);
    }

    cursor = end;
    while (cursor < source.length && source[cursor] === ' ') {
      cursor += 1;
    }
    messageStart = cursor;
  }

  return {
    message: source.slice(messageStart).trim(),
    attrs,
  };
}

function parseExceptionHeader(line: string, nowFactory: () => string): ParsedHeader | null {
  const trimmed = line.trim();
  const exceptionPattern = new RegExp(
    `^(Uncaught(?: \\([^)]+\\))?|Unhandled(?: Promise(?: Rejection)?)?|${JS_EXCEPTION_NAMES.join(
      '|',
    )})\\b`,
    'i',
  );

  if (!exceptionPattern.test(trimmed)) {
    return null;
  }

  return {
    explicit: true,
    timestamp: nowFactory(),
    level: 'error',
    message: trimmed,
  };
}

function parseOdlLine(line: string): ParsedHeader | null {
  const odlPattern =
    /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*[+-]\d{2}:\d{2})\]\s+\[([^\]]*)\]\s+\[(\w+(?::\d+)?)\]\s+\[([^\]]*)\]\s+\[([^\]]*)\]\s*([\s\S]*)$/;
  const match = line.match(odlPattern);
  if (!match) {
    return null;
  }

  const [, rawTimestamp, component, rawLevel, messageId, logger, rest] = match;
  const { message, attrs } = extractOdlRest(rest);
  const normalizedLevel = normalizeLogLevel(rawLevel.split(':')[0]);
  const trimmedMessageId = messageId.trim();
  const fullMessage =
    trimmedMessageId && !message.startsWith(`[${trimmedMessageId}]`)
      ? `[${trimmedMessageId}] ${message}`
      : message;

  return {
    explicit: true,
    timestamp: normalizeTimestamp(rawTimestamp),
    level: normalizedLevel,
    source: logger.trim() || component.trim() || undefined,
    message: fullMessage || `[${component}] ${rawLevel}`,
    category: attrs.APP || attrs.app,
  };
}

function parseVbLine(line: string, nowFactory: () => string): ParsedHeader | null {
  const sourcePrefixedPattern = /^(\S+\.js:\d+)\s+\[VB \((\w+)\),\s*([^\]]+)\]:\s*(.+)$/;
  const sourcePrefixedMatch = line.match(sourcePrefixedPattern);
  if (sourcePrefixedMatch) {
    const [, fileLocation, rawLevel, modulePath, message] = sourcePrefixedMatch;
    const sourceInfo = extractSourceInfo(fileLocation);
    return {
      explicit: true,
      timestamp: nowFactory(),
      level: normalizeLogLevel(rawLevel),
      source: modulePath.trim(),
      lineNumber: sourceInfo.lineNumber,
      columnNumber: sourceInfo.columnNumber,
      message: message.trim(),
    };
  }

  const vbPattern = /^\[VB \((\w+)\),\s*([^\]]+)\]:\s*(.+)$/;
  const vbMatch = line.match(vbPattern);
  if (!vbMatch) {
    return null;
  }

  return {
    explicit: true,
    timestamp: nowFactory(),
    level: normalizeLogLevel(vbMatch[1]),
    source: vbMatch[2].trim(),
    message: vbMatch[3].trim(),
  };
}

function parseGenericComponentLine(line: string, nowFactory: () => string): ParsedHeader | null {
  const componentPattern = /^\[(\w[\w\s]*)\s*\((\w+)\),\s*([^\]]*)\]:\s*(.+)$/;
  const match = line.match(componentPattern);
  if (!match) {
    return null;
  }

  if (!isLogLevelWord(match[2])) {
    return null;
  }

  return {
    explicit: true,
    timestamp: nowFactory(),
    level: normalizeLogLevel(match[2]),
    source: match[3].trim() || match[1],
    message: match[4].trim(),
  };
}

function parseChromeLine(line: string): ParsedHeader | null {
  const chromePattern = /^\[([^\]]+)\]\s*(\w+):\s*(.+)$/;
  const match = line.match(chromePattern);
  if (!match || !isLogLevelWord(match[2])) {
    return null;
  }

  return {
    explicit: true,
    timestamp: normalizeTimestamp(match[1]),
    level: normalizeLogLevel(match[2]),
    message: match[3].trim(),
  };
}

function parseBrowserUrlLine(line: string, nowFactory: () => string): ParsedHeader | null {
  const browserPattern = /^(\w+):\s*(.+?)\s+(https?:\/\/[^\s]+):(\d+):(\d+)$/;
  const match = line.match(browserPattern);
  if (!match || !isLogLevelWord(match[1])) {
    return null;
  }

  return {
    explicit: true,
    timestamp: nowFactory(),
    level: normalizeLogLevel(match[1]),
    message: match[2].trim(),
    url: match[3],
    source: match[3],
    lineNumber: Number.parseInt(match[4], 10),
    columnNumber: Number.parseInt(match[5], 10),
  };
}

function parseIsoLine(line: string): ParsedHeader | null {
  const isoPattern =
    /^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?)\s+(\w+)\s+(.+)$/;
  const match = line.match(isoPattern);
  if (!match || !isLogLevelWord(match[2])) {
    return null;
  }

  return {
    explicit: true,
    timestamp: normalizeTimestamp(match[1]),
    level: normalizeLogLevel(match[2]),
    message: match[3].trim(),
  };
}

function parseUnixLine(line: string): ParsedHeader | null {
  const unixPattern = /^(\d{10,13})\s+(\w+)\s+(.+)$/;
  const match = line.match(unixPattern);
  if (!match || !isLogLevelWord(match[2])) {
    return null;
  }

  const rawTimestamp = Number.parseInt(match[1], 10);
  const normalizedTimestamp =
    rawTimestamp > 10_000_000_000 ? new Date(rawTimestamp) : new Date(rawTimestamp * 1_000);

  return {
    explicit: true,
    timestamp: normalizedTimestamp.toISOString(),
    level: normalizeLogLevel(match[2]),
    message: match[3].trim(),
  };
}

function parseSourceLevelLine(line: string, nowFactory: () => string): ParsedHeader | null {
  const sourcePattern = /^(\w+)[:\s]+(?:(.+?)\s+at\s+)?(.+?):(\d+):(\d+)\s*(.*)$/;
  const match = line.match(sourcePattern);
  if (!match || !isLogLevelWord(match[1])) {
    return null;
  }

  return {
    explicit: true,
    timestamp: nowFactory(),
    level: normalizeLogLevel(match[1]),
    message: (match[2] || match[6] || '').trim(),
    source: match[3],
    lineNumber: Number.parseInt(match[4], 10),
    columnNumber: Number.parseInt(match[5], 10),
  };
}

function parseSimpleLevelLine(line: string, nowFactory: () => string): ParsedHeader | null {
  const simplePattern = /^[\[]?(\w+)[\]]?:\s*(.+)$/;
  const match = line.match(simplePattern);
  if (!match || !isLogLevelWord(match[1])) {
    return null;
  }

  return {
    explicit: true,
    timestamp: nowFactory(),
    level: normalizeLogLevel(match[1]),
    message: match[2].trim(),
  };
}

function parseTimeLine(line: string, nowFactory: () => string): ParsedHeader | null {
  const timePattern = /^(\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?)\s+(\w+)\s+(.+)$/;
  const match = line.match(timePattern);
  if (!match || !isLogLevelWord(match[2])) {
    return null;
  }

  return {
    explicit: true,
    timestamp: normalizeTimestamp(match[1], nowFactory()),
    level: normalizeLogLevel(match[2]),
    message: match[3].trim(),
  };
}

function parseLevelWordLine(line: string, nowFactory: () => string): ParsedHeader | null {
  const levelWordPattern = /^(\w+)\s+(.+)$/;
  const match = line.match(levelWordPattern);
  if (!match || !isLogLevelWord(match[1])) {
    return null;
  }

  return {
    explicit: true,
    timestamp: nowFactory(),
    level: normalizeLogLevel(match[1]),
    message: match[2].trim(),
  };
}

function parseSourcePrefixedBrowserLine(line: string, nowFactory: () => string): ParsedHeader | null {
  const sourcePrefixedPattern = /^(.+?):(\d+)(?::(\d+))?\s+(.+)$/;
  const match = line.match(sourcePrefixedPattern);
  if (!match) {
    return null;
  }

  const source = match[1].trim();
  if (!looksLikeSourceCandidate(source)) {
    return null;
  }

  const message = match[4].trim();
  const lowerMessage = message.toLowerCase();
  const inferredLevel =
    PROMISE_PATTERN.test(message) ||
    EXCEPTION_PATTERN.test(message) ||
    lowerMessage.startsWith('uncaught')
      ? 'error'
      : 'log';

  return {
    explicit: true,
    timestamp: nowFactory(),
    level: inferredLevel,
    source,
    lineNumber: Number.parseInt(match[2], 10),
    columnNumber: match[3] ? Number.parseInt(match[3], 10) : undefined,
    url: /^https?:\/\//i.test(source) ? source : undefined,
    message,
  };
}

function parseJsonHeaderLine(line: string, nowFactory: () => string): ParsedHeader | null {
  if (!isJsonLogLine(line)) {
    return null;
  }

  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const normalized = normalizeStructuredConsoleEntry(parsed, nowFactory());
    return {
      ...normalized,
      explicit: true,
      message: normalized.message,
    };
  } catch {
    return null;
  }
}

function parseConsoleHeaderLine(line: string, nowFactory: () => string): ParsedHeader | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  return (
    parseJsonHeaderLine(trimmed, nowFactory) ||
    parseOdlLine(trimmed) ||
    parseVbLine(trimmed, nowFactory) ||
    parseGenericComponentLine(trimmed, nowFactory) ||
    parseChromeLine(trimmed) ||
    parseBrowserUrlLine(trimmed, nowFactory) ||
    parseIsoLine(trimmed) ||
    parseUnixLine(trimmed) ||
    parseSourcePrefixedBrowserLine(trimmed, nowFactory) ||
    parseExceptionHeader(trimmed, nowFactory) ||
    parseSourceLevelLine(trimmed, nowFactory) ||
    parseSimpleLevelLine(trimmed, nowFactory) ||
    parseTimeLine(trimmed, nowFactory) ||
    parseLevelWordLine(trimmed, nowFactory)
  );
}

function finalizeDraft(draft: DraftEvent | null, nowFactory: () => string): SharedConsoleLogEntryCore | null {
  if (!draft || draft.lines.length === 0) {
    return null;
  }

  const rawText = draft.lines.join('\n').trim();
  const fallbackTimestamp = nowFactory();
  const stackTrace =
    draft.stackLines.length > 0
      ? Array.from(new Set(draft.stackLines.map((line) => line.trim()))).join('\n')
      : draft.header.stackTrace;
  const extractedSource = extractSourceInfo(stackTrace || rawText);

  return classifyConsoleEvent({
    timestamp: normalizeTimestamp(draft.header.timestamp, fallbackTimestamp),
    level: draft.header.level ?? 'log',
    message: draft.header.message || draft.lines[0].trim(),
    source: draft.header.source ?? extractedSource.source,
    lineNumber: draft.header.lineNumber ?? extractedSource.lineNumber,
    columnNumber: draft.header.columnNumber ?? extractedSource.columnNumber,
    stackTrace,
    args: draft.header.args,
    url: draft.header.url ?? extractedSource.url,
    category: draft.header.category,
    rawText,
    issueTags: draft.header.issueTags,
    inferredSeverity: draft.header.inferredSeverity,
    primaryIssue: draft.header.primaryIssue,
  });
}

export class ConsoleTextEventParser {
  private current: DraftEvent | null = null;

  private readonly nowFactory: () => string;

  constructor(nowFactory: () => string = () => new Date().toISOString()) {
    this.nowFactory = nowFactory;
  }

  pushLine(line: string): SharedConsoleLogEntryCore[] {
    const normalizedLine = line.replace(/\r$/, '');
    if (!normalizedLine.trim()) {
      return [];
    }

    const header = parseConsoleHeaderLine(normalizedLine, this.nowFactory);
    if (header?.explicit) {
      const completed = finalizeDraft(this.current, this.nowFactory);
      this.current = {
        header,
        lines: [normalizedLine],
        stackLines: header.stackTrace ? [header.stackTrace] : [],
      };
      return completed ? [completed] : [];
    }

    if (!this.current) {
      this.current = {
        header: {
          explicit: false,
          timestamp: this.nowFactory(),
          level: 'log',
          message: normalizedLine.trim(),
        },
        lines: [normalizedLine],
        stackLines: [],
      };
      return [];
    }

    this.current.lines.push(normalizedLine);
    if (isStackTraceLine(normalizedLine)) {
      this.current.stackLines.push(normalizedLine.trim());
    }

    return [];
  }

  flush(): SharedConsoleLogEntryCore[] {
    const completed = finalizeDraft(this.current, this.nowFactory);
    this.current = null;
    return completed ? [completed] : [];
  }
}

export function parseConsoleText(
  content: string,
  nowFactory: () => string = () => new Date().toISOString(),
): SharedConsoleLogEntryCore[] {
  const parser = new ConsoleTextEventParser(nowFactory);
  const entries: SharedConsoleLogEntryCore[] = [];

  content.split('\n').forEach((line) => {
    entries.push(...parser.pushLine(line));
  });

  entries.push(...parser.flush());
  return entries;
}
