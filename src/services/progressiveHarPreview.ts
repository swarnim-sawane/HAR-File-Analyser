export const MAX_PREVIEW_REQUESTS = 250;
export const MAX_PREVIEW_ENTRY_CHARS = 2_000_000;

export class HarPreviewValidationError extends Error {
  readonly code = 'HAR_PREVIEW_VALIDATION';

  constructor(message: string) {
    super(message);
    this.name = 'HarPreviewValidationError';
  }
}

const MAX_PREVIEW_URL_CHARS = 4_096;
const MAX_PREVIEW_METHOD_CHARS = 24;
const MAX_PREVIEW_TIMESTAMP_CHARS = 64;
const MAX_PREVIEW_STATUS_TEXT_CHARS = 128;

export type HarPreviewPhase =
  | 'validating'
  | 'uploading'
  | 'sanitizing'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface HarPreviewRequest {
  id: string;
  index: number;
  startedDateTime: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  encodedBytes: number;
}

export interface HarPreviewSnapshot {
  previewId: string;
  fileName: string;
  fileSize: number;
  phase: HarPreviewPhase;
  revision: number;
  requests: HarPreviewRequest[];
  totalParsed: number;
  skippedOversizedEntries: number;
  isTruncated: boolean;
  maxRequests: number;
  error?: string;
}

export interface HarPreviewEvent {
  type: 'snapshot';
  snapshot: HarPreviewSnapshot;
}

interface HarEntryLike {
  startedDateTime?: unknown;
  time?: unknown;
  request?: { method?: unknown; url?: unknown };
  response?: {
    status?: unknown;
    statusText?: unknown;
    bodySize?: unknown;
    content?: { size?: unknown };
  };
}

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const boundedString = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`;

export const redactPreviewUrl = (value: string): string => {
  let redacted: string;
  try {
    const url = new URL(value);
    redacted = `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    redacted = value.split(/[?#]/, 1)[0];
  }
  return boundedString(redacted, MAX_PREVIEW_URL_CHARS);
};

const toPreviewRequest = (entry: HarEntryLike, index: number): HarPreviewRequest | null => {
  if (
    typeof entry.startedDateTime !== 'string'
    || typeof entry.request?.method !== 'string'
    || typeof entry.request?.url !== 'string'
    || typeof entry.response?.status !== 'number'
  ) {
    return null;
  }

  const bodySize = finiteNumber(entry.response.bodySize, -1);
  const contentSize = finiteNumber(entry.response.content?.size, 0);

  return {
    id: `preview-request-${index}`,
    index,
    startedDateTime: boundedString(entry.startedDateTime, MAX_PREVIEW_TIMESTAMP_CHARS),
    method: boundedString(entry.request.method, MAX_PREVIEW_METHOD_CHARS),
    url: redactPreviewUrl(entry.request.url),
    status: entry.response.status,
    statusText: typeof entry.response.statusText === 'string'
      ? boundedString(entry.response.statusText, MAX_PREVIEW_STATUS_TEXT_CHARS)
      : '',
    durationMs: Math.max(0, finiteNumber(entry.time)),
    encodedBytes: Math.max(0, bodySize >= 0 ? bodySize : contentSize),
  };
};

/**
 * Incrementally extracts complete HAR entry objects without ever materializing
 * the full HAR document. Only privacy-safe request metadata is retained.
 */
export class HarEntryStreamParser {
  private readonly maxRequests: number;
  private started = false;
  private entriesArrayDepth = -1;
  private objectDepth = 0;
  private arrayDepth = 0;
  private inString = false;
  private escaped = false;
  private stringBuffer = '';
  private lastStringToken = '';
  private awaitingEntriesColon = false;
  private awaitingEntriesArray = false;
  private capturingEntry = false;
  private entryBuffer = '';
  private entryObjectDepth = 0;
  private entryArrayDepth = 0;
  private entryInString = false;
  private entryEscaped = false;
  private entryOversized = false;
  private closedEntriesArray = false;
  private documentComplete = false;
  private invalidStructure = false;
  private parsedEntryCount = 0;
  private consumedEntryCount = 0;
  private skippedOversizedEntryCount = 0;
  private readonly retained: HarPreviewRequest[] = [];

  constructor(maxRequests = MAX_PREVIEW_REQUESTS) {
    this.maxRequests = Math.max(1, Math.floor(finiteNumber(maxRequests, MAX_PREVIEW_REQUESTS)));
  }

