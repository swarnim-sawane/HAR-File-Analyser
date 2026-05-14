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
export type ConsoleParseStatus = 'parsed' | 'partial' | 'fallback';
export type ConsoleParseFormat =
  | 'json'
  | 'odl'
  | 'catalina-iso'
  | 'browser-console'
  | 'access-log'
  | 'generic-level'
  | 'fallback';
export type ConsoleParseConfidence = 'high' | 'medium' | 'low';

export interface ConsoleClassificationReason {
  ruleId: string;
  label: string;
  tag?: ConsoleIssueTag;
  severity?: ConsoleInferredSeverity;
  evidence: string;
}

export interface SharedConsoleLogEntryCore {
  timestamp: string;
  level: SharedLogLevel;
  originalLevel?: SharedLogLevel;
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
  classificationReasons?: ConsoleClassificationReason[];
  parseStatus: ConsoleParseStatus;
  parseFormat: ConsoleParseFormat;
  parseConfidence: ConsoleParseConfidence;
  parseWarnings: string[];
}

type CoreDraft = Omit<
  SharedConsoleLogEntryCore,
  | 'rawText'
  | 'inferredSeverity'
  | 'issueTags'
  | 'primaryIssue'
  | 'classificationReasons'
  | 'parseStatus'
  | 'parseFormat'
  | 'parseConfidence'
  | 'parseWarnings'
> & {
  rawText?: string;
  inferredSeverity?: ConsoleInferredSeverity;
  issueTags?: ConsoleIssueTag[];
  primaryIssue?: ConsoleIssueTag;
  classificationReasons?: ConsoleClassificationReason[];
  parseStatus?: ConsoleParseStatus;
  parseFormat?: ConsoleParseFormat;
  parseConfidence?: ConsoleParseConfidence;
  parseWarnings?: string[];
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
const QUOTED_ACCESS_LOG_STATUS_PATTERN =
  /"(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+[^"]+\s+HTTP\/\d(?:\.\d)?"\s+([1-5]\d{2})\b/i;
const NETWORK_ERROR_PATTERN =
  /\b(failed to fetch|network ?error|net::err_|request failed|load failed|connection (?:refused|reset|timed out)|err_connection|err_failed)\b/i;
