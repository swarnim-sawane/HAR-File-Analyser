import express, { type Request, type Response } from 'express';
import { getDatabase, getRedis } from '../config/database';
import type { ConsoleEntryFilter, ConsoleSort } from '../persistence/postgresStore';

const router = express.Router();
const SORT_FIELDS = ['timestamp', 'level', 'source', 'message', 'index'] as const;
const ISSUE_FOCUS = new Set([
  'cors', 'network', 'exception', 'promise', 'react', 'browser-policy', 'http-4xx', 'http-5xx',
]);

function parseLevels(levels: unknown): string[] | undefined {
  const values = Array.isArray(levels) ? levels : [levels];
  const normalized = values.flatMap((value) =>
    typeof value === 'string' ? value.split(',').map((part) => part.trim().toLowerCase()) : [],
  ).filter(Boolean);
  return normalized.length ? normalized : undefined;
}

export function buildLogFilter(_fileId: string, query: Request['query']): ConsoleEntryFilter {
  const quickFocus = typeof query.quickFocus === 'string' && (
    query.quickFocus === 'all'
    || query.quickFocus === 'errors'
    || query.quickFocus === 'warnings'
    || ISSUE_FOCUS.has(query.quickFocus)
  ) ? query.quickFocus : undefined;
  return {
    levels: parseLevels(query.levels),
    startTime: typeof query.startTime === 'string' && query.startTime ? query.startTime : undefined,
    endTime: typeof query.endTime === 'string' && query.endTime ? query.endTime : undefined,
    search: typeof query.search === 'string' && query.search.trim() ? query.search.trim() : undefined,
    quickFocus,
  };
}

export function buildSort(query: Request['query']): ConsoleSort {
  const field = typeof query.sortBy === 'string' && SORT_FIELDS.includes(query.sortBy as ConsoleSort['field'])
    ? query.sortBy as ConsoleSort['field']
    : 'index';
  return { field, direction: query.sortDir === 'asc' ? 'asc' : 'desc' };
}

function parsePositiveInt(value: unknown, fallback: number, max?: number): number {
  const raw = String(value ?? '');
  const parsed = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  const safe = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  return max ? Math.min(safe, max) : safe;
}

function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

router.get('/:fileId/entries', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 100, 1000);
    const offset = (page - 1) * limit;
    const filter = buildLogFilter(fileId, req.query);
    const database = getDatabase();
    const [entries, totalEntries, facets] = await Promise.all([
      database.listConsoleEntries(fileId, { offset, limit }, filter, buildSort(req.query)),
      database.countConsoleEntries(fileId, filter),
      database.getConsoleFacets(fileId, filter),
    ]);
    const totalPages = Math.ceil(totalEntries / limit);
    return res.json({
      entries,
      pagination: { currentPage: page, totalPages, totalEntries, hasMore: page < totalPages, limit },
      facets,
    });
  } catch (error) {
    console.error('Failed to fetch log entries:', error);
    return res.status(500).json({ error: 'Failed to fetch entries' });
  }
});

router.get('/:fileId/entries/:index', async (req: Request, res: Response) => {
  try {
    const entryIndex = parseNonNegativeInt(req.params.index);
    if (entryIndex === null) return res.status(400).json({ error: 'Invalid entry index' });
    const entry = await getDatabase().getConsoleEntry(req.params.fileId, entryIndex);
    return entry ? res.json(entry) : res.status(404).json({ error: 'Entry not found' });
  } catch (error) {
    console.error('Failed to fetch log entry:', error);
    return res.status(500).json({ error: 'Failed to fetch entry' });
  }
});

router.get('/:fileId/stats', async (req: Request, res: Response) => {
  try {
    const file = await getDatabase().getFile('console', req.params.fileId);
    return file ? res.json(file.stats) : res.status(404).json({ error: 'File not found' });
  } catch (error) {
    console.error('Failed to fetch log stats:', error);
    return res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

router.get('/:fileId/status', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const file = await getDatabase().getFile('console', fileId);
    if (file) {
      return res.json({
        fileId: file.fileId,
        fileName: file.fileName,
        status: file.status,
        totalEntries: file.totalEntries,
        uploadedAt: file.uploadedAt,
        processedAt: file.processedAt,
      });
    }
    const metadata = await getRedis().get(`file:${fileId}:metadata`);
    if (!metadata) return res.status(404).json({ error: 'File not found' });
    const data = JSON.parse(metadata);
    return res.json({
      fileId,
      fileName: data.fileName,
      status: data.status,
      totalEntries: data.totalEntries ?? null,
      uploadedAt: data.uploadedAt ?? null,
      processedAt: null,
    });
  } catch (error) {
    console.error('Failed to fetch log status:', error);
    return res.status(500).json({ error: 'Failed to fetch status' });
  }
});

router.get('/:fileId/search', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 100, 1000);
    const filter: ConsoleEntryFilter = {
      level: typeof req.query.level === 'string' ? req.query.level : undefined,
      source: typeof req.query.source === 'string' ? req.query.source : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    };
    const database = getDatabase();
    const [entries, totalEntries] = await Promise.all([
      database.listConsoleEntries(fileId, { offset: (page - 1) * limit, limit }, filter, { field: 'index', direction: 'asc' }),
      database.countConsoleEntries(fileId, filter),
    ]);
    const totalPages = Math.ceil(totalEntries / limit);
    return res.json({
      entries,
      pagination: { currentPage: page, totalPages, totalEntries, hasMore: page < totalPages, limit },
    });
  } catch (error) {
    console.error('Failed to search log entries:', error);
    return res.status(500).json({ error: 'Failed to search entries' });
  }
});

export default router;
