import type { ParsedHarEntry } from './streamingParser';

type CountMap = Record<string, number>;

export interface HarAutomationStats {
  totalRequests?: number;
  totalSize?: number;
  totalTime?: number;
  statusCodes?: CountMap;
  methods?: CountMap;
  domains?: CountMap;
  contentTypes?: CountMap;
  averageTime?: number;
  minTime?: number;
  maxTime?: number;
  errors?: number;
}

export interface HarAutomationFileDoc {
  fileId: string;
  fileName?: string;
  status?: string;
  totalEntries?: number;
  uploadedAt?: Date | string | null;
  processedAt?: Date | string | null;
  stats?: HarAutomationStats;
}

export interface HarAutomationPendingMetadata {
  fileName?: string;
  status?: string;
  totalEntries?: number | null;
  uploadedAt?: string | null;
  processedAt?: string | null;
}

export interface AutomationPaginationInput {
  page: number;
  limit: number;
  totalEntries: number;
}

function numericStatus(status: unknown): number {
  const value = typeof status === 'number' ? status : Number(status);
  return Number.isFinite(value) ? value : 0;
}

function statusBucket(status: number): '0' | '1xx' | '2xx' | '3xx' | '4xx' | '5xx' {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  if (status >= 100) return '1xx';
  return '0';
}

function topCountMapItems(values: CountMap = {}, limit = 10, keyName: 'domain' | 'method' = 'domain') {
  return Object.entries(values)
    .map(([key, count]) => ({ [keyName]: key, count } as Record<string, string | number>))
    .sort((a, b) => Number(b.count) - Number(a.count) || String(a[keyName]).localeCompare(String(b[keyName])))
    .slice(0, limit);
}

function compactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return rawUrl;
  }
}

function entryStatus(entry: ParsedHarEntry): number {
  return numericStatus(entry.response?.status);
}

function entryMimeType(entry: ParsedHarEntry): string | undefined {
  const mimeType = entry.response?.content?.mimeType;
  return typeof mimeType === 'string' && mimeType.length > 0 ? mimeType : undefined;
}

function entryWaitMs(entry: ParsedHarEntry): number {
  const wait = entry.timings?.wait;
  return typeof wait === 'number' && Number.isFinite(wait) ? wait : 0;
}

function summarizeRequest(entry: ParsedHarEntry): string {
  const method = entry.request?.method ?? 'UNKNOWN';
  const url = compactUrl(entry.request?.url ?? '');
  const status = entryStatus(entry);
  const totalMs = typeof entry.time === 'number' ? entry.time.toFixed(0) : '0';
  const waitMs = entryWaitMs(entry).toFixed(0);
  return `${method} ${url} status:${status} totalms:${totalMs}ms wait:${waitMs}ms`;
}

export function isSafeAutomationFileId(fileId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(fileId);
}

export function buildHarAutomationSummary(fileDoc: HarAutomationFileDoc) {
  const stats = fileDoc.stats ?? {};
  const totalRequests = stats.totalRequests ?? fileDoc.totalEntries ?? 0;
  const errors = stats.errors ?? 0;
  const statusBuckets = {
    '0': 0,
    '1xx': 0,
    '2xx': 0,
    '3xx': 0,
    '4xx': 0,
    '5xx': 0,
  };

  for (const [rawStatus, count] of Object.entries(stats.statusCodes ?? {})) {
    statusBuckets[statusBucket(numericStatus(rawStatus))] += count;
  }

  return {
    fileId: fileDoc.fileId,
    fileName: fileDoc.fileName ?? null,
    status: fileDoc.status ?? 'unknown',
    uploadedAt: fileDoc.uploadedAt ?? null,
    processedAt: fileDoc.processedAt ?? null,
    summary: {
      totalRequests,
      totalEntries: fileDoc.totalEntries ?? totalRequests,
      errors,
      errorRate: totalRequests > 0 ? errors / totalRequests : 0,
      statusBuckets,
      topDomains: topCountMapItems(stats.domains, 10, 'domain'),
      topMethods: topCountMapItems(stats.methods, 10, 'method'),
      averageTime: stats.averageTime ?? 0,
      maxTime: stats.maxTime ?? 0,
      totalSize: stats.totalSize ?? 0,
    },
  };
}

