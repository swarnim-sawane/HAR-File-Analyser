import { Queue } from 'bullmq';
import { getRedis, getMongoDb } from '../config/database';
import { HAR_QUEUE_NAME } from '../config/queueNames';
import { streamParseHar, ParsedHarEntry } from '../services/streamingParser';
import { promises as fs } from 'fs';
import { publishToFile } from '../utils/socketHelper';

// ✅ REMOVED: import { emitToFile } from '../utils/socketHelper';
// Now using Redis pub/sub instead

// FIXED: Don't call getRedis() at module load time
let redis: any = null;
let harQueue: Queue | null = null;

// Initialize queue after database connection
export function initHarQueue(): Queue {
  if (!harQueue) {
    redis = getRedis();
    harQueue = new Queue(HAR_QUEUE_NAME, { connection: redis });
  }
  return harQueue;
}

interface HarJobData {
  fileId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string;
  hash: string;
  uploadedAt: string;
}

/**
 * Process HAR file: parse, store, and calculate stats
 * ✅ FIXED: No more memory accumulation
 * ✅ FIXED: Stats calculated on-the-fly
 * ✅ FIXED: Embeddings skipped (optional for future)
 * ✅ FIXED: Events emitted via Redis pub/sub for cross-process communication
 */
export async function processHarFile(data: HarJobData): Promise<void> {
  const { fileId, fileName, filePath, fileSize } = data;
  
  // Initialize redis if not already done
  if (!redis) {
    redis = getRedis();
  }

  console.log(`📂 Processing HAR file: ${fileName} (${fileSize} bytes)`);
  
  try {
    // Update status
    await updateFileStatus(fileId, 'parsing');

    // ✅ FIXED: Calculate stats on-the-fly instead of storing all entries
    const statsAccumulator = {
      totalRequests: 0,
      totalSize: 0,
      totalTime: 0,
      statusCodes: {} as Record<number, number>,
      methods: {} as Record<string, number>,
      domains: {} as Record<string, number>,
      contentTypes: {} as Record<string, number>,
      minTime: Infinity,
      maxTime: 0,
      errors: 0
    };

    // Step 1: Parse HAR file and store entries in MongoDB
    const db = getMongoDb();
    const entriesCollection = db.collection('har_entries');
    let batchBuffer: ParsedHarEntry[] = [];
    // Larger batches = fewer MongoDB round-trips per file.
    // 2000 entries * ~2 KB avg = ~4 MB per insert, well within driver limits.
    const BATCH_SIZE = 2000;
    // Only push a progress event to Redis every N batches (= every 10 000 entries)
    // to avoid hammering Redis with a pub/sub round-trip on every batch.
    const PROGRESS_EMIT_EVERY = 5;
    let batchCount = 0;
    let totalEntries = 0; // ✅ FIXED: Just track count, not store entries
    // Pre-compiled URL host cache: avoids calling `new URL()` for the same
    // domain string over and over (common in large HAR files).
    const domainCache = new Map<string, string>();

    await streamParseHar(filePath, async (entry, index) => {
      batchBuffer.push(entry);

      // ✅ FIXED: Update stats on-the-fly (pass domain cache to avoid re-parsing URLs)
      updateStatsWithEntry(statsAccumulator, entry, domainCache);
      totalEntries++;

      // Batch insert every BATCH_SIZE entries
      if (batchBuffer.length >= BATCH_SIZE) {
        const createdAt = new Date();
        const toInsert = batchBuffer.map(e => ({
          ...e,
          fileId,
          createdAt
        }));

        await entriesCollection.insertMany(toInsert, { ordered: false });
        batchCount++;

        // Only emit to Redis every PROGRESS_EMIT_EVERY batches to reduce round-trips
        if (batchCount % PROGRESS_EMIT_EVERY === 0) {
          const progress = Math.min((totalEntries / 15000) * 80, 80);
          await emitProgress(fileId, 'parsing', progress);
        }

        batchBuffer = []; // Clear buffer

        // Force GC every 10 000 entries when flag is available
        if (totalEntries % 10000 === 0 && typeof global.gc === 'function') {
          global.gc();
        }
      }
    });

    // Insert remaining entries
    if (batchBuffer.length > 0) {
      const toInsert = batchBuffer.map(e => ({
        ...e,
        fileId,
        createdAt: new Date()
      }));
      await entriesCollection.insertMany(toInsert, { ordered: false });
      batchBuffer = []; // Clear buffer
    }

    console.log(`✓ Parsed ${totalEntries} HAR entries`);
    await emitProgress(fileId, 'parsing', 80);

    // ✅ FIXED: Embeddings are SKIPPED for now (add back later as optional background job)
    console.log(`⚡ Skipping embeddings for faster processing (can be added later)`);
    
    // Step 2: Finalize statistics
    await updateFileStatus(fileId, 'analyzing');
    const stats = finalizeStats(statsAccumulator, totalEntries);
    await redis.setex(`stats:${fileId}`, 86400, JSON.stringify(stats));
    await emitProgress(fileId, 'analyzing', 90);

    // Step 3: Store file metadata in MongoDB
    await db.collection('har_files').insertOne({
      fileId,
      fileName,
      filePath,
      fileSize,
      hash: data.hash,
      totalEntries,
      stats,
      uploadedAt: new Date(data.uploadedAt),
      processedAt: new Date(),
      status: 'ready'
    });

    // ✅ CRITICAL FIX: Wait for MongoDB write to be fully committed
    await new Promise(resolve => setTimeout(resolve, 200));

    // Update status to ready
    await updateFileStatus(fileId, 'ready', {
      totalEntries,
      stats
    });
    
    await emitProgress(fileId, 'complete', 100);
    console.log(`✅ HAR file processing complete: ${fileId} (${totalEntries} entries)`);
    
  } catch (error) {
    console.error(`❌ HAR processing failed for ${fileId}:`, error);
    await updateFileStatus(fileId, 'error', { error: (error as Error).message });
    throw error;
  }
}