const CORS_FAILURE_PATTERN =
  /\b(CORS_BLOCKED|blocked by cors policy|cross-origin request blocked|preflight request[^.\n]*(?:fail|failed|doesn'?t pass|not pass|blocked|denied)|(?:no|missing)\s+['"]?access-control-allow-origin|access control check[^.\n]*(?:fail|failed|doesn'?t pass|not pass|blocked|denied)|cors policy[^.\n]*(?:fail|failed|blocked|denied))\b/i;
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

const PARSE_WARNING_UNRECOGNIZED = 'Unrecognized log format; captured as raw message.';
const PARSE_WARNING_MISSING_TIMESTAMP = 'Timestamp was not present in the parsed log line.';
const PARSE_WARNING_MISSING_SOURCE = 'Source was not present in the parsed log line.';

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

function evidenceSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function pushReason(
  reasons: ConsoleClassificationReason[],
  reason: ConsoleClassificationReason,
) {
  if (reasons.some((existing) => existing.ruleId === reason.ruleId && existing.tag === reason.tag)) {
    return;
  }

  reasons.push(reason);
}

function uniqueStrings(values: Iterable<string | undefined>): string[] {
  return Array.from(new Set(Array.from(values).filter((value): value is string => Boolean(value))));
}

function buildParseWarnings(options: {
  missingTimestamp?: boolean;
  missingSource?: boolean;
  unrecognized?: boolean;
  warnings?: string[];
}): string[] {
  return uniqueStrings([
    ...(options.warnings ?? []),
    options.unrecognized ? PARSE_WARNING_UNRECOGNIZED : undefined,
    options.missingTimestamp ? PARSE_WARNING_MISSING_TIMESTAMP : undefined,
    options.missingSource ? PARSE_WARNING_MISSING_SOURCE : undefined,
  ]);
}

function withParseMetadata<T extends ParsedHeader>(
  header: T,
  metadata: {
    parseStatus: ConsoleParseStatus;
    parseFormat: ConsoleParseFormat;
    parseConfidence: ConsoleParseConfidence;
    parseWarnings?: string[];
  },
): T {
  return {
    ...header,
    parseStatus: metadata.parseStatus,
    parseFormat: metadata.parseFormat,
    parseConfidence: metadata.parseConfidence,
    parseWarnings: metadata.parseWarnings ?? [],
  };
}

export function hasCorsFailureEvidence(text: string): boolean {
  return CORS_FAILURE_PATTERN.test(text);
}

function isHttpIssueTag(tag: unknown): tag is ConsoleIssueTag {
  return tag === 'http-4xx' || tag === 'http-5xx';
}

function extractQuotedAccessLogStatus(text: string): number | undefined {
  const match = text.match(QUOTED_ACCESS_LOG_STATUS_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  const status = Number.parseInt(match[1], 10);
  return Number.isFinite(status) ? status : undefined;
}

export function resolveConsoleDisplayLevel(
  level: SharedLogLevel,
  inferredSeverity: ConsoleInferredSeverity,
): SharedLogLevel {
  if (inferredSeverity === 'error') {
    return 'error';
  }

  if (
    inferredSeverity === 'warning' &&
    level !== 'error' &&
    level !== 'warn'
  ) {
    return 'warn';
  }

  return level;
}

function hasMetricUnitAfterStatus(text: string, statusEndIndex: number): boolean {
  return HTTP_STATUS_UNITS_PATTERN.test(text.slice(statusEndIndex).trimStart());
}

export function extractExplicitHttpStatusCodes(text: string): number[] {
  const codes: number[] = [];
  const seen = new Set<string>();

  for (const pattern of HTTP_STATUS_EVIDENCE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const rawCode = match[1];
      if (!rawCode || match.index === undefined) {
        continue;
      }

      const codeStart = match.index + match[0].lastIndexOf(rawCode);
      const codeEnd = codeStart + rawCode.length;
      const code = Number.parseInt(rawCode, 10);

      if (!Number.isFinite(code) || code < 100 || code > 599) {
        continue;
      }

      if (hasMetricUnitAfterStatus(text, codeEnd)) {
        continue;
      }

      const evidenceKey = `${codeStart}:${code}`;
      if (!seen.has(evidenceKey)) {
        seen.add(evidenceKey);
        codes.push(code);
      }
    }
  }

  return codes;
}

export function findExplicitHttpIssueTag(text: string): ConsoleIssueTag | undefined {
  const codes = extractExplicitHttpStatusCodes(text);

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
): T & Pick<
  SharedConsoleLogEntryCore,
  | 'rawText'
  | 'inferredSeverity'
  | 'issueTags'
  | 'primaryIssue'
  | 'parseStatus'
  | 'parseFormat'
  | 'parseConfidence'
  | 'parseWarnings'
> {
  const rawText = buildRawText(entry);
  const text = `${entry.message ?? ''}\n${rawText}`.trim();
  const lowerText = text.toLowerCase();
  const originalLevel = entry.originalLevel ?? entry.level;
  const storedTags = Array.isArray(entry.issueTags) ? entry.issueTags : [];
  const hadStoredHttpIssue = storedTags.some(isHttpIssueTag) || isHttpIssueTag(entry.primaryIssue);
  const existingTags = storedTags.filter((tag) => !isHttpIssueTag(tag));
  const tags = new Set<ConsoleIssueTag>(existingTags);
  const reasons: ConsoleClassificationReason[] = Array.isArray(entry.classificationReasons)
    ? [...entry.classificationReasons]
    : [];
  const evidence = evidenceSnippet(text);
  const parseWarnings = uniqueStrings(entry.parseWarnings ?? []);

  if (hasCorsFailureEvidence(text)) {
    tags.add('cors');
    tags.add('network');
    pushReason(reasons, {
      ruleId: 'cors.failure',
      label: 'Explicit CORS failure language',
      tag: 'cors',
      severity: 'error',
      evidence,
    });
    pushReason(reasons, {
      ruleId: 'network.cors',
      label: 'Network failure caused by CORS block',
      tag: 'network',
      severity: 'error',
      evidence,
    });
  }

  if (NETWORK_ERROR_PATTERN.test(text)) {
    tags.add('network');
    pushReason(reasons, {
      ruleId: 'network.failure',
      label: 'Explicit network failure language',
      tag: 'network',
      severity: 'error',
      evidence,
    });
  }

  if (PROMISE_PATTERN.test(text)) {
    tags.add('promise');
    pushReason(reasons, {
      ruleId: 'javascript.promise',
      label: 'Unhandled promise failure',
      tag: 'promise',
      severity: 'error',
      evidence,
    });
  }

  if (REACT_PATTERN.test(text)) {
    tags.add('react');
    pushReason(reasons, {
      ruleId: 'react.warning',
      label: 'React runtime warning',
      tag: 'react',
      severity: 'warning',
      evidence,
    });
  }

  if (BROWSER_POLICY_PATTERN.test(text)) {
    tags.add('browser-policy');
    pushReason(reasons, {
      ruleId: 'browser.policy',
      label: 'Browser policy restriction',
      tag: 'browser-policy',
      severity: 'warning',
      evidence,
    });
  }

  if (EXCEPTION_PATTERN.test(text) || /\buncaught\b/i.test(text)) {
    tags.add('exception');
    pushReason(reasons, {
      ruleId: 'javascript.exception',
      label: 'JavaScript exception pattern',
      tag: 'exception',
      severity: 'error',
      evidence,
    });
  }

  const httpIssue = findExplicitHttpIssueTag(text);
  if (httpIssue) {
    tags.add(httpIssue);
    pushReason(reasons, {
      ruleId: httpIssue === 'http-5xx' ? 'http.status.5xx' : 'http.status.4xx',
      label: httpIssue === 'http-5xx' ? 'Explicit HTTP 5xx status' : 'Explicit HTTP 4xx status',
      tag: httpIssue,
      severity: httpIssue === 'http-5xx' ? 'error' : 'warning',
      evidence,
    });
  }

  const issueTags = uniqueTags(tags);
  const computedSeverity = determineSeverity(issueTags, lowerText);
  const accessLogStatus = extractQuotedAccessLogStatus(text);
  const shouldResetStoredHttpLevel =
    hadStoredHttpIssue && accessLogStatus !== undefined && accessLogStatus < 500;
  const inferredSeverity =
    shouldResetStoredHttpLevel ||
    severityRank(entry.inferredSeverity ?? 'none') <= severityRank(computedSeverity)
      ? computedSeverity
      : (entry.inferredSeverity ?? 'none');
  const primaryIssue = determinePrimaryIssue(issueTags, entry.primaryIssue);

  return {
    ...entry,
    level: resolveConsoleDisplayLevel(shouldResetStoredHttpLevel ? 'log' : entry.level, inferredSeverity),
    originalLevel,
    rawText,
    inferredSeverity,
    issueTags,
    primaryIssue,
    classificationReasons: reasons,
    parseStatus: entry.parseStatus ?? 'fallback',
    parseFormat: entry.parseFormat ?? 'fallback',
    parseConfidence: entry.parseConfidence ?? 'low',
    parseWarnings,
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
    originalLevel: entry.originalLevel ? normalizeLogLevel(entry.originalLevel) : undefined,
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
    parseStatus:
      entry.parseStatus === 'parsed' || entry.parseStatus === 'partial' || entry.parseStatus === 'fallback'
        ? entry.parseStatus
        : 'parsed',
    parseFormat:
      typeof entry.parseFormat === 'string'
        ? (entry.parseFormat as ConsoleParseFormat)
        : 'json',
    parseConfidence:
      entry.parseConfidence === 'high' || entry.parseConfidence === 'medium' || entry.parseConfidence === 'low'
        ? entry.parseConfidence
        : 'high',
    parseWarnings: Array.isArray(entry.parseWarnings)
      ? entry.parseWarnings.filter((warning): warning is string => typeof warning === 'string')
      : [],
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
    parseStatus: 'partial',
    parseFormat: 'browser-console',
    parseConfidence: 'medium',
    parseWarnings: buildParseWarnings({ missingTimestamp: true, missingSource: true }),
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
    parseStatus: 'parsed',
    parseFormat: 'odl',
    parseConfidence: 'high',
    parseWarnings: [],
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
      parseStatus: 'partial',
      parseFormat: 'browser-console',
      parseConfidence: 'medium',
      parseWarnings: buildParseWarnings({ missingTimestamp: true }),
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
    parseStatus: 'partial',
    parseFormat: 'browser-console',
    parseConfidence: 'medium',
    parseWarnings: buildParseWarnings({ missingTimestamp: true }),
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
    parseStatus: 'partial',
    parseFormat: 'generic-level',
    parseConfidence: 'medium',
    parseWarnings: buildParseWarnings({ missingTimestamp: true }),
  };
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

function parseBracketedIsoServerLine(line: string): ParsedHeader | null {
  const match = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?)\s+\[(\w+)\]\s+(.+)$/,
  );
  if (!match || !isLogLevelWord(match[2])) {
    return null;
  }

  const { groups, message } = readLeadingBracketGroups(match[3]);
  if (!message) {
    return null;
  }

  return {
    explicit: true,
    timestamp: normalizeTimestamp(match[1]),
    level: normalizeLogLevel(match[2]),
    source: selectServerLogSource(groups),
    message,
    parseStatus: 'parsed',
    parseFormat: 'catalina-iso',
    parseConfidence: 'high',
    parseWarnings: [],
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
    parseStatus: 'partial',
    parseFormat: 'browser-console',
    parseConfidence: 'medium',
    parseWarnings: buildParseWarnings({ missingSource: true }),
  };
}

function normalizeAccessLogTimestamp(rawTimestamp: string): string {
  const match = rawTimestamp.match(
    /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})$/,
  );
  if (!match) {
    return normalizeTimestamp(rawTimestamp);
  }

  const [, day, rawMonth, year, hour, minute, second, rawOffset] = match;
  const month = rawMonth.slice(0, 1).toUpperCase() + rawMonth.slice(1).toLowerCase();
  const offset = `${rawOffset.slice(0, 3)}:${rawOffset.slice(3)}`;
  return normalizeTimestamp(`${day} ${month} ${year} ${hour}:${minute}:${second} ${offset}`);
}

