import express, { Request, Response } from 'express';
import { getMongoDb } from '../config/database';

const router = express.Router();

/**
 * ✅ FIXED: Get HAR entries with pagination (not all at once!)
 * GET /api/har/:fileId/entries?page=1&limit=100
 */
router.get('/:fileId/entries', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const skip = (page - 1) * limit;

    const db = getMongoDb();
    const entriesCollection = db.collection('har_entries');

    // Get paginated entries
    const entries = await entriesCollection
      .find({ fileId })
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
    const entryIndex = parseInt(index);

    const db = getMongoDb();
    const entriesCollection = db.collection('har_entries');

    const entry = await entriesCollection
      .find({ fileId })
      .skip(entryIndex)
      .limit(1)
      .toArray();

    if (entry.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    res.json(entry[0]);
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
    const db = getMongoDb();

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
    const db = getMongoDb();

    const file = await db.collection('har_files').findOne({ fileId });
    
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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const skip = (page - 1) * limit;

    const db = getMongoDb();
    const entriesCollection = db.collection('har_entries');

    // Build filter query
    const filter: any = { fileId };
    
    if (method) {
      filter['request.method'] = method;
    }
    if (status) {
      filter['response.status'] = parseInt(status as string);
    }
    if (domain) {
      filter['request.url'] = { $regex: domain, $options: 'i' };
    }
    if (contentType) {
      filter['response.content.mimeType'] = { $regex: contentType, $options: 'i' };
    }

    // Get filtered entries
    const entries = await entriesCollection
      .find(filter)
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
