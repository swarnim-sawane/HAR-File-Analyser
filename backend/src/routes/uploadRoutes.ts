import express, { Request, Response } from 'express';
import multer from 'multer';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getRedis } from '../config/database';
import { Queue } from 'bullmq';

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
const harQueue = new Queue('har-processing', { connection: redis });
const logQueue = new Queue('log-processing', { connection: redis });

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
    fileSize: 10 * 1024 * 1024 // 10MB per chunk
  }
});

// Upload chunk - FIXED
router.post('/chunk', upload.single('chunk'), async (req: Request, res: Response) => {
  try {
    const { fileId, chunkIndex, totalChunks } = req.body;

    if (!fileId || chunkIndex === undefined || !totalChunks) {
      // Clean up temp file if params missing
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // Check if file was actually uploaded
    if (!req.file) {
      console.error('❌ No file in request!');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // FIXED: Rename temp file to proper chunk name
    const chunkPath = path.join(UPLOAD_DIR, `${fileId}_chunk_${chunkIndex}`);
    await fs.rename(req.file.path, chunkPath);

    console.log(`✓ Chunk ${chunkIndex}/${totalChunks} received for file ${fileId}`);
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
    await redis.sadd(`upload:${fileId}:chunks`, chunkIndex);
    const receivedChunks = await redis.scard(`upload:${fileId}:chunks`);

    // Update progress
    const progress = (receivedChunks / parseInt(totalChunks)) * 100;
    await redis.set(`upload:${fileId}:progress`, progress.toString());
    await redis.expire(`upload:${fileId}:progress`, 3600);

    // Emit progress via WebSocket
    const io = (global as any).io;
    if (io) {
      io.emit('upload:progress', {
        fileId,
        progress: Math.round(progress),
        receivedChunks,
        totalChunks: parseInt(totalChunks)
      });
    }

    res.json({
      success: true,
      fileId,
      chunkIndex: parseInt(chunkIndex),
      receivedChunks,
      totalChunks: parseInt(totalChunks),
      progress: Math.round(progress)
    });

  } catch (error) {
    console.error('Chunk upload error:', error);
    // Clean up temp file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ 
      error: 'Failed to upload chunk',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Complete upload (assemble chunks)
router.post('/complete', async (req: Request, res: Response) => {
  try {
    const { fileId, totalChunks, fileName, fileType } = req.body;

    if (!fileId || !totalChunks || !fileName || !fileType) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    console.log(`📦 Assembling file: ${fileName} (${totalChunks} chunks)`);

    // Verify all chunks received
    const receivedChunks = await redis.scard(`upload:${fileId}:chunks`);
    if (receivedChunks !== totalChunks) {
      console.error(`❌ Missing chunks: received ${receivedChunks}, expected ${totalChunks}`);
      return res.status(400).json({
        error: 'Missing chunks',
        received: receivedChunks,
        expected: totalChunks
      });
    }

    // List files in upload directory for debugging
    const uploadFiles = await fs.readdir(UPLOAD_DIR);
    console.log('📁 Chunk files:', uploadFiles.filter(f => f.includes(fileId)));

    // Assemble file from chunks
    const outputPath = path.join(PROCESSED_DIR, `${fileId}_${fileName}`);
    const chunks: Buffer[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(UPLOAD_DIR, `${fileId}_chunk_${i}`);
      
      try {
        await fs.access(chunkPath);
        const chunkData = await fs.readFile(chunkPath);
        chunks.push(chunkData);
        console.log(`✓ Read chunk ${i} (${chunkData.length} bytes)`);
      } catch (err) {
        console.error(`❌ Failed to read chunk ${i} at ${chunkPath}:`, err);
        throw new Error(`Missing chunk ${i}`);
      }
    }

    // Write assembled file
    const assembledBuffer = Buffer.concat(chunks);
    await fs.writeFile(outputPath, assembledBuffer);
    console.log(`✓ File assembled: ${outputPath} (${assembledBuffer.length} bytes)`);

    // Delete chunks
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(UPLOAD_DIR, `${fileId}_chunk_${i}`);
      await fs.unlink(chunkPath).catch(() => {});
    }

    // Calculate file hash
    const hash = crypto.createHash('sha256').update(assembledBuffer).digest('hex');

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
      uploadedAt: new Date().toISOString()
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
