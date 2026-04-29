export type SharedConsoleLogLevel =
  | 'log'
  | 'info'
  | 'warn'
  | 'error'
  | 'debug'
  | 'trace'
  | 'verbose';

export interface SharedConsoleLogEntryCore {
  timestamp: string;
  level: SharedConsoleLogLevel;
  message: string;
  rawText: string;
  source?: string;
  stackTrace?: string;
  inferredSeverity?: 'error' | 'warning' | 'info';
  issueTags?: string[];
  primaryIssue?: string;
}

const LEVEL_ALIASES: Record<string, SharedConsoleLogLevel> = {
  error: 'error',
  err: 'error',
  warn: 'warn',
  warning: 'warn',
  info: 'info',
  debug: 'debug',
  trace: 'trace',
  verbose: 'verbose',
  log: 'log',
};

function normalizeLevel(value: unknown): SharedConsoleLogLevel {
  if (typeof value !== 'string') return 'log';
  return LEVEL_ALIASES[value.trim().toLowerCase()] ?? 'log';
}

function inferIssue(rawText: string): Pick<SharedConsoleLogEntryCore, 'inferredSeverity' | 'issueTags' | 'primaryIssue'> {
  const text = rawText.toLowerCase();
  const issueTags: string[] = [];
  let inferredSeverity: SharedConsoleLogEntryCore['inferredSeverity'];
  let primaryIssue: string | undefined;

  if (
    text.includes('blocked by cors policy') ||
    text.includes("preflight request doesn't pass access control check") ||
    text.includes('access-control-allow-origin')
  ) {
    inferredSeverity = 'error';
    issueTags.push('cors', 'network');
    primaryIssue = 'CORS policy blocked request';
  } else if (
    /\b(typeerror|referenceerror|syntaxerror|rangeerror|unhandled|exception)\b/i.test(rawText) ||
    /\n\s+at\s+/.test(rawText)
  ) {
    inferredSeverity = 'error';
    issueTags.push('exception');
    primaryIssue = 'Client-side exception';
  } else if (
    text.includes('autofocus processing was blocked') ||
    text.includes('content security policy') ||
    text.includes('blocked because')
  ) {
    inferredSeverity = 'warning';
    issueTags.push('browser-policy');
    primaryIssue = 'Browser policy warning';
  }

  return {
    ...(inferredSeverity ? { inferredSeverity } : {}),
    ...(issueTags.length ? { issueTags } : {}),
    ...(primaryIssue ? { primaryIssue } : {}),
  };
}

function buildEntry(
  rawText: string,
  fields: Partial<SharedConsoleLogEntryCore> = {},
): SharedConsoleLogEntryCore {
  const trimmed = rawText.trim();
  const message = fields.message?.trim() || trimmed;
  const stackTrace = fields.stackTrace ?? (/\n\s+at\s+/.test(trimmed) ? trimmed : undefined);

  return {
    timestamp: fields.timestamp ?? new Date(0).toISOString(),
    level: normalizeLevel(fields.level),
    message,
    rawText: fields.rawText ?? trimmed,
    ...(fields.source ? { source: fields.source } : {}),
    ...(stackTrace ? { stackTrace } : {}),
    ...inferIssue(trimmed),
  };
}

function parseJsonLine(line: string): SharedConsoleLogEntryCore | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const rawText =
      typeof parsed.rawText === 'string'
        ? parsed.rawText
        : typeof parsed.message === 'string'
          ? parsed.message
          : trimmed;

    return buildEntry(rawText, {
      timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
      level: normalizeLevel(parsed.level),
      message: typeof parsed.message === 'string' ? parsed.message : rawText,
      rawText,
      source: typeof parsed.source === 'string' ? parsed.source : undefined,
      stackTrace: typeof parsed.stackTrace === 'string' ? parsed.stackTrace : undefined,
    });
  } catch {
    return null;
  }
}

function parseBracketLine(line: string): SharedConsoleLogEntryCore | null {
  const match = line.match(/^\[([^\]]+)]\s*(?:(error|err|warn|warning|info|debug|trace|verbose|log)\s*[:|-]?\s*)?(.*)$/i);
  if (!match) return null;

  return buildEntry(line, {
    timestamp: match[1],
    level: normalizeLevel(match[2]),
    message: match[3] || line,
    rawText: line,
  });
}

function isStructuredLine(line: string): boolean {
  return Boolean(parseJsonLine(line) || parseBracketLine(line));
}

export class ConsoleTextEventParser {
  private pendingLines: string[] = [];

  pushLine(line: string): SharedConsoleLogEntryCore[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    const jsonEntry = parseJsonLine(trimmed);
    if (jsonEntry) return [...this.flush(), jsonEntry];

    const bracketEntry = parseBracketLine(trimmed);
    if (bracketEntry) return [...this.flush(), bracketEntry];

    if (this.pendingLines.length > 0 && isStructuredLine(trimmed)) {
      const completed = this.flush();
      this.pendingLines = [trimmed];
      return completed;
    }

    this.pendingLines.push(line);
    return [];
  }

  flush(): SharedConsoleLogEntryCore[] {
    if (this.pendingLines.length === 0) return [];
    const rawText = this.pendingLines.join('\n').trim();
    this.pendingLines = [];
    return rawText ? [buildEntry(rawText)] : [];
  }
}
