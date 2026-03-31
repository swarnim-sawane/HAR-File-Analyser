import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getRedis } from '../config/database';
import { Queue } from 'bullmq';
import { sanitize, getHarInfo, defaultScrubItems } from '../utils/har_sanitize';

const router = Router();

const PROCESSED_DIR = path.resolve(
  process.env.PROCESSED_DIR || path.join(process.cwd(), 'processed')
);

// Find assembled file in PROCESSED_DIR by fileId prefix
async function findFile(fileId: string) {
  const files = await fs.readdir(PROCESSED_DIR);
  const match = files.find(f => f.startsWith(fileId + '_'));
  if (!match) return null;
  return { filePath: path.join(PROCESSED_DIR, match), baseName: match };
}

// GET /api/sanitize/:fileId/scan
// Returns detected sensitive items without modifying the file
router.get('/:fileId/scan', async (req: Request, res: Response) => {
  const { fileId } = req.params;
  try {
    const found = await findFile(fileId);
    if (!found) return res.status(404).json({ error: 'File not found' });

    const rawText = await fs.readFile(found.filePath, 'utf-8');
    const info = getHarInfo(rawText);

    const sensitiveCount = (Object.values(info) as string[][]).flat()
      .filter(item => defaultScrubItems.includes(item)).length;

    res.json({ info, sensitiveCount });
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: 'Failed to scan file' });
  }
});

// POST /api/sanitize/:fileId
// Body: { mode: 'auto' | 'custom', scrubWords?: string[], scrubMimetypes?: string[] }
// Returns: { fileId: sanitizedFileId, jobId }
router.post('/:fileId', async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const { mode, scrubWords = [], scrubMimetypes = [], scrubDomains = [] } = req.body;

  try {
    const redis = getRedis();
    const found = await findFile(fileId);
    if (!found) return res.status(404).json({ error: 'File not found' });

    const rawText = await fs.readFile(found.filePath, 'utf-8');

    // auto: redact all defaultScrubItems; custom: use caller-supplied lists
    const sanitized = sanitize(rawText, {
      scrubWords: mode === 'auto' ? defaultScrubItems : scrubWords,
      scrubMimetypes: mode === 'auto' ? [] : scrubMimetypes,
      scrubDomains: mode === 'auto' ? [] : scrubDomains,
    });

    const sanitizedFileId = `sanitized_${fileId}`;
    // Strip "{fileId}_" prefix to get original filename, then prepend "redacted_"
    const originalFileName = found.baseName.slice(fileId.length + 1);
    const sanitizedFileName = `redacted_${originalFileName}`;
    const sanitizedPath = path.join(PROCESSED_DIR, `${sanitizedFileId}_${sanitizedFileName}`);

    await fs.writeFile(sanitizedPath, sanitized, 'utf-8');
    const stats = await fs.stat(sanitizedPath);
    const hash = crypto.createHash('sha256').update(sanitized).digest('hex');

    // Enqueue BullMQ job for sanitized file (same pattern as uploadRoutes)
    const harQueue = new Queue('har-processing', { connection: redis });
    const job = await harQueue.add('process_file', {
      fileId: sanitizedFileId,
      fileName: sanitizedFileName,
      filePath: sanitizedPath,
      fileSize: stats.size,
      fileType: 'har',
      hash,
      uploadedAt: new Date().toISOString(),
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    // Copy Redis metadata under the sanitized fileId
    const origMetaRaw = await redis.get(`file:${fileId}:metadata`);
    const origMeta = origMetaRaw ? JSON.parse(origMetaRaw) : {};
    await redis.setex(`file:${sanitizedFileId}:metadata`, 86400, JSON.stringify({
      ...origMeta,
      fileName: sanitizedFileName,
      fileSize: stats.size,
      hash,
      status: 'processing',
      jobId: job.id,
      sanitizedFrom: fileId,
    }));

    console.log(`✅ Sanitized: ${sanitizedFileId} (Job: ${job.id})`);
    res.json({ fileId: sanitizedFileId, jobId: job.id });

  } catch (err) {
    console.error('Sanitize error:', err);
    res.status(500).json({ error: 'Failed to sanitize file' });
  }
});

export default router;
