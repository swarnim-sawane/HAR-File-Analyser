import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { Queue } from 'bullmq';
import { getMongoDb, getRedis } from '../config/database';
import { HAR_QUEUE_NAME } from '../config/queueNames';
import { sanitize, getHarInfo, defaultScrubItems } from '../utils/har_sanitize';
import { isSafeUploadFileId } from '../utils/uploadValidation';
import {
  getArtifactStore,
  materializeArtifact,
  sourceArtifactKey,
} from '../services/artifactStore';

const router = Router();
const artifactStore = getArtifactStore();
const redis = getRedis();
const harQueue = new Queue(HAR_QUEUE_NAME, { connection: redis });
const PROCESSED_DIR = path.resolve(
  process.env.PROCESSED_DIR || path.join(process.cwd(), 'processed'),
);
const SANITIZE_SCRATCH_DIR = path.resolve(
  process.env.SANITIZE_SCRATCH_DIR || path.join(os.tmpdir(), 'har-analyzer-sanitize'),
);

interface StoredHarRecord {
  fileName?: string;
  artifactKey?: string;
  filePath?: string;
}

interface MaterializedHar {
  filePath: string;
  fileName: string;
  cleanup: () => Promise<void>;
}

function isInsideDirectory(candidate: string, directory: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedDirectory = path.resolve(directory);
  return resolvedCandidate === resolvedDirectory
    || resolvedCandidate.startsWith(`${resolvedDirectory}${path.sep}`);
}

async function findLegacyFile(fileId: string): Promise<StoredHarRecord | null> {
  const files = await fs.readdir(PROCESSED_DIR).catch(() => [] as string[]);
  const match = files.find((file) => file.startsWith(`${fileId}_`));
  if (!match) return null;
  return {
    fileName: match.slice(fileId.length + 1),
    filePath: path.join(PROCESSED_DIR, match),
  };
}

async function getStoredHarRecord(fileId: string): Promise<StoredHarRecord | null> {
  const fileDocument = await getMongoDb().collection('har_files').findOne(
    { fileId },
    { projection: { fileName: 1, artifactKey: 1, filePath: 1 } },
  ) as StoredHarRecord | null;
  if (fileDocument?.artifactKey || fileDocument?.filePath) return fileDocument;

  const metadataRaw = await redis.get(`file:${fileId}:metadata`);
  if (metadataRaw) {
    const metadata = JSON.parse(metadataRaw) as StoredHarRecord;
    if (metadata.artifactKey || metadata.filePath) return metadata;
  }

  return findLegacyFile(fileId);
}

async function materializeStoredHar(fileId: string): Promise<MaterializedHar | null> {
  const record = await getStoredHarRecord(fileId);
  if (!record) return null;
  const fileName = path.basename(record.fileName || `${fileId}.har`);

  if (record.artifactKey) {
    const destination = path.join(SANITIZE_SCRATCH_DIR, fileId, fileName);
    const materialized = await materializeArtifact(artifactStore, record.artifactKey, destination);
    return { ...materialized, fileName };
  }

  if (!record.filePath || !isInsideDirectory(record.filePath, PROCESSED_DIR)) {
    throw new Error('Stored HAR path is outside the configured processed directory.');
  }

  return { filePath: record.filePath, fileName, cleanup: async () => undefined };
}

router.get('/:fileId/scan', async (req: Request, res: Response) => {
  const { fileId } = req.params;
  if (!isSafeUploadFileId(fileId)) return res.status(400).json({ error: 'Invalid fileId' });

  let materialized: MaterializedHar | null = null;
  try {
    materialized = await materializeStoredHar(fileId);
    if (!materialized) return res.status(404).json({ error: 'File not found' });

    const rawText = await fs.readFile(materialized.filePath, 'utf-8');
    const info = getHarInfo(rawText);
    const sensitiveCount = (Object.values(info) as string[][]).flat()
      .filter((item) => defaultScrubItems.includes(item)).length;

    return res.json({ info, sensitiveCount });
  } catch (error) {
    console.error('Scan error:', error);
    return res.status(500).json({ error: 'Failed to scan file' });
  } finally {
    await materialized?.cleanup().catch(() => undefined);
  }
});

router.post('/:fileId', async (req: Request, res: Response) => {
  const { fileId } = req.params;
  if (!isSafeUploadFileId(fileId)) return res.status(400).json({ error: 'Invalid fileId' });

  const { mode, scrubWords = [], scrubMimetypes = [], scrubDomains = [] } = req.body;
  if (mode !== 'auto' && mode !== 'custom') {
    return res.status(400).json({ error: 'Invalid sanitization mode' });
  }

  let materialized: MaterializedHar | null = null;
  let sanitizedPath: string | null = null;

  try {
    materialized = await materializeStoredHar(fileId);
    if (!materialized) return res.status(404).json({ error: 'File not found' });

    const rawText = await fs.readFile(materialized.filePath, 'utf-8');
    const sanitized = sanitize(rawText, {
      scrubWords: mode === 'auto' ? defaultScrubItems : scrubWords,
      scrubMimetypes: mode === 'auto' ? [] : scrubMimetypes,
      scrubDomains: mode === 'auto' ? [] : scrubDomains,
    });

    const sanitizedFileId = `sanitized_${fileId}`;
    const sanitizedFileName = `redacted_${materialized.fileName}`;
    sanitizedPath = path.join(SANITIZE_SCRATCH_DIR, sanitizedFileId, sanitizedFileName);
    await fs.mkdir(path.dirname(sanitizedPath), { recursive: true });
    await fs.writeFile(sanitizedPath, sanitized, 'utf-8');

    const stats = await fs.stat(sanitizedPath);
    const hash = crypto.createHash('sha256').update(sanitized).digest('hex');
    const artifactKey = sourceArtifactKey(sanitizedFileId);
    await artifactStore.put(artifactKey, { filePath: sanitizedPath }, 'application/json');

    const uploadedAt = new Date().toISOString();
    const originalMetadataRaw = await redis.get(`file:${fileId}:metadata`);
    const originalMetadata = originalMetadataRaw ? JSON.parse(originalMetadataRaw) : {};
    const metadata = {
      ...originalMetadata,
      fileName: sanitizedFileName,
      fileSize: stats.size,
      hash,
      artifactKey,
      uploadedAt,
      status: 'processing',
      jobId: null as string | null,
      sanitizedFrom: fileId,
    };
    await redis.setex(
      `file:${sanitizedFileId}:metadata`,
      86400,
      JSON.stringify(metadata),
    );

    const job = await harQueue.add('process_file', {
      fileId: sanitizedFileId,
      fileName: sanitizedFileName,
      artifactKey,
      fileSize: stats.size,
      fileType: 'har',
      hash,
      uploadedAt,
    }, {
      jobId: sanitizedFileId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    metadata.jobId = String(job.id);
    await redis.setex(
      `file:${sanitizedFileId}:metadata`,
      86400,
      JSON.stringify(metadata),
    );

    console.log(`Sanitized artifact queued: ${sanitizedFileId} (Job: ${job.id})`);
    return res.json({ fileId: sanitizedFileId, jobId: job.id });
  } catch (error) {
    console.error('Sanitize error:', error);
    return res.status(500).json({ error: 'Failed to sanitize file' });
  } finally {
    await materialized?.cleanup().catch(() => undefined);
    if (sanitizedPath) await fs.rm(sanitizedPath, { force: true }).catch(() => undefined);
  }
});

export default router;
