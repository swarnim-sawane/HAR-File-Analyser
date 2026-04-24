import { Queue } from 'bullmq';
import { getRedis, getMongoDb } from '../config/database';
import { LOG_QUEUE_NAME } from '../config/queueNames';
import { streamParseConsoleLog, ParsedLogEntry } from '../services/streamingParser';
import { publishToFile } from '../utils/socketHelper';

// FIXED: Don't call getRedis() at module load time
let redis: any = null;
let logQueue: Queue | null = null;

// Initialize queue after database connection
export function initLogQueue(): Queue {
  if (!logQueue) {
    redis = getRedis();
    logQueue = new Queue(LOG_QUEUE_NAME, { connection: redis });
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

  console.log(`📋 Processing console log: ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

  try {
    // Update status
    await updateFileStatus(fileId, 'parsing');

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
    let totalEntries = 0;
    let bytesProcessed = 0;
    // ✅ FIXED: track size of parsed entries for file-size-based progress
    // Average log line ≈ 200 bytes — we get a real estimate from totalEntries * avgLineSize
    let lastProgressEmit = 0;
    const PROGRESS_EMIT_EVERY = 5000; // emit progress every 5k entries

    await streamParseConsoleLog(filePath, async (entry, index) => {
      batchBuffer.push(entry);
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
        batchBuffer = [];

        // ✅ FIXED: Progress based on estimated bytes read vs total file size.
        // Use a rolling average of ~150 bytes/line (conservative for log lines).
        // Caps at 85% so the final "analyzing" phase has visible room.
        if (totalEntries - lastProgressEmit >= PROGRESS_EMIT_EVERY) {
          lastProgressEmit = totalEntries;
          const estimatedBytesRead = totalEntries * 150;
          const rawPct = fileSize > 0 ? (estimatedBytesRead / fileSize) * 85 : 50;
          const progress = Math.min(rawPct, 85);
          await emitProgress(fileId, 'parsing', progress);
          console.log(`  ↳ ${totalEntries.toLocaleString()} entries parsed (~${progress.toFixed(0)}%)`);
        }

        // Force GC periodically for very large files
        if (totalEntries % 50000 === 0 && typeof global.gc === 'function') {
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
    await emitProgress(fileId, 'parsing', 80);

    // ✅ FIXED: Embeddings are SKIPPED for now (add back later as optional background job)
    console.log(`⚡ Skipping embeddings for faster processing (can be added later)`);

    // Step 2: Finalize statistics
    await updateFileStatus(fileId, 'analyzing');
    const stats = finalizeStats(statsAccumulator, totalEntries);
    await redis.setex(`log_stats:${fileId}`, 86400, JSON.stringify(stats));
    await emitProgress(fileId, 'analyzing', 90);

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

    await emitProgress(fileId, 'complete', 100);
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

  await publishToFile(fileId, 'file:status', { status, ...extra });
}

/**
 * Emit progress via WebSocket
 */
async function emitProgress(fileId: string, stage: string, progress: number): Promise<void> {
  await publishToFile(fileId, 'processing:progress', {
    stage,
    progress: Math.round(progress)
  });
}