/**
 * ✅ NEW: Update stats incrementally as entries are parsed
 * domainCache avoids re-running `new URL()` for the same URL string, which is
 * expensive and often repeated thousands of times in large HAR files.
 */
function updateStatsWithEntry(stats: any, entry: ParsedHarEntry, domainCache?: Map<string, string>): void {
  // Status codes
  const status = entry.response?.status || 0;
  stats.statusCodes[status] = (stats.statusCodes[status] || 0) + 1;
  if (status >= 400) stats.errors++;

  // Methods
  const method = entry.request?.method || 'UNKNOWN';
  stats.methods[method] = (stats.methods[method] || 0) + 1;

  // Domains — use cache to avoid repeated `new URL()` parsing
  const rawUrl = entry.request?.url || '';
  let domain: string;
  if (domainCache && domainCache.has(rawUrl)) {
    domain = domainCache.get(rawUrl)!;
  } else {
    try {
      domain = new URL(rawUrl).hostname || 'invalid';
    } catch (e) {
      domain = 'invalid';
    }
    if (domainCache && rawUrl) domainCache.set(rawUrl, domain);
  }
  stats.domains[domain] = (stats.domains[domain] || 0) + 1;

  // Content types
  const contentType = entry.response?.content?.mimeType?.split(';')[0] || 'unknown';
  stats.contentTypes[contentType] = (stats.contentTypes[contentType] || 0) + 1;

  // Timing
  const time = entry.time || 0;
  stats.totalTime += time;
  stats.minTime = Math.min(stats.minTime, time);
  stats.maxTime = Math.max(stats.maxTime, time);

  // Size
  stats.totalSize += entry.response?.bodySize || 0;
}

/**
 * ✅ NEW: Finalize stats after all entries are processed
 */
function finalizeStats(stats: any, totalEntries: number) {
  return {
    totalRequests: totalEntries,
    totalSize: stats.totalSize,
    totalTime: stats.totalTime,
    statusCodes: stats.statusCodes,
    methods: stats.methods,
    domains: stats.domains,
    contentTypes: stats.contentTypes,
    averageTime: totalEntries > 0 ? stats.totalTime / totalEntries : 0,
    minTime: stats.minTime === Infinity ? 0 : stats.minTime,
    maxTime: stats.maxTime,
    errors: stats.errors
  };
}

/**
 * Update file status in Redis + emit via Redis pub/sub
 * ✅ FIXED: Now uses Redis pub/sub instead of direct Socket.IO
 */
async function updateFileStatus(fileId: string, status: string, extra?: any): Promise<void> {
  const metadata = await redis.get(`file:${fileId}:metadata`);
  if (metadata) {
    const data = JSON.parse(metadata);
    data.status = status;
    if (extra) {
      Object.assign(data, extra);
    }
    await redis.setex(`file:${fileId}:metadata`, 86400, JSON.stringify(data));
  }
  
  await publishToFile(fileId, 'file:status', {
    status,
    ...extra
  });

  console.log(`📡 Published file:status event for ${fileId}: ${status}`);
}

/**
 * Emit progress via Redis pub/sub
 * ✅ FIXED: Now uses Redis pub/sub instead of direct Socket.IO
 */
async function emitProgress(fileId: string, stage: string, progress: number): Promise<void> {
  await publishToFile(fileId, 'processing:progress', {
    stage,
    progress: Math.round(progress)
  });
}
