import express, { Request, Response } from 'express';
import type { SortDirection } from 'mongodb';
import { getMongoDb, getRedis } from '../config/database';

const router = express.Router();
const SORT_FIELDS = ['timestamp', 'level', 'source', 'message', 'index'] as const;
type SortField = (typeof SORT_FIELDS)[number];
const ISSUE_FOCUS = new Set([
  'cors',
  'network',
  'exception',
  'promise',
  'react',
  'browser-policy',
  'http-4xx',
  'http-5xx',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseLevels(levels: unknown): string[] | undefined {
  if (Array.isArray(levels)) {
    const normalized = levels.flatMap((value) =>
      typeof value === 'string' ? value.split(',').map((part) => part.trim().toLowerCase()) : [],
    );
    return normalized.filter(Boolean);
  }

  if (typeof levels === 'string' && levels.trim()) {
    return levels
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
  }

  return undefined;
}

export function buildLogFilter(fileId: string, query: Request['query']) {
  const clauses: Record<string, unknown>[] = [{ fileId }];
  const levels = parseLevels(query.levels);

  if (levels?.length) {
    clauses.push({ level: { $in: levels } });
  }

  if (typeof query.startTime === 'string' || typeof query.endTime === 'string') {
    const timestampFilter: Record<string, string> = {};
    if (typeof query.startTime === 'string' && query.startTime) {
      timestampFilter.$gte = query.startTime;
    }
    if (typeof query.endTime === 'string' && query.endTime) {
      timestampFilter.$lte = query.endTime;
    }
    if (Object.keys(timestampFilter).length > 0) {
      clauses.push({ timestamp: timestampFilter });
    }
  }

  if (typeof query.search === 'string' && query.search.trim()) {
    const regex = new RegExp(escapeRegExp(query.search.trim()), 'i');
    clauses.push({ $or: [
      { message: regex },
      { rawText: regex },
      { source: regex },
      { url: regex },
      { stackTrace: regex },
      { issueTags: regex },
      { primaryIssue: regex },
    ] });
  }

  if (typeof query.quickFocus === 'string' && query.quickFocus !== 'all') {
    if (query.quickFocus === 'errors') {
      clauses.push({
        $or: [
          { level: 'error' },
          { inferredSeverity: 'error' },
        ],
      });
    } else if (query.quickFocus === 'warnings') {
      clauses.push({
        $or: [
          { level: 'warn' },
          { inferredSeverity: 'warning' },
        ],
      });
    } else if (ISSUE_FOCUS.has(query.quickFocus)) {
      clauses.push({ issueTags: query.quickFocus });
    }
  }

  if (clauses.length === 1) {
    return clauses[0];
  }

  return { $and: clauses };
}

export function buildSort(query: Request['query']): Record<string, SortDirection> {
  const sortField =
    typeof query.sortBy === 'string' && ['timestamp', 'level', 'source', 'message', 'index'].includes(query.sortBy)
      ? query.sortBy
      : 'index';
  const sortDirection = query.sortDir === 'asc' ? 1 : -1;

  if (sortField === 'index') {
    return { index: 1 };
  }

  return { [sortField]: sortDirection, index: 1 };
}

function listProjection() {
  return {
    rawText: 0,
    args: 0,
  };
}

function parsePositiveInt(value: unknown, fallback: number, max?: number): number {
  const raw = String(value ?? '');
  const parsed = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  const safe = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  return max ? Math.min(safe, max) : safe;
}

function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function buildFacets(logsCollection: any, filter: Record<string, unknown>) {
  const [levelRows, issueRows, sourceRows, parseStatusRows, parseFormatRows, parseWarningRows] = await Promise.all([
    logsCollection.aggregate([
      { $match: filter },
      { $group: { _id: '$level', count: { $sum: 1 } } },
    ]).toArray(),
    logsCollection.aggregate([
      { $match: filter },
      { $unwind: '$issueTags' },
      { $group: { _id: '$issueTags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 12 },
    ]).toArray(),
    logsCollection.aggregate([
      { $match: filter },
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray(),
    logsCollection.aggregate([
      { $match: filter },
      { $group: { _id: '$parseStatus', count: { $sum: 1 } } },
    ]).toArray(),
    logsCollection.aggregate([
      { $match: filter },
      { $group: { _id: '$parseFormat', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 12 },
    ]).toArray(),
    logsCollection.aggregate([
      { $match: filter },
      { $unwind: '$parseWarnings' },
      { $group: { _id: '$parseWarnings', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 12 },
    ]).toArray(),
  ]);

  return {
    levelCounts: Object.fromEntries(levelRows.filter((row: any) => row._id).map((row: any) => [row._id, row.count])),
    issueTagCounts: Object.fromEntries(issueRows.filter((row: any) => row._id).map((row: any) => [row._id, row.count])),
    topSources: sourceRows
      .filter((row: any) => row._id)
      .map((row: any) => ({ source: row._id, count: row.count })),
    parseStatusCounts: Object.fromEntries(parseStatusRows.filter((row: any) => row._id).map((row: any) => [row._id, row.count])),
    parseFormatCounts: Object.fromEntries(parseFormatRows.filter((row: any) => row._id).map((row: any) => [row._id, row.count])),
    parseWarningCounts: Object.fromEntries(parseWarningRows.filter((row: any) => row._id).map((row: any) => [row._id, row.count])),
  };
}

router.get('/:fileId/entries', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 100, 1000);
    const skip = (page - 1) * limit;

    const db = getMongoDb();
    const logsCollection = db.collection('console_logs');
    const filter = buildLogFilter(fileId, req.query);
    const sort = buildSort(req.query);

    const [entries, totalEntries, facets] = await Promise.all([
      logsCollection
      .find(filter)
      .project(listProjection())
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .toArray(),
      logsCollection.countDocuments(filter),
      buildFacets(logsCollection, filter),
    ]);
    const totalPages = Math.ceil(totalEntries / limit);

    res.json({
      entries,
      pagination: {
        currentPage: page,
        totalPages,
        totalEntries,
        hasMore: page < totalPages,
        limit
      },
      facets,
    });
  } catch (error) {
    console.error('Failed to fetch log entries:', error);
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
});

/**
 * ✅ NEW: Get specific log entry by index
 * GET /api/logs/:fileId/entries/:index
 */
router.get('/:fileId/entries/:index', async (req: Request, res: Response) => {
  try {
    const { fileId, index } = req.params;
    const entryIndex = parseNonNegativeInt(index);
    if (entryIndex === null) {
      return res.status(400).json({ error: 'Invalid entry index' });
    }

    const db = getMongoDb();
    const logsCollection = db.collection('console_logs');

    const entry = await logsCollection.findOne({ fileId, index: entryIndex });

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    res.json(entry);
  } catch (error) {
    console.error('Failed to fetch log entry:', error);
    res.status(500).json({ error: 'Failed to fetch entry' });
  }
});

/**
 * Get console log statistics
 * GET /api/logs/:fileId/stats
 */
router.get('/:fileId/stats', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const db = getMongoDb();

    const file = await db.collection('console_log_files').findOne({ fileId });
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json(file.stats);
  } catch (error) {
    console.error('Failed to fetch log stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

/**
 * Get console log file status
 * GET /api/logs/:fileId/status
 */
router.get('/:fileId/status', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const db = getMongoDb();

    const file = await db.collection('console_log_files').findOne({ fileId });

    if (file) {
      return res.json({
        fileId: file.fileId,
        fileName: file.fileName,
        status: file.status,
        totalEntries: file.totalEntries,
        uploadedAt: file.uploadedAt,
        processedAt: file.processedAt
      });
    }

    // File not in MongoDB yet — check Redis for in-progress status
    // (the upload pipeline writes file:{fileId}:metadata immediately with status:'processing')
    const redis = getRedis();
    const metadata = await redis.get(`file:${fileId}:metadata`);
    if (metadata) {
      const data = JSON.parse(metadata);
      return res.json({
        fileId,
        fileName: data.fileName,
        status: data.status,
        totalEntries: data.totalEntries ?? null,
        uploadedAt: data.uploadedAt ?? null,
        processedAt: null
      });
    }

    return res.status(404).json({ error: 'File not found' });
  } catch (error) {
    console.error('Failed to fetch log status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

/**
 * ✅ NEW: Search/filter console log entries
 * GET /api/logs/:fileId/search?level=error&source=console&page=1&limit=100
 */
router.get('/:fileId/search', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const { level, source, search } = req.query;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 100, 1000);
    const skip = (page - 1) * limit;

    const db = getMongoDb();
    const logsCollection = db.collection('console_logs');

    // Build filter query
    const filter: any = { fileId };
    
    if (level) {
      filter.level = { $regex: new RegExp(`^${escapeRegExp(String(level))}$`, 'i') };
    }
    if (source) {
      filter.source = source;
    }
    if (search) {
      filter.message = { $regex: escapeRegExp(String(search)), $options: 'i' };
    }

    // Get filtered entries
    const entries = await logsCollection
      .find(filter)
      .sort({ index: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get total count
    const totalEntries = await logsCollection.countDocuments(filter);
    const totalPages = Math.ceil(totalEntries / limit);

    res.json({
      entries,
      pagination: {
        currentPage: page,
        totalPages,
        totalEntries,
        hasMore: page < totalPages,
        limit
      }
    });
  } catch (error) {
    console.error('Failed to search log entries:', error);
    res.status(500).json({ error: 'Failed to search entries' });
  }
});

export default router;