  push(chunk: string): HarPreviewRequest[] {
    const emitted: HarPreviewRequest[] = [];

    for (const char of chunk) {
      if (this.capturingEntry) {
        const parsed = this.consumeEntryChar(char);
        if (parsed) emitted.push(parsed);
        continue;
      }

      if (this.documentComplete) {
        if (!/\s/.test(char)) this.invalidStructure = true;
        continue;
      }

      if (!this.started && !/\s/.test(char) && char !== '\uFEFF') {
        this.started = true;
        if (char === '[') {
          this.arrayDepth = 1;
          this.entriesArrayDepth = 1;
          continue;
        }
        if (char !== '{') this.invalidStructure = true;
      }

      if (this.inString) {
        if (this.escaped) {
          this.stringBuffer += char;
          this.escaped = false;
        } else if (char === '\\') {
          this.stringBuffer += char;
          this.escaped = true;
        } else if (char === '"') {
          this.inString = false;
          this.lastStringToken = this.stringBuffer;
          this.stringBuffer = '';
          if (this.lastStringToken === 'entries' && this.objectDepth <= 2) {
            this.awaitingEntriesColon = true;
          }
        } else {
          this.stringBuffer += char;
        }
        continue;
      }

      if (char === '"') {
        this.inString = true;
        this.escaped = false;
        this.stringBuffer = '';
        continue;
      }

      if (this.awaitingEntriesColon) {
        if (/\s/.test(char)) continue;
        this.awaitingEntriesColon = false;
        if (char === ':') {
          this.awaitingEntriesArray = true;
          continue;
        }
      }

      if (this.awaitingEntriesArray) {
        if (/\s/.test(char)) continue;
        this.awaitingEntriesArray = false;
        if (char === '[') {
          this.arrayDepth += 1;
          this.entriesArrayDepth = this.arrayDepth;
          continue;
        }
      }

      if (this.entriesArrayDepth > 0 && this.arrayDepth === this.entriesArrayDepth) {
        if (char === '{') {
          this.beginEntry();
          const parsed = this.consumeEntryChar(char);
          if (parsed) emitted.push(parsed);
          continue;
        }
        if (char === ']') {
          this.closedEntriesArray = true;
          this.arrayDepth -= 1;
          if (this.objectDepth === 0 && this.arrayDepth === 0) this.documentComplete = true;
          continue;
        }
      }

      if (char === '{') this.objectDepth += 1;
      else if (char === '}') {
        if (this.objectDepth <= 0) this.invalidStructure = true;
        else this.objectDepth -= 1;
      }
      else if (char === '[') this.arrayDepth += 1;
      else if (char === ']') {
        if (this.arrayDepth <= 0) this.invalidStructure = true;
        else this.arrayDepth -= 1;
      }

      if (this.closedEntriesArray && this.objectDepth === 0 && this.arrayDepth === 0) {
        this.documentComplete = true;
      }
    }

    return emitted;
  }

  finish(): {
    totalParsed: number;
    skippedOversizedEntries: number;
    retained: HarPreviewRequest[];
    isTruncated: boolean;
  } {
    if (this.capturingEntry) {
      throw new HarPreviewValidationError('HAR file ended before a request entry was complete.');
    }
    if (this.entriesArrayDepth < 0) {
      throw new HarPreviewValidationError('HAR file does not contain an entries array.');
    }
    if (!this.closedEntriesArray) {
      throw new HarPreviewValidationError('HAR file ended before the entries array was complete.');
    }
    if (!this.documentComplete || this.invalidStructure || this.inString) {
      throw new HarPreviewValidationError('HAR file ended before the HAR document was complete.');
    }
    if (this.parsedEntryCount === 0 && this.skippedOversizedEntryCount === 0) {
      throw new HarPreviewValidationError('HAR file does not contain valid request entries.');
    }

    return this.snapshot();
  }

  snapshot(): {
    totalParsed: number;
    skippedOversizedEntries: number;
    retained: HarPreviewRequest[];
    isTruncated: boolean;
  } {
    return {
      totalParsed: this.parsedEntryCount,
      skippedOversizedEntries: this.skippedOversizedEntryCount,
      retained: [...this.retained],
      isTruncated:
        this.parsedEntryCount > this.retained.length || this.skippedOversizedEntryCount > 0,
    };
  }

  private beginEntry() {
    this.capturingEntry = true;
    this.entryBuffer = '';
    this.entryObjectDepth = 0;
    this.entryArrayDepth = 0;
    this.entryInString = false;
    this.entryEscaped = false;
    this.entryOversized = false;
  }

  private consumeEntryChar(char: string): HarPreviewRequest | null {
    if (!this.entryOversized) {
      this.entryBuffer += char;
      if (this.entryBuffer.length > MAX_PREVIEW_ENTRY_CHARS) {
        this.entryOversized = true;
        this.entryBuffer = '';
      }
    }

    if (this.entryInString) {
      if (this.entryEscaped) this.entryEscaped = false;
      else if (char === '\\') this.entryEscaped = true;
      else if (char === '"') this.entryInString = false;
      return null;
    }

    if (char === '"') {
      this.entryInString = true;
      return null;
    }
    if (char === '{') this.entryObjectDepth += 1;
    else if (char === '}') this.entryObjectDepth -= 1;
    else if (char === '[') this.entryArrayDepth += 1;
    else if (char === ']') this.entryArrayDepth -= 1;

    if (this.entryObjectDepth !== 0 || this.entryArrayDepth !== 0) return null;

    this.capturingEntry = false;
    const index = this.consumedEntryCount;
    this.consumedEntryCount += 1;

    if (this.entryOversized) {
      this.entryOversized = false;
      this.entryBuffer = '';
      this.skippedOversizedEntryCount += 1;
      return null;
    }

    let parsed: HarEntryLike;
    try {
      parsed = JSON.parse(this.entryBuffer) as HarEntryLike;
    } catch {
      throw new HarPreviewValidationError('HAR file contains an invalid request entry.');
    } finally {
      this.entryBuffer = '';
    }

    const preview = toPreviewRequest(parsed, index);
    if (!preview) {
      throw new HarPreviewValidationError('HAR file contains an invalid request entry.');
    }

    this.parsedEntryCount += 1;
    if (this.retained.length < this.maxRequests) {
      this.retained.push(preview);
      return preview;
    }
    return null;
  }
}
