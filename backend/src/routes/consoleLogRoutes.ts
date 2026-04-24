import express, { Request, Response } from 'express';
import { getMongoDb, getRedis } from '../config/database';

const router = express.Router();

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
    const page = Number.parseInt(req.query.page as string, 10) || 1;
    const limit = Number.parseInt(req.query.limit as string, 10) || 100;
    const skip = (page - 1) * limit;

    const db = getMongoDb();
    const logsCollection = db.collection('console_logs');
    const filter = buildLogFilter(fileId, req.query);

    const entries = await logsCollection
      .find(filter, { projection: listProjection() })
      .sort(buildSort(req.query))
      .skip(skip)
      .limit(limit)
      .toArray();

    const totalEntries = await logsCollection.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(totalEntries / limit));

    res.json({
      entries,
      pagination: {
        currentPage: page,
        totalPages,
        totalEntries,
        hasMore: page < totalPages,
        limit,
      },
    });
  } catch (error) {
    console.error('Failed to fetch log entries:', error);
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
});

router.get('/:fileId/entries/:index', async (req: Request, res: Response) => {
  try {
    const { fileId, index } = req.params;
    const entryIndex = Number.parseInt(index, 10);

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
        processedAt: file.processedAt,
      });
    }

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
        processedAt: null,
      });
    }

    return res.status(404).json({ error: 'File not found' });
  } catch (error) {
    console.error('Failed to fetch log status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

router.get('/:fileId/search', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const page = Number.parseInt(req.query.page as string, 10) || 1;
    const limit = Number.parseInt(req.query.limit as string, 10) || 100;
    const skip = (page - 1) * limit;

    const db = getMongoDb();
    const logsCollection = db.collection('console_logs');
    const filter = buildLogFilter(fileId, req.query);

    const entries = await logsCollection
      .find(filter, { projection: listProjection() })
      .sort(buildSort(req.query))
      .skip(skip)
      .limit(limit)
      .toArray();

    const totalEntries = await logsCollection.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(totalEntries / limit));

    res.json({
      entries,
      pagination: {
        currentPage: page,
        totalPages,
        totalEntries,
        hasMore: page < totalPages,
        limit,
      },
    });
  } catch (error) {
    console.error('Failed to search log entries:', error);
    res.status(500).json({ error: 'Failed to search entries' });
  }
});

export default router;
