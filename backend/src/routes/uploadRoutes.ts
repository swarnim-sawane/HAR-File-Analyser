import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { promises as fs } from 'fs';
import { createGunzip } from 'zlib';
import path from 'path';
import crypto from 'crypto';
import { once } from 'events';
import { getRedis } from '../config/database';
import { Queue } from 'bullmq';
import { HAR_QUEUE_NAME, LOG_QUEUE_NAME } from '../config/queueNames';
import { publishGlobal } from '../utils/socketHelper';
import {
  MAX_UPLOAD_CHUNK_SIZE_BYTES,
  buildChunkTooLargeResponse,
  isMulterFileTooLargeError,
} from '../config/uploadLimits';
import {
  isSafeUploadFileId,
  isSupportedUploadFileType,
  parseUploadChunkIndex,
  parseUploadTotalChunks,
} from '../utils/uploadValidation';
import { logError, logInfo, logWarn, measureDurationMs } from '../config/observability';
import {
  getArtifactStore,
  sourceArtifactKey,
  uploadChunkKey,
} from '../services/artifactStore';

const router = express.Router();
const redis = getRedis();
const artifactStore = getArtifactStore();

// Hosted Deployment only guarantees write access under /tmp. These paths are
// scratch space; durable artifacts are owned by ArtifactStore.
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
const ASSEMBLY_DIR = path.resolve(
  process.env.ARTIFACT_SCRATCH_DIR || path.join(UPLOAD_DIR, 'assembled'),
);

console.log('Upload scratch directory:', UPLOAD_DIR);
console.log('Assembly scratch directory:', ASSEMBLY_DIR);
console.log('Artifact store:', artifactStore.kind);

// Ensure directories exist SYNCHRONOUSLY before multer setup
const fsSync = require('fs');
if (!fsSync.existsSync(UPLOAD_DIR)) {
  fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log('✅ Created upload directory');
}
if (!fsSync.existsSync(ASSEMBLY_DIR)) {
  fsSync.mkdirSync(ASSEMBLY_DIR, { recursive: true });
  console.log('Created assembly scratch directory');
}

// Create queues
const harQueue = new Queue(HAR_QUEUE_NAME, { connection: redis });
const logQueue = new Queue(LOG_QUEUE_NAME, { connection: redis });

// FIXED: Use a temporary name first, then rename
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Use timestamp-based temporary name
    const tempName = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    cb(null, tempName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_UPLOAD_CHUNK_SIZE_BYTES
  }
});

const uploadChunk = upload.single('chunk');

