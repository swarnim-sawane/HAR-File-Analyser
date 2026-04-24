// src/utils/harAnalyzer.ts
import { Entry, HarFile, Timings } from '../types/har';

export interface HarSearchIndex {
  entryCorpus: Map<Entry, string>;
  fileCorpus: string;
}

const TEXT_MIME_PATTERNS = [
  /^text\//i,
  /json/i,
  /xml/i,
  /javascript/i,
  /ecmascript/i,
  /html/i,
  /css/i,
  /svg/i,
  /graphql/i,
  /x-www-form-urlencoded/i,
];

const BINARY_MIME_PATTERNS = [
  /^image\//i,
  /^audio\//i,
  /^video\//i,
  /^font\//i,
  /octet-stream/i,
  /pdf/i,
  /zip/i,
  /gzip/i,
  /woff/i,
];

function flattenSearchValues(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenSearchValues(item));
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => flattenSearchValues(item));
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  return [];
}

function normalizeSearchText(...values: unknown[]): string {
  return values
    .flatMap((value) => flattenSearchValues(value))
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getStatusClassToken(status: number): string {
  if (status === 0) return '0';
  if (status >= 100 && status < 200) return '1xx';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return '';
}

function looksBase64Heavy(text: string): boolean {
  const sample = text.replace(/\s+/g, '').slice(0, 2048);
  if (sample.length < 128) return false;
  return /^[a-z0-9+/=]+$/i.test(sample);
}

function getSearchableBodyText(text?: string, mimeType?: string, encoding?: string): string {
  if (!text) return '';

  const normalizedEncoding = encoding?.toLowerCase() ?? '';
  if (normalizedEncoding === 'base64') return '';
  if (looksBase64Heavy(text)) return '';

  const normalizedMime = mimeType?.toLowerCase() ?? '';
  if (!normalizedMime) return text;
  if (TEXT_MIME_PATTERNS.some((pattern) => pattern.test(normalizedMime))) return text;
  if (BINARY_MIME_PATTERNS.some((pattern) => pattern.test(normalizedMime))) return '';
  return text;
}

function matchesSearchQuery(corpus: string, normalizedQuery: string, tokens: string[]): boolean {
  if (!normalizedQuery) return true;
  if (corpus.includes(normalizedQuery)) return true;
  return tokens.every((token) => corpus.includes(token));
}

export class HarAnalyzer {
  // src/utils/harAnalyzer.ts - Update this method
    static filterByStatusCode(entries: Entry[], codes: number[]): Entry[] {
        return entries.filter(entry => {
            const status = entry.response.status;
            return codes.some(code => {
                if (code === 0) return status === 0;
                const range = Math.floor(code / 100);
                const statusRange = Math.floor(status / 100);
                return range === statusRange;
            });
        });
    }

  static buildSearchIndex(harData: HarFile): HarSearchIndex {
    const pagesById = new Map((harData.log.pages ?? []).map((page) => [page.id, page]));
    const fileCorpus = normalizeSearchText(
      harData.log.version,
      harData.log.comment,
      harData.log.creator,
      harData.log.browser,
    );

    const entryCorpus = new Map<Entry, string>();

    for (const entry of harData.log.entries ?? []) {
      const page = entry.pageref ? pagesById.get(entry.pageref) : undefined;
      entryCorpus.set(
        entry,
        normalizeSearchText(
          entry.startedDateTime,
          entry.time,
          entry.timings,
          entry.serverIPAddress,
          entry.connection,
          entry.pageref,
          entry.comment,
          page?.id,
          page?.title,
          page?.startedDateTime,
          page?.comment,
          page?.pageTimings,
          entry.request.url,
          entry.request.method,
          entry.request.httpVersion,
          entry.request.headersSize,
          entry.request.bodySize,
          entry.request.comment,
          entry.request.headers,
          entry.request.cookies,
          entry.request.queryString,
          entry.request.postData?.mimeType,
          entry.request.postData?.comment,
          entry.request.postData?.params,
          getSearchableBodyText(entry.request.postData?.text, entry.request.postData?.mimeType),
          entry.response.status,
          getStatusClassToken(entry.response.status),
          entry.response.statusText,
          entry.response.httpVersion,
          entry.response.redirectURL,
          entry.response.headersSize,
          entry.response.bodySize,
          entry.response.comment,
          entry.response.headers,
          entry.response.cookies,
          entry.response.content?.size,
          entry.response.content?.compression,
          entry.response.content?.mimeType,
          entry.response.content?.encoding,
          entry.response.content?.comment,
          getSearchableBodyText(
            entry.response.content?.text,
            entry.response.content?.mimeType,
            entry.response.content?.encoding
          ),
          entry.cache,
        )
      );
    }

    return { entryCorpus, fileCorpus };
  }

  static searchEntries(entries: Entry[], term: string, searchIndex: HarSearchIndex): Entry[] {
    const normalizedQuery = normalizeSearchText(term);
    if (!normalizedQuery) return entries;

    const tokens = normalizedQuery.split(' ').filter(Boolean);
    const matchedEntries = entries.filter((entry) =>
      matchesSearchQuery(searchIndex.entryCorpus.get(entry) ?? '', normalizedQuery, tokens)
    );

    if (matchedEntries.length > 0) return matchedEntries;
    return matchesSearchQuery(searchIndex.fileCorpus, normalizedQuery, tokens) ? entries : matchedEntries;
  }

  static calculateTotalTime(timings: Timings): number {
    return (
        (timings.blocked || 0) +
        (timings.dns || 0) +
        (timings.connect || 0) +
        (timings.send || 0) +
        (timings.wait || 0) +
        (timings.receive || 0) +
        (timings.ssl || 0)
    );
}

  static getPerformanceMetrics(entries: Entry[]) {
    const totalRequests = entries.length;
    const totalSize = entries.reduce((sum, entry) =>
        sum + entry.response.bodySize, 0
    );
    const totalTime = entries.reduce((sum, entry) =>
        sum + entry.time, 0
    );

    const statusCounts = entries.reduce((acc, entry) => {
        const statusClass = Math.floor(entry.response.status / 100) * 100;
        acc[statusClass] = (acc[statusClass] || 0) + 1;
        return acc;
    }, {} as Record<number, number>);

    const avgTime = totalRequests > 0 ? totalTime / totalRequests : 0;

    return {
        totalRequests,
        totalSize,
        totalTime,
        avgTime,
        statusCounts,
    };
}

  static getMimeTypeBreakdown(entries: Entry[]): Record < string, number > {
    return entries.reduce((acc, entry) => {
        const mimeType = entry.response.content.mimeType;
        acc[mimeType] = (acc[mimeType] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
}

  static getTimingBreakdown(entry: Entry) {
    const { timings } = entry;
    return {
        blocked: timings.blocked || 0,
        dns: timings.dns || 0,
        connect: timings.connect || 0,
        ssl: timings.ssl || 0,
        send: timings.send || 0,
        wait: timings.wait || 0,
        receive: timings.receive || 0,
    };
}
}
