import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { promises as fs } from 'fs';
import { createGunzip } from 'zlib';
import path from 'path';
import crypto from 'crypto';
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

const router = express.Router();
const redis = getRedis();

// Use absolute paths
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
const PROCESSED_DIR = path.resolve(process.env.PROCESSED_DIR || path.join(process.cwd(), 'processed'));

console.log('📁 Upload directory:', UPLOAD_DIR);
console.log('📁 Processed directory:', PROCESSED_DIR);

// Ensure directories exist SYNCHRONOUSLY before multer setup
const fsSync = require('fs');
if (!fsSync.existsSync(UPLOAD_DIR)) {
  fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log('✅ Created upload directory');
}
if (!fsSync.existsSync(PROCESSED_DIR)) {
  fsSync.mkdirSync(PROCESSED_DIR, { recursive: true });
  console.log('✅ Created processed directory');
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

    // FIXED: Rename temp file to proper chunk name
    const chunkPath = path.join(UPLOAD_DIR, `${fileId}_chunk_${parsedChunkIndex}`);
    await fs.rename(req.file.path, chunkPath);

    console.log(`✓ Chunk ${parsedChunkIndex}/${parsedTotalChunks} received for file ${fileId}`);
    console.log(`  Saved to: ${chunkPath}`);
    console.log(`  Size: ${req.file.size} bytes`);

    // Verify file exists
    try {
      await fs.access(chunkPath);
      console.log(`  ✓ Verified chunk exists`);
    } catch (err) {
      console.error(`  ❌ Chunk not found after rename: ${chunkPath}`);
      return res.status(500).json({ error: 'Chunk upload failed - file not saved' });
    }

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

    // List files in upload directory for debugging
    const uploadFiles = await fs.readdir(UPLOAD_DIR);
    console.log('📁 Chunk files:', uploadFiles.filter(f => f.includes(fileId)));

    // ✅ FIXED: Stream-assemble chunks — never loads full file into RAM.
    // Each chunk is piped directly to the output file. Hash computed incrementally.
    // Memory usage = one chunk at a time (~10MB max) regardless of total file size.

    // Prevent path traversal: strip any directory components from the user-supplied
    // fileName before joining it into the output path.
    const safeFileName = path.basename(fileName);
    const outputPath = path.join(PROCESSED_DIR, `${fileId}_${safeFileName}`);
    const fsNative = require('fs') as typeof import('fs');
    const hasher = crypto.createHash('sha256');
    let assembledSize = 0;

    // Open output file once, append each chunk sequentially
    const writeStream = fsNative.createWriteStream(outputPath, { flags: 'w' });

    await new Promise<void>((resolve, reject) => {
      writeStream.on('error', reject);

      (async () => {
        try {
          for (let i = 0; i < parsedTotalChunks; i++) {
            const chunkPath = path.join(UPLOAD_DIR, `${fileId}_chunk_${i}`);
            try {
              await fs.access(chunkPath);
            } catch {
              throw new Error(`Missing chunk ${i}`);
            }

            // Stream this chunk into both: the output file and the hasher
            await new Promise<void>((res2, rej2) => {
              const readStream = fsNative.createReadStream(chunkPath);
              readStream.on('error', rej2);
              readStream.on('data', (data: string | Buffer) => {
                const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
                hasher.update(buf);
                assembledSize += buf.length;
              });
              readStream.on('end', () => {
                console.log(`✓ Appended chunk ${i} (running total: ${(assembledSize / 1024 / 1024).toFixed(1)} MB)`);
                res2();
              });
              // Write to output without closing it between chunks
              readStream.pipe(writeStream, { end: false });
            });
          }

          // All chunks written — close the write stream
          writeStream.end(() => resolve());
        } catch (err) {
          writeStream.destroy();
          reject(err);
        }
      })();
    });

    console.log(`✓ File assembled (streaming): ${outputPath} (${(assembledSize / 1024 / 1024).toFixed(1)} MB)`);

    // Delete chunks
    for (let i = 0; i < parsedTotalChunks; i++) {
      const chunkPath = path.join(UPLOAD_DIR, `${fileId}_chunk_${i}`);
      await fs.unlink(chunkPath).catch(() => {});
    }

    // If client compressed the upload, decompress now so all downstream code
    // (sanitize, worker, HAR route) sees plain JSON — no changes needed elsewhere.
    if (compressed === 'gzip') {
      const compressedPath = outputPath + '.gz.tmp';
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

    // Hash was computed incrementally — no need to read file again
    const hash = hasher.digest('hex');

    // Get file size
    const stats = await fs.stat(outputPath);

    // Create processing job
    const queue = fileType === 'har' ? harQueue : logQueue;
    const job = await queue.add('process_file', {
      fileId,
      fileName,
      filePath: outputPath,
      fileSize: stats.size,
      fileType,
      hash,
      uploadedAt: new Date().toISOString(),
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });

    // Clean up Redis keys
    await redis.del(`upload:${fileId}:chunks`);
    await redis.del(`upload:${fileId}:progress`);

    // Store file metadata
    await redis.setex(
      `file:${fileId}:metadata`,
      86400,
      JSON.stringify({
        fileName,
        fileSize: stats.size,
        fileType,
        hash,
        uploadedAt: new Date().toISOString(),
        status: 'processing',
        jobId: job.id
      })
    );

    console.log(`✅ File uploaded successfully: ${fileName} (Job: ${job.id})`);
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
      fileName,
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
      details: error instanceof Error ? error.message : 'Unknown error'
    });
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
