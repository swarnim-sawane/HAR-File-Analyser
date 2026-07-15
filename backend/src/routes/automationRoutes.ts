import { Router, Request, Response } from 'express';
import { getMongoDb, getRedis } from '../config/database';
import type { ParsedHarEntry } from '../services/streamingParser';
import { generateInsightsForContext } from './aiRoutes';
import {
  buildHarAutomationPendingResponse,
  buildHarAutomationSummary,
  buildHarErrorListResponse,
  buildHarInsightContext,
  isSafeAutomationFileId,
  type HarAutomationFileDoc,
  type HarAutomationPendingMetadata,
} from '../services/harAutomationService';

const router = Router();
const MAX_PAGE_LIMIT = 100;
const INSIGHT_ERROR_LIMIT = 100;
const INSIGHT_SLOW_LIMIT = 50;

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePagination(req: Request): { page: number; limit: number; skip: number } {
  const page = parsePositiveInteger(req.query.page, 1);
  const requestedLimit = parsePositiveInteger(req.query.limit, 25);
  const limit = Math.min(requestedLimit, MAX_PAGE_LIMIT);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function validateFileId(fileId: string, res: Response): boolean {
  if (isSafeAutomationFileId(fileId)) return true;
  res.status(400).json({ error: 'Invalid fileId' });
  return false;
}

async function getHarFile(fileId: string): Promise<HarAutomationFileDoc | null> {
  const db = getMongoDb();
  return db.collection('har_files').findOne({ fileId }) as Promise<HarAutomationFileDoc | null>;
}

async function getPendingHarMetadata(fileId: string): Promise<HarAutomationPendingMetadata | null> {
  const redis = getRedis();
  const metadata = await redis.get(`file:${fileId}:metadata`);
  if (!metadata) return null;

  try {
    return JSON.parse(metadata) as HarAutomationPendingMetadata;
  } catch {
    return null;
  }
}

async function sendPendingOrNotFound(fileId: string, res: Response) {
  const metadata = await getPendingHarMetadata(fileId);
  if (metadata) {
    return res.status(202).json(buildHarAutomationPendingResponse(fileId, metadata));
  }

  return res.status(404).json({ error: 'File not found' });
}

async function getInsightContextEntries(fileId: string): Promise<ParsedHarEntry[]> {
  const db = getMongoDb();
  const entriesCollection = db.collection('har_entries');

  const [serverErrors, clientErrors, topSlow] = await Promise.all([
    entriesCollection
      .find({ fileId, 'response.status': { $gte: 500 } })
      .sort({ index: 1 })
      .limit(INSIGHT_ERROR_LIMIT)
      .toArray(),
    entriesCollection
      .find({ fileId, 'response.status': { $gte: 400, $lt: 500 } })
      .sort({ index: 1 })
      .limit(INSIGHT_ERROR_LIMIT)
      .toArray(),
    entriesCollection
      .find({ fileId })
      .sort({ time: -1 })
      .limit(INSIGHT_SLOW_LIMIT)
      .toArray(),
  ]);

  const combined = new Map<number, ParsedHarEntry>();
  for (const entry of [...serverErrors, ...clientErrors, ...topSlow] as unknown as ParsedHarEntry[]) {
    combined.set(entry.index, entry);
  }

  return Array.from(combined.values()).sort((a, b) => a.index - b.index);
}

router.get('/har/:fileId/summary', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    if (!validateFileId(fileId, res)) return;

    const file = await getHarFile(fileId);
    if (!file) {
      return sendPendingOrNotFound(fileId, res);
    }

    return res.json(buildHarAutomationSummary(file));
  } catch (error) {
    console.error('Failed to build HAR automation summary:', error);
    return res.status(500).json({ error: 'Failed to build HAR automation summary' });
  }
});

router.get('/har/:fileId/errors', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    if (!validateFileId(fileId, res)) return;

    const file = await getHarFile(fileId);
    if (!file) {
      return sendPendingOrNotFound(fileId, res);
    }

    const { page, limit, skip } = parsePagination(req);
    const db = getMongoDb();
    const entriesCollection = db.collection('har_entries');
    const filter = { fileId, 'response.status': { $gte: 400 } };

    const [entries, totalEntries] = await Promise.all([
      entriesCollection.find(filter).sort({ index: 1 }).skip(skip).limit(limit).toArray(),
      entriesCollection.countDocuments(filter),
    ]);

    return res.json(
      buildHarErrorListResponse(entries as unknown as ParsedHarEntry[], { page, limit, totalEntries }),
    );
  } catch (error) {
    console.error('Failed to list HAR automation errors:', error);
    return res.status(500).json({ error: 'Failed to list HAR automation errors' });
  }
});

router.get('/har/:fileId/insights/context', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    if (!validateFileId(fileId, res)) return;

    const file = await getHarFile(fileId);
    if (!file) {
      return sendPendingOrNotFound(fileId, res);
    }

    const entries = await getInsightContextEntries(fileId);
    const context = buildHarInsightContext(entries, file.stats);

    return res.json({
      fileId: file.fileId,
      fileName: file.fileName ?? null,
      sourceType: 'har',
      context,
      entrySampleCount: entries.length,
    });
  } catch (error) {
    console.error('Failed to build HAR automation insight context:', error);
    return res.status(500).json({ error: 'Failed to build HAR automation insight context' });
  }
});

router.post('/har/:fileId/insights', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    if (!validateFileId(fileId, res)) return;

    const file = await getHarFile(fileId);
    if (!file) {
      return sendPendingOrNotFound(fileId, res);
    }

    const entries = await getInsightContextEntries(fileId);
    const context = buildHarInsightContext(entries, file.stats);
    const insights = await generateInsightsForContext(context, 'har', {
      allowDeterministicFallback: true,
    });

    return res.json({
      fileId: file.fileId,
      fileName: file.fileName ?? null,
      sourceType: 'har',
      entrySampleCount: entries.length,
      ...insights,
    });
  } catch (error) {
    console.error('Failed to generate HAR automation insights:', error);
    return res.status(500).json({ error: 'Failed to generate HAR automation insights' });
  }
});

export default router;
