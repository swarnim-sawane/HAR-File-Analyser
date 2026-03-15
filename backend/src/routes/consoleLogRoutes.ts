import express, { Request, Response } from 'express';
import { getMongoDb } from '../config/database';

const router = express.Router();

/**
 * ✅ FIXED: Get console log entries with pagination (not all at once!)
 * GET /api/logs/:fileId/entries?page=1&limit=100
 */
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
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({
      fileId: file.fileId,
      fileName: file.fileName,
      status: file.status,
      totalEntries: file.totalEntries,
      uploadedAt: file.uploadedAt,
      processedAt: file.processedAt
    });
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