async function assembleChunkStreams(
  fileId: string,
  totalChunks: number,
  outputPath: string,
): Promise<number> {
  const fsNative = require('fs') as typeof import('fs');
  const writeStream = fsNative.createWriteStream(outputPath, { flags: 'w' });
  let assembledSize = 0;

  try {
    for (let index = 0; index < totalChunks; index++) {
      const opened = await artifactStore.open(uploadChunkKey(fileId, index));
      for await (const chunk of opened.body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        assembledSize += buffer.length;
        if (!writeStream.write(buffer)) await once(writeStream, 'drain');
      }
      console.log(
        `Appended chunk ${index} (running total: ${(assembledSize / 1024 / 1024).toFixed(1)} MB)`,
      );
    }

    writeStream.end();
    await once(writeStream, 'finish');
    return assembledSize;
  } catch (error) {
    writeStream.destroy();
    throw error;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hasher = crypto.createHash('sha256');
  const fsNative = require('fs') as typeof import('fs');
  for await (const chunk of fsNative.createReadStream(filePath)) {
    hasher.update(chunk as Buffer);
  }
  return hasher.digest('hex');
}

const handleChunkUpload = async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const { fileId, chunkIndex, totalChunks } = req.body;

    if (!fileId || chunkIndex === undefined || !totalChunks) {
      // Clean up temp file if params missing
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      logWarn('upload.chunk.invalid_request', { reason: 'missing_parameters' });
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // Check if file was actually uploaded
    if (!req.file) {
      console.error('❌ No file in request!');
      logWarn('upload.chunk.invalid_request', { fileId, reason: 'missing_file' });
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Prevent path traversal: fileId is used directly in a path.join below.
    // Only allow alphanumeric chars, underscores, and hyphens.
    if (!isSafeUploadFileId(fileId)) {
      await fs.unlink(req.file.path).catch(() => {});
      logWarn('upload.chunk.invalid_request', { reason: 'invalid_file_id' });
      return res.status(400).json({ error: 'Invalid fileId' });
    }

    const parsedTotalChunks = parseUploadTotalChunks(totalChunks);
    const parsedChunkIndex = parsedTotalChunks === null
      ? null
      : parseUploadChunkIndex(chunkIndex, parsedTotalChunks);

    if (parsedTotalChunks === null || parsedChunkIndex === null) {
      await fs.unlink(req.file.path).catch(() => {});
      logWarn('upload.chunk.invalid_request', { fileId, reason: 'invalid_chunk_parameters' });
      return res.status(400).json({ error: 'Invalid chunk parameters' });
    }

    const chunkKey = uploadChunkKey(fileId, parsedChunkIndex);
    await artifactStore.put(chunkKey, { filePath: req.file.path });
    await fs.rm(req.file.path, { force: true });

    console.log(`✓ Chunk ${parsedChunkIndex}/${parsedTotalChunks} received for file ${fileId}`);
    console.log(`  Saved as artifact: ${chunkKey}`);
    console.log(`  Size: ${req.file.size} bytes`);

    // Track received chunks in Redis
    await redis.sadd(`upload:${fileId}:chunks`, parsedChunkIndex.toString());
    const receivedChunks = await redis.scard(`upload:${fileId}:chunks`);

    // Update progress
    const progress = (receivedChunks / parsedTotalChunks) * 100;
    await redis.set(`upload:${fileId}:progress`, progress.toString());
    await redis.expire(`upload:${fileId}:progress`, 3600);

    await publishGlobal('upload:progress', {
      fileId,
      progress: Math.round(progress),
      receivedChunks,
      totalChunks: parsedTotalChunks
    });

    logInfo('upload.chunk.received', {
      fileId,
      chunkIndex: parsedChunkIndex,
      totalChunks: parsedTotalChunks,
      receivedChunks,
      chunkSize: req.file.size,
      durationMs: measureDurationMs(startedAt),
    });

    res.json({
      success: true,
      fileId,
      chunkIndex: parsedChunkIndex,
      receivedChunks,
      totalChunks: parsedTotalChunks,
      progress: Math.round(progress)
    });

  } catch (error) {
    console.error('Chunk upload error:', error);
    logError('upload.chunk.failed', {
      fileId: req.body?.fileId,
      chunkIndex: req.body?.chunkIndex,
      error,
      durationMs: measureDurationMs(startedAt),
    });
    // Clean up temp file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ 
      error: 'Failed to upload chunk',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Upload chunk - FIXED
router.post('/chunk', (req: Request, res: Response, next: NextFunction) => {
  uploadChunk(req, res, (error: unknown) => {
    if (isMulterFileTooLargeError(error)) {
      console.warn('Rejected oversized upload chunk', {
        contentLength: req.headers['content-length'] ?? 'unknown',
        maxChunkSize: MAX_UPLOAD_CHUNK_SIZE_BYTES,
      });
      return res.status(413).json(buildChunkTooLargeResponse());
    }

    if (error) {
      return next(error);
    }

    void handleChunkUpload(req, res).catch(next);
  });
});

// Complete upload (assemble chunks)
router.post('/complete', async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const localScratchPaths = new Set<string>();
  try {
    const { fileId, totalChunks, fileName, fileType, compressed } = req.body;

    if (!fileId || !totalChunks || !fileName || !fileType) {
      logWarn('upload.complete.invalid_request', { reason: 'missing_parameters' });
      return res.status(400).json({ error: 'Missing parameters' });
    }

    if (!isSafeUploadFileId(fileId)) {
      logWarn('upload.complete.invalid_request', { reason: 'invalid_file_id' });
      return res.status(400).json({ error: 'Invalid fileId' });
    }

    if (!isSupportedUploadFileType(fileType)) {
      logWarn('upload.complete.invalid_request', { fileId, reason: 'invalid_file_type', fileType });
      return res.status(400).json({ error: 'Invalid fileType' });
    }

    const parsedTotalChunks = parseUploadTotalChunks(totalChunks);
    if (parsedTotalChunks === null) {
      logWarn('upload.complete.invalid_request', { fileId, reason: 'invalid_total_chunks' });
      return res.status(400).json({ error: 'Invalid totalChunks' });
    }

    console.log(`📦 Assembling file: ${fileName} (${parsedTotalChunks} chunks)`);

    // Verify all chunks received
    const receivedChunks = await redis.scard(`upload:${fileId}:chunks`);
    if (receivedChunks !== parsedTotalChunks) {
      console.error(`❌ Missing chunks: received ${receivedChunks}, expected ${parsedTotalChunks}`);
      logWarn('upload.complete.missing_chunks', {
        fileId,
        receivedChunks,
        expectedChunks: parsedTotalChunks,
      });
      return res.status(400).json({
        error: 'Missing chunks',
        received: receivedChunks,
        expected: parsedTotalChunks
      });
    }

    // Assemble from provider-neutral chunk objects. In OCI mode, each request may
    // be handled by a different API replica without relying on a shared volume.
    const safeFileName = path.basename(fileName);
    const outputPath = path.join(ASSEMBLY_DIR, `${fileId}_${safeFileName}`);
    localScratchPaths.add(outputPath);
    const assembledSize = await assembleChunkStreams(fileId, parsedTotalChunks, outputPath);

    console.log(`✓ File assembled (streaming): ${outputPath} (${(assembledSize / 1024 / 1024).toFixed(1)} MB)`);

    // If client compressed the upload, decompress now so all downstream code
    // (sanitize, worker, HAR route) sees plain JSON — no changes needed elsewhere.
    if (compressed === 'gzip') {
      const compressedPath = outputPath + '.gz.tmp';
      localScratchPaths.add(compressedPath);
      await fs.rename(outputPath, compressedPath);
      const fsNative2 = require('fs') as typeof import('fs');
      await new Promise<void>((resolve, reject) => {
        fsNative2.createReadStream(compressedPath)
          .pipe(createGunzip())
          .pipe(fsNative2.createWriteStream(outputPath))
          .on('finish', resolve)
          .on('error', reject);
      });
      await fs.unlink(compressedPath).catch(() => {});
      localScratchPaths.delete(compressedPath);
      console.log(`✓ Decompressed gzip → plain JSON: ${outputPath}`);
    }

    // Normalize non-standard HAR formats (e.g. .oc files that are a bare JSON array
    // of entries rather than { log: { entries: [...] } }).
    if (fileType === 'har') {
      try {
        const fsSync = require('fs') as typeof import('fs');
        const peek = await new Promise<string>((resolve, reject) => {
          const bufs: Buffer[] = [];
          fsSync.createReadStream(outputPath, { start: 0, end: 31 })
            .on('data', (c: Buffer | string) => bufs.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string)))
            .on('end', () => resolve(Buffer.concat(bufs).toString('utf8')))
            .on('error', reject);
        });
        if (peek.trimStart()[0] === '[') {
          console.log('🔄 Bare-array HAR detected — normalizing to standard HAR format');
          const raw = await fs.readFile(outputPath, 'utf-8');
          const entries = JSON.parse(raw);
          if (Array.isArray(entries)) {
            await fs.writeFile(outputPath, JSON.stringify({
              log: { version: '1.2', creator: { name: 'Oracle Capture', version: '1.0' }, entries }
            }), 'utf-8');
            console.log(`✓ Normalized bare-array HAR: ${entries.length} entries`);
          }
        }
      } catch (normErr) {
        console.warn('HAR normalization skipped:', normErr);
      }
    }

    // Hash the canonical, decompressed artifact rather than the transport bytes.
    const hash = await hashFile(outputPath);
    const stats = await fs.stat(outputPath);
    const artifactKey = sourceArtifactKey(fileId);
    await artifactStore.put(
      artifactKey,
      { filePath: outputPath },
      fileType === 'har' ? 'application/json' : 'text/plain',
    );

    const uploadedAt = new Date().toISOString();
    const metadata = {
      fileName: safeFileName,
      fileSize: stats.size,
      fileType,
      hash,
      artifactKey,
      uploadedAt,
      status: 'processing',
      jobId: null as string | null,
    };

    // Publish metadata before making the job visible to workers.
    await redis.setex(`file:${fileId}:metadata`, 86400, JSON.stringify(metadata));

    const queue = fileType === 'har' ? harQueue : logQueue;
    const job = await queue.add('process_file', {
      fileId,
      fileName: safeFileName,
      artifactKey,
      fileSize: stats.size,
      fileType,
      hash,
      uploadedAt,
    }, {
      jobId: fileId,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });

    metadata.jobId = String(job.id);
    await redis.setex(`file:${fileId}:metadata`, 86400, JSON.stringify(metadata));

    // The durable artifact and queue job now exist, so transport chunks and
    // replica-local assembly files can be removed.
    for (let index = 0; index < parsedTotalChunks; index++) {
      await artifactStore.delete(uploadChunkKey(fileId, index)).catch(() => false);
    }
    await fs.rm(outputPath, { force: true });
    localScratchPaths.delete(outputPath);
    await redis.del(`upload:${fileId}:chunks`);
    await redis.del(`upload:${fileId}:progress`);

    console.log(`✅ File uploaded successfully: ${safeFileName} (Job: ${job.id})`);
    logInfo('upload.complete.enqueued', {
      fileId,
      fileType,
      fileSize: stats.size,
      totalChunks: parsedTotalChunks,
      jobId: job.id,
      durationMs: measureDurationMs(startedAt),
    });

    res.json({
      success: true,
      fileId,
      jobId: job.id,
      fileName: safeFileName,
      fileSize: stats.size,
      hash,
      message: 'File uploaded successfully, processing started'
    });

  } catch (error) {
    console.error('Complete upload error:', error);
    logError('upload.complete.failed', {
      fileId: req.body?.fileId,
      fileType: req.body?.fileType,
      error,
      durationMs: measureDurationMs(startedAt),
    });
    res.status(500).json({
      error: 'Failed to complete upload',
      details: 'The upload could not be finalized. Retry the upload or contact support with the request ID.'
    });
  } finally {
    await Promise.all(Array.from(localScratchPaths).map((filePath) =>
      fs.rm(filePath, { force: true }).catch(() => undefined),
    ));
  }
});

// Get upload progress
router.get('/progress/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const progress = await redis.get(`upload:${fileId}:progress`);

    res.json({
      fileId,
      progress: progress ? parseFloat(progress) : 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

export default router;
