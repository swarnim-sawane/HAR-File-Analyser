import axios from 'axios';
import { ollamaPool } from './ollamaPool';
import { getQdrant, getMongoDb, getRedis } from '../config/database';
import { harEntryToText, logEntryToText, ParsedHarEntry, ParsedLogEntry } from './streamingParser';
import { emitGlobal, emitToFile } from '../utils/socketHelper'; // NEW

const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

/**
 * Generate single embedding using Ollama nomic-embed-text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const instance = await ollamaPool.acquireInstance();
  
  try {
    const response = await axios.post(
      `${instance.url}/api/embeddings`,
      {
        model: EMBEDDING_MODEL,
        prompt: text
      },
      {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    return response.data.embedding;
  } catch (error) {
    console.error('Embedding generation failed:', error);
    throw error;
  } finally {
    ollamaPool.releaseInstance(instance);
  }
}

/**
 * Generate embeddings in batches with memory management
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  batchSize: number = 50,
  onProgress?: (progress: number) => void
): Promise<number[][]> {
  const embeddings: number[][] = [];
  const totalBatches = Math.ceil(texts.length / batchSize);
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    // Check memory usage
    checkMemoryUsage();
    
    // Generate embeddings in parallel within batch
    const batchEmbeddings = await Promise.all(
      batch.map(text => generateEmbedding(text))
    );
    
    embeddings.push(...batchEmbeddings);
    
    // Report progress
    const currentBatch = Math.floor(i / batchSize) + 1;
    const progress = (currentBatch / totalBatches) * 100;
    
    if (onProgress) {
      onProgress(progress);
    }
    
    // Emit WebSocket progress - FIXED
    emitGlobal('embedding:progress', {
      processed: embeddings.length,
      total: texts.length,
      progress: Math.round(progress)
    });
    
    // Small delay to prevent overwhelming Ollama
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Force GC every 20 batches if available
    if (currentBatch % 20 === 0 && global.gc) {
      global.gc();
    }
  }
  
  return embeddings;
}

/**
 * Index HAR entries into vector database
 */
export async function indexHarEntries(
  fileId: string,
  entries: ParsedHarEntry[]
): Promise<void> {
  const qdrant = getQdrant();
  const batchSize = 50;
  
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    
    // Convert entries to text
    const texts = batch.map(entry => harEntryToText(entry));
    
    // Generate embeddings
    const embeddings = await generateEmbeddingsBatch(texts, batchSize);
    
    // Prepare points for Qdrant
    const points = batch.map((entry, idx) => ({
      id: `${fileId}_${entry.index}`,
      vector: embeddings[idx],
      payload: {
        fileId,
        index: entry.index,
        url: entry.request?.url,
        method: entry.request?.method,
        status: entry.response?.status,
        time: entry.time,
        text: texts[idx]
      }
    }));
    
    // Bulk insert into Qdrant
    await qdrant.upsert('har_embeddings', {
      wait: true,
      points
    });
    
    // Emit progress - FIXED
    emitToFile(fileId, 'indexing:progress', {
      fileId,
      processed: i + batch.length,
      total: entries.length
    });
  }
}

/**
 * Index console log entries into vector database
 */
export async function indexLogEntries(
  fileId: string,
  entries: ParsedLogEntry[]
): Promise<void> {
  const qdrant = getQdrant();
  const batchSize = 50;
  
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    
    // Convert entries to text
    const texts = batch.map(entry => logEntryToText(entry));
    
    // Generate embeddings
    const embeddings = await generateEmbeddingsBatch(texts, batchSize);
    
    // Prepare points for Qdrant
    const points = batch.map((entry, idx) => ({
      id: `${fileId}_${entry.index}`,
      vector: embeddings[idx],
      payload: {
        fileId,
        index: entry.index,
        level: entry.level,
        timestamp: entry.timestamp,
        message: entry.message,
        text: texts[idx]
      }
    }));
    
    // Bulk insert into Qdrant
    await qdrant.upsert('log_embeddings', {
      wait: true,
      points
    });
    
    // Emit progress - FIXED
    emitToFile(fileId, 'indexing:progress', {
      fileId,
      processed: i + batch.length,
      total: entries.length
    });
  }
}

/**
 * Query with context from vector DB, with MongoDB fallback when vectors aren't available
 */
export async function queryWithContext(
  fileId: string,
  query: string,
  type: 'har' | 'log' = 'har'
): Promise<string> {
  // Try Qdrant vector search first (fast semantic search when embeddings exist)
  try {
    const qdrant = getQdrant();
    const collectionName = type === 'har' ? 'har_embeddings' : 'log_embeddings';

    const queryEmbedding = await generateEmbedding(query);
    const searchResults = await qdrant.search(collectionName, {
      vector: queryEmbedding,
      filter: {
        must: [{ key: 'fileId', match: { value: fileId } }]
      },
      limit: 5,
      with_payload: true
    });

    if (searchResults.length > 0) {
      const context = searchResults
        .map((result, idx) => {
          const payload = result.payload as any;
          return `${idx + 1}. ${payload.text}`;
        })
        .join('\n');
      return context;
    }
  } catch (err) {
    console.log('ℹ️ Qdrant/Ollama unavailable, falling back to MongoDB context:', (err as Error).message);
  }

  // MongoDB fallback: build context from stored stats + sample entries
  return buildMongoContext(fileId, type);
}