export function buildHarAutomationPendingResponse(
  fileId: string,
  metadata: HarAutomationPendingMetadata = {},
) {
  return {
    error: 'File is not ready for automation analysis yet',
    message: 'Wait until processing status is ready, then retry this endpoint.',
    fileId,
    fileName: metadata.fileName ?? null,
    status: metadata.status ?? 'processing',
    totalEntries: metadata.totalEntries ?? null,
    uploadedAt: metadata.uploadedAt ?? null,
    processedAt: metadata.processedAt ?? null,
  };
}

export function buildHarErrorListResponse(
  entries: ParsedHarEntry[],
  pagination: AutomationPaginationInput,
) {
  const failedEntries = entries
    .filter((entry) => entryStatus(entry) >= 400)
    .map((entry) => ({
      index: entry.index,
      startedDateTime: entry.startedDateTime,
      method: entry.request?.method ?? null,
      url: entry.request?.url ?? null,
      status: entryStatus(entry),
      statusText: entry.response?.statusText ?? '',
      time: entry.time,
      mimeType: entryMimeType(entry) ?? null,
      serverIPAddress: entry.serverIPAddress ?? null,
    }));
  const totalPages = Math.ceil(pagination.totalEntries / pagination.limit);

  return {
    entries: failedEntries,
    pagination: {
      currentPage: pagination.page,
      totalPages,
      totalEntries: pagination.totalEntries,
      hasMore: pagination.page < totalPages,
      limit: pagination.limit,
    },
  };
}

export function buildHarInsightContext(entries: ParsedHarEntry[], stats: HarAutomationStats = {}): string {
  const errors = entries.filter((entry) => entryStatus(entry) >= 400);
  const serverErrors = errors.filter((entry) => entryStatus(entry) >= 500);
  const clientErrors = errors.filter((entry) => entryStatus(entry) >= 400 && entryStatus(entry) < 500);
  const redirects = entries.filter((entry) => {
    const status = entryStatus(entry);
    return status >= 300 && status < 400;
  });

  const totalRequests = stats.totalRequests ?? entries.length;
  const statusSummary = Object.entries(stats.statusCodes ?? {})
    .sort(([a], [b]) => numericStatus(a) - numericStatus(b))
    .map(([status, count]) => `${status}:${count}`)
    .join(' ');
  const summary = [
    `requests:${totalRequests}`,
    `errors:${stats.errors ?? errors.length}`,
    serverErrors.length ? `5xx:${serverErrors.length}` : null,
    clientErrors.length ? `4xx:${clientErrors.length}` : null,
    redirects.length ? `3xx:${redirects.length}` : null,
    statusSummary ? `statuses:${statusSummary}` : null,
  ].filter(Boolean).join(' ');

  const clusterMap = new Map<string, { count: number; statuses: number[] }>();
  for (const entry of errors) {
    const key = `${entry.request?.method ?? 'UNKNOWN'} ${compactUrl(entry.request?.url ?? '')}`;
    const current = clusterMap.get(key);
    if (current) {
      current.count += 1;
      current.statuses.push(entryStatus(entry));
    } else {
      clusterMap.set(key, { count: 1, statuses: [entryStatus(entry)] });
    }
  }

  const errorClusters = Array.from(clusterMap.entries())
    .filter(([, value]) => value.count > 1)
    .sort(([, a], [, b]) => {
      const highestStatusDelta = Math.max(...b.statuses) - Math.max(...a.statuses);
      return highestStatusDelta || b.count - a.count;
    })
    .slice(0, 10)
    .map(([key, value]) => {
      const statuses = Array.from(new Set(value.statuses)).sort().join(',');
      return `${key} -> x${value.count} failures [${statuses}]`;
    });

  const topSlow = [...entries]
    .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
    .slice(0, 20)
    .map(summarizeRequest);

  const parts = [
    `HAR SUMMARY: ${summary}`,
    ...(serverErrors.length
      ? [`5XX SERVER ERRORS (${serverErrors.length} total - analyse first, highest severity):\n${serverErrors.slice(0, 20).map(summarizeRequest).join('\n')}`]
      : []),
    ...(clientErrors.length
      ? [`4XX CLIENT ERRORS (${clientErrors.length} total):\n${clientErrors.slice(0, 20).map(summarizeRequest).join('\n')}`]
      : []),
    ...(errorClusters.length
      ? [`ERROR CLUSTERS (same endpoint failing repeatedly):\n${errorClusters.join('\n')}`]
      : []),
    `TOP SLOW:\n${topSlow.join('\n')}`,
  ];

  const raw = parts.join('\n\n');
  return raw.length > 12000 ? `${raw.slice(0, 12000)}\n[TRUNCATED]` : raw;
}
