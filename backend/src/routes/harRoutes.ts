import express, { Request, Response } from 'express';
import { createReadStream } from 'fs';
import { createGzip } from 'zlib';
import path from 'path';
import { getPersistenceDb } from '../config/database';
import { getRedis } from '../config/database';

const router = express.Router();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePositiveInt(value: unknown, fallback: number, max?: number): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value)
    ? Number.parseInt(value, 10)
    : Number.NaN;
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

/**
 * Get full HAR payload for frontend analyzer
 * GET /api/har/:fileId
 *
 * Supports immediate read-after-upload by reading assembled file from disk
 * when persisted metadata is not ready yet.
 */
router.get('/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const db = getPersistenceDb();
    const redis = getRedis();

    const fileDoc = await db.collection('har_files').findOne({ fileId });

    const processedDir = path.resolve(
      process.env.PROCESSED_DIR || path.join(process.cwd(), 'processed')
    );

    let filePath: string | null = null;

    if (fileDoc?.filePath) {
      filePath = fileDoc.filePath as string;
    } else {
      const metadataRaw = await redis.get(`file:${fileId}:metadata`);
      if (!metadataRaw) {
        return res.status(404).json({ error: 'File not found' });
      }

      const metadata = JSON.parse(metadataRaw) as { fileName?: string };
      if (!metadata.fileName) {
        return res.status(404).json({ error: 'File metadata not found' });
      }

      const safeFileName = path.basename(metadata.fileName);
      filePath = path.join(processedDir, `${fileId}_${safeFileName}`);
    }

    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(processedDir)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    const acceptEncoding = req.headers['accept-encoding'] || '';
    const useGzip = acceptEncoding.includes('gzip');

    res.setHeader('Content-Type', 'application/json');
    if (useGzip) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
    }

    const fileStream = createReadStream(resolvedFilePath);
    fileStream.on('error', (streamErr: NodeJS.ErrnoException) => {
      if (!res.headersSent) {
        if (streamErr.code === 'ENOENT') {
          res.status(404).json({ error: 'HAR file not available yet' });
        } else {
          console.error('Failed to stream HAR data:', streamErr);
          res.status(500).json({ error: 'Failed to fetch HAR data' });
        }
      }
    });

    if (useGzip) {
      fileStream.pipe(createGzip()).pipe(res);
    } else {
      fileStream.pipe(res);
    }
    return;
  } catch (error: any) {
    console.error('Failed to fetch HAR data:', error);
    return res.status(500).json({ error: 'Failed to fetch HAR data' });
  }
});

/**
 * ✅ FIXED: Get HAR entries with pagination (not all at once!)
 * GET /api/har/:fileId/entries?page=1&limit=100
 */
router.get('/:fileId/entries', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 100, 1000);
    const skip = (page - 1) * limit;

    const db = getPersistenceDb();
    const entriesCollection = db.collection('har_entries');

    // Get paginated entries
    const entries = await entriesCollection
      .find({ fileId })
      .sort({ index: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get total count for pagination info
    const totalEntries = await entriesCollection.countDocuments({ fileId });
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
    console.error('Failed to fetch HAR entries:', error);
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
});

/**
 * ✅ NEW: Get specific entry by index (for details view)
 * GET /api/har/:fileId/entries/:index
 */
router.get('/:fileId/entries/:index', async (req: Request, res: Response) => {
  try {
    const { fileId, index } = req.params;
    const entryIndex = parseNonNegativeInt(index);
    if (entryIndex === null) {
      return res.status(400).json({ error: 'Invalid entry index' });
    }

    const db = getPersistenceDb();
    const entriesCollection = db.collection('har_entries');

    const entry = await entriesCollection.findOne({ fileId, index: entryIndex });

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    res.json(entry);
  } catch (error) {
    console.error('Failed to fetch HAR entry:', error);
    res.status(500).json({ error: 'Failed to fetch entry' });
  }
});

/**
 * Get HAR file statistics
 * GET /api/har/:fileId/stats
 */
router.get('/:fileId/stats', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const db = getPersistenceDb();

    const file = await db.collection('har_files').findOne({ fileId });
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json(file.stats);
  } catch (error) {
    console.error('Failed to fetch HAR stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

/**
 * Get HAR file metadata and status
 * GET /api/har/:fileId/status
 */
router.get('/:fileId/status', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const db = getPersistenceDb();
    const redis = getRedis();

    const file = await db.collection('har_files').findOne({ fileId });

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
    console.error('Failed to fetch HAR status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

/**
 * ✅ NEW: Search/filter HAR entries
 * GET /api/har/:fileId/search?method=GET&status=200&domain=example.com&page=1&limit=100
 */
router.get('/:fileId/search', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const { method, status, domain, contentType } = req.query;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 100, 1000);
    const skip = (page - 1) * limit;

    const db = getPersistenceDb();
    const entriesCollection = db.collection('har_entries');

    // Build filter query
    const filter: any = { fileId };
    
    if (method) {
      filter['request.method'] = method;
    }
    if (status) {
      const parsedStatus = parseNonNegativeInt(String(status));
      if (parsedStatus === null) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      filter['response.status'] = parsedStatus;
    }
    if (domain) {
      filter['request.url'] = { $regex: escapeRegExp(String(domain)), $options: 'i' };
    }
    if (contentType) {
      filter['response.content.mimeType'] = { $regex: escapeRegExp(String(contentType)), $options: 'i' };
    }

    // Get filtered entries
    const entries = await entriesCollection
      .find(filter)
      .sort({ index: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get total count
    const totalEntries = await entriesCollection.countDocuments(filter);
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
    console.error('Failed to search HAR entries:', error);
    res.status(500).json({ error: 'Failed to search entries' });
  }
});

export default router;