/**
 * Build LLM context from MongoDB data (stats + sample entries)
 * Used when Qdrant vectors are not available (e.g. embeddings skipped for performance)
 */
async function buildMongoContext(fileId: string, type: 'har' | 'log'): Promise<string> {
  const db = getMongoDb();
  const redis = getRedis();

  try {
    let context = '';

    if (type === 'har') {
      const file = await db.collection('har_files').findOne({ fileId });
      const cachedStats = await redis.get(`stats:${fileId}`);
      const stats = cachedStats ? JSON.parse(cachedStats) : null;

      if (file) {
        context += `HAR File: ${file.fileName}\n`;
        context += `File Size: ${Math.round((file.fileSize || 0) / 1024)}KB\n`;
      }

      if (stats) {
        context += `Total Requests: ${stats.totalRequests}\n`;
        context += `Error Count (4xx+5xx): ${stats.errors}\n`;
        context += `Average Response Time: ${Math.round(stats.averageTime || 0)}ms\n`;
        context += `Fastest: ${Math.round(stats.minTime || 0)}ms | Slowest: ${Math.round(stats.maxTime || 0)}ms\n`;
        context += `HTTP Methods: ${JSON.stringify(stats.methods)}\n`;
        context += `Status Codes: ${JSON.stringify(stats.statusCodes)}\n`;

        const topDomains = Object.entries(stats.domains || {})
          .sort(([, a], [, b]) => (b as number) - (a as number))
          .slice(0, 8)
          .map(([d, c]) => `${d} (${c})`)
          .join(', ');
        if (topDomains) context += `Top Domains: ${topDomains}\n`;

        const topTypes = Object.entries(stats.contentTypes || {})
          .sort(([, a], [, b]) => (b as number) - (a as number))
          .slice(0, 5)
          .map(([t, c]) => `${t.split('/')[1] || t} (${c})`)
          .join(', ');
        if (topTypes) context += `Content Types: ${topTypes}\n`;
      }

      // Sample entries — slowest requests first to surface performance issues
      const entries = await db.collection('har_entries')
        .find({ fileId })
        .sort({ time: -1 })
        .limit(20)
        .toArray();

      if (entries.length > 0) {
        context += `\nSample Requests (slowest first):\n`;
        entries.forEach((entry, idx) => {
          const url = entry.request?.url || 'unknown';
          const shortUrl = url.length > 100 ? url.substring(0, 100) + '…' : url;
          context += `${idx + 1}. ${entry.request?.method} ${shortUrl} → ${entry.response?.status} (${Math.round(entry.time || 0)}ms)\n`;
        });
      }

    } else {
      // Console log context
      const file = await db.collection('console_log_files').findOne({ fileId });
      const cachedStats = await redis.get(`stats:${fileId}`);
      const stats = cachedStats ? JSON.parse(cachedStats) : null;

      if (file) context += `Log File: ${file.fileName}\n`;

      if (stats) {
        context += `Total Log Entries: ${stats.totalLogs || 0}\n`;
        context += `Errors: ${stats.errorCount || 0} | Warnings: ${stats.warningCount || 0}\n`;
        context += `Log Levels: ${JSON.stringify(stats.byLevel || {})}\n`;
      }

      // Prioritise error/warn entries for context
      const errorEntries = await db.collection('console_logs')
        .find({ fileId, level: { $in: ['error', 'warn'] } })
        .sort({ timestamp: 1 })
        .limit(15)
        .toArray();

      if (errorEntries.length > 0) {
        context += `\nError & Warning Entries:\n`;
        errorEntries.forEach((entry, idx) => {
          context += `${idx + 1}. [${(entry.level || 'unknown').toUpperCase()}] ${entry.message}\n`;
          if (entry.source) context += `   Source: ${entry.source}\n`;
        });
      } else {
        const allEntries = await db.collection('console_logs')
          .find({ fileId })
          .sort({ timestamp: 1 })
          .limit(20)
          .toArray();

        if (allEntries.length > 0) {
          context += `\nRecent Log Entries:\n`;
          allEntries.forEach((entry, idx) => {
            context += `${idx + 1}. [${(entry.level || 'unknown').toUpperCase()}] ${entry.message}\n`;
          });
        }
      }
    }

    return context.trim() || 'No data found for this file.';
  } catch (err) {
    console.error('Failed to build MongoDB context:', err);
    return 'Unable to retrieve file context.';
  }
}

/**
 * Check memory usage and log warning if high
 */
function checkMemoryUsage(): void {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
  const usagePercent = (heapUsedMB / heapTotalMB) * 100;
  
  if (usagePercent > 80) {
    console.warn(`High memory usage: ${Math.round(heapUsedMB)}MB / ${Math.round(heapTotalMB)}MB (${Math.round(usagePercent)}%)`);
    
    if (global.gc) {
      console.log('Forcing garbage collection...');
      global.gc();
    }
  }
}
