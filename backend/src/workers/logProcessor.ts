import { Queue } from 'bullmq';
import { getRedis, getMongoDb } from '../config/database';
import { streamParseConsoleLog, ParsedLogEntry } from '../services/streamingParser';
import { emitToFile } from '../utils/socketHelper';

// FIXED: Don't call getRedis() at module load time
let redis: any = null;
let logQueue: Queue | null = null;

// Initialize queue after database connection
export function initLogQueue(): Queue {
  if (!logQueue) {
    redis = getRedis();
    logQueue = new Queue('log-processing', { connection: redis });
  }
  return logQueue;
}

interface LogJobData {
  fileId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string;
  hash: string;
  uploadedAt: string;
}

/**
 * Process console log file: parse, store, and calculate stats
 * ✅ FIXED: No more memory accumulation
 * ✅ FIXED: Stats calculated on-the-fly
 * ✅ FIXED: Embeddings skipped (optional for future)
 */
export async function processConsoleLog(data: LogJobData): Promise<void> {
  const { fileId, fileName, filePath, fileSize } = data;

  // Initialize redis if not already done
  if (!redis) {
    redis = getRedis();
  }

  console.log(`📋 Processing console log: ${fileName} (${fileSize} bytes)`);

  try {
    // Update status
    await updateFileStatus(fileId, 'parsing');

    // ✅ FIXED: Calculate stats on-the-fly instead of storing all entries
    const statsAccumulator = {
      levels: {} as Record<string, number>,
      sources: {} as Record<string, number>,
      errors: 0,
      warnings: 0,
      infos: 0
    };

    // Step 1: Parse log file and store entries in MongoDB
    const db = getMongoDb();
    const logsCollection = db.collection('console_logs');
    let batchBuffer: ParsedLogEntry[] = [];
    const BATCH_SIZE = 1000;
    let totalEntries = 0; // ✅ FIXED: Just track count, not store entries

    await streamParseConsoleLog(filePath, async (entry, index) => {
      batchBuffer.push(entry);

      // ✅ FIXED: Update stats on-the-fly
      updateStatsWithEntry(statsAccumulator, entry);
      totalEntries++;

      // Batch insert every 1000 entries
      if (batchBuffer.length >= BATCH_SIZE) {
        const toInsert = batchBuffer.map(e => ({
          ...e,
          fileId,
          createdAt: new Date()
        }));

        await logsCollection.insertMany(toInsert, { ordered: false });

        // Emit progress
        const progress = Math.min((totalEntries / 10000) * 80, 80); // Max 80% during parsing
        emitProgress(fileId, 'parsing', progress);

        batchBuffer = []; // Clear buffer

        // Force GC periodically for very large files
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
      await logsCollection.insertMany(toInsert, { ordered: false });
      batchBuffer = []; // Clear buffer
    }

    console.log(`✓ Parsed ${totalEntries} log entries`);
    emitProgress(fileId, 'parsing', 80);

    // ✅ FIXED: Embeddings are SKIPPED for now (add back later as optional background job)
    console.log(`⚡ Skipping embeddings for faster processing (can be added later)`);

    // Step 2: Finalize statistics
    await updateFileStatus(fileId, 'analyzing');
    const stats = finalizeStats(statsAccumulator, totalEntries);
    await redis.setex(`log_stats:${fileId}`, 86400, JSON.stringify(stats));
    emitProgress(fileId, 'analyzing', 90);

    // Step 3: Store file metadata in MongoDB
    await db.collection('console_log_files').insertOne({
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

    // Update status to ready
    await updateFileStatus(fileId, 'ready', {
      totalEntries,
      stats
    });

    emitProgress(fileId, 'complete', 100);
    console.log(`✅ Console log processing complete: ${fileId} (${totalEntries} entries)`);

  } catch (error) {
    console.error(`❌ Log processing failed for ${fileId}:`, error);
    await updateFileStatus(fileId, 'error', { error: (error as Error).message });
    throw error;
  }
}

/**
 * ✅ NEW: Update stats incrementally as entries are parsed
 */
function updateStatsWithEntry(stats: any, entry: ParsedLogEntry): void {
  // Levels
  const level = entry.level.toLowerCase();
  stats.levels[level] = (stats.levels[level] || 0) + 1;

  if (level === 'error') stats.errors++;
  if (level === 'warn' || level === 'warning') stats.warnings++;
  if (level === 'info') stats.infos++;

  // Sources
  const source = entry.source || 'unknown';
  stats.sources[source] = (stats.sources[source] || 0) + 1;
}

/**
 * ✅ NEW: Finalize stats after all entries are processed
 */
function finalizeStats(stats: any, totalEntries: number) {
  return {
    totalLogs: totalEntries,
    levels: stats.levels,
    sources: stats.sources,
    errors: stats.errors,
    warnings: stats.warnings,
    infos: stats.infos
  };
}

/**
 * Update file status in Redis
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

  // Emit WebSocket event using helper
  await redis.publish('socket:events', JSON.stringify({
    type: 'file:status',
    data: { fileId, status, ...extra }
  }));
}

/**
 * Emit progress via WebSocket
 */
function emitProgress(fileId: string, stage: string, progress: number): void {
  emitToFile(fileId, 'processing:progress', {
    fileId,
    stage,
    progress: Math.round(progress)
  });
}
