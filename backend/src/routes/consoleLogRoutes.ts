import express, { Request, Response } from 'express';
import type { SortDirection } from 'mongodb';
import { getMongoDb, getRedis } from '../config/database';

const router = express.Router();
const SORT_FIELDS = ['timestamp', 'level', 'source', 'message', 'index'] as const;
type SortField = (typeof SORT_FIELDS)[number];

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

function buildLogFilter(fileId: string, query: Request['query']) {
  const filter: Record<string, unknown> = { fileId };
  const levels = parseLevels(query.levels);

  if (levels?.length) {
    filter.level = { $in: levels };
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
      filter.timestamp = timestampFilter;
    }
  }

  if (typeof query.search === 'string' && query.search.trim()) {
    const regex = new RegExp(query.search.trim(), 'i');
    filter.$or = [
      { message: regex },
      { rawText: regex },
      { source: regex },
      { url: regex },
      { stackTrace: regex },
      { issueTags: regex },
      { primaryIssue: regex },
    ];
  }

  return filter;
}

function buildSort(query: Request['query']) {
  const sortField =
    typeof query.sortBy === 'string' && ['timestamp', 'level', 'source', 'message', 'index'].includes(query.sortBy)
      ? query.sortBy
      : 'index';
  const sortDirection = query.sortDir === 'asc' ? 1 : -1;

  return { [sortField]: sortField === 'index' ? 1 : sortDirection };
}

function listProjection() {
  return {
    rawText: 0,
    args: 0,
  };
}

router.get('/:fileId/entries', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const skip = (page - 1) * limit;

    const db = getMongoDb();
    const logsCollection = db.collection('console_logs');

    // Get paginated entries
    const entries = await logsCollection
      .find({ fileId })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get total count for pagination info
    const totalEntries = await logsCollection.countDocuments({ fileId });
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
    const entryIndex = parseInt(index);

    const db = getMongoDb();
    const logsCollection = db.collection('console_logs');

    const entry = await logsCollection
      .find({ fileId })
      .skip(entryIndex)
      .limit(1)
      .toArray();

    if (entry.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    res.json(entry[0]);
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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const skip = (page - 1) * limit;

    const db = getMongoDb();
    const logsCollection = db.collection('console_logs');

    // Build filter query
    const filter: any = { fileId };
    
    if (level) {
      filter.level = { $regex: new RegExp(`^${level}$`, 'i') };
    }
    if (source) {
      filter.source = source;
    }
    if (search) {
      filter.message = { $regex: search, $options: 'i' };
    }

    // Get filtered entries
    const entries = await logsCollection
      .find(filter)
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