function parseAccessLogLine(line: string): ParsedHeader | null {
  const accessLogPattern =
    /^\[([^\]]+)\]\s+(\S+)\s+\S+\s+\S+\s+"([^"]+)"\s+([1-5]\d{2})\s+\S+\s+\S+(?:\s+.*)?$/;
  const match = line.match(accessLogPattern);
  if (!match) {
    return null;
  }

  return {
    explicit: true,
    timestamp: normalizeAccessLogTimestamp(match[1]),
    level: 'log',
    source: match[2],
    message: `"${match[3]}" ${match[4]}`,
    parseStatus: 'parsed',
    parseFormat: 'access-log',
    parseConfidence: 'high',
    parseWarnings: [],
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
    parseStatus: 'partial',
    parseFormat: 'browser-console',
    parseConfidence: 'medium',
    parseWarnings: buildParseWarnings({ missingTimestamp: true }),
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
    parseStatus: 'partial',
    parseFormat: 'generic-level',
    parseConfidence: 'medium',
    parseWarnings: buildParseWarnings({ missingSource: true }),
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
    parseStatus: 'partial',
    parseFormat: 'generic-level',
    parseConfidence: 'medium',
    parseWarnings: buildParseWarnings({ missingSource: true }),
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
    parseStatus: 'partial',
    parseFormat: 'browser-console',
    parseConfidence: 'medium',
    parseWarnings: buildParseWarnings({ missingTimestamp: true }),
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
    parseStatus: 'partial',
    parseFormat: 'generic-level',
    parseConfidence: 'medium',
    parseWarnings: buildParseWarnings({ missingTimestamp: true, missingSource: true }),
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
    parseStatus: 'partial',
    parseFormat: 'generic-level',
    parseConfidence: 'medium',
    parseWarnings: buildParseWarnings({ missingSource: true }),
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
    parseStatus: 'partial',
    parseFormat: 'generic-level',
    parseConfidence: 'medium',
    parseWarnings: buildParseWarnings({ missingTimestamp: true, missingSource: true }),
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
    parseStatus: 'partial',
    parseFormat: 'browser-console',
    parseConfidence: 'medium',
    parseWarnings: buildParseWarnings({ missingTimestamp: true }),
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
      parseStatus: 'parsed',
      parseFormat: 'json',
      parseConfidence: 'high',
      parseWarnings: normalized.parseWarnings ?? [],
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
    parseBracketedIsoServerLine(trimmed) ||
    parseAccessLogLine(trimmed) ||
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
    parseStatus: draft.header.parseStatus,
    parseFormat: draft.header.parseFormat,
    parseConfidence: draft.header.parseConfidence,
    parseWarnings: draft.header.parseWarnings,
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
          parseStatus: 'fallback',
          parseFormat: 'fallback',
          parseConfidence: 'low',
          parseWarnings: buildParseWarnings({
            unrecognized: true,
            missingTimestamp: true,
            missingSource: true,
          }),
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
