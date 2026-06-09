import { MongoClient, Db, type CreateIndexesOptions, type IndexSpecification } from 'mongodb';
import Redis, { type RedisOptions } from 'ioredis';
import { QdrantClient } from '@qdrant/js-client-rest';
import { reconcileConsoleLogEntryIndex } from './consoleLogIndexBootstrap';

let mongoClient: MongoClient;
let db: Db;
let redisClient: Redis;
let qdrantClient: QdrantClient;

interface CacheConnectionConfig {
  url?: string;
  options: RedisOptions;
  description: string;
}

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function firstEnv(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

export function buildCacheConnectionConfig(env: NodeJS.ProcessEnv = process.env): CacheConnectionConfig {
  const url = firstEnv(env, ['OCI_CACHE_URL', 'CACHE_URL', 'REDIS_URL']);
  const username = firstEnv(env, ['OCI_CACHE_USERNAME', 'CACHE_USERNAME', 'REDIS_USERNAME']);
  const password = firstEnv(env, ['OCI_CACHE_PASSWORD', 'CACHE_PASSWORD', 'REDIS_PASSWORD']);
  const tlsEnabled = parseBoolean(firstEnv(env, ['OCI_CACHE_TLS', 'CACHE_TLS', 'REDIS_TLS']));

  const options: RedisOptions = {
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    enableOfflineQueue: true,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(tlsEnabled ? { tls: {} } : {}),
  };

  if (url) {
    return {
      url,
      options,
      description: new URL(url).host,
    };
  }

  const host = firstEnv(env, ['OCI_CACHE_HOST', 'CACHE_HOST', 'REDIS_HOST']) || 'localhost';
  const port = parsePort(firstEnv(env, ['OCI_CACHE_PORT', 'CACHE_PORT', 'REDIS_PORT']), 6379);
  const db = firstEnv(env, ['OCI_CACHE_DB', 'CACHE_DB', 'REDIS_DB']);

  return {
    options: {
      ...options,
      host,
      port,
      ...(db ? { db: Number.parseInt(db, 10) || 0 } : {}),
    },
    description: `${host}:${port}`,
  };
}

interface ExistingMongoIndex {
  key?: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: unknown;
}

interface MongoIndexCollection {
  indexes: () => Promise<ExistingMongoIndex[]>;
  createIndex: (indexSpec: IndexSpecification, options?: CreateIndexesOptions) => Promise<string>;
}

function normalizeIndexKey(key: IndexSpecification | Record<string, unknown> | undefined): string {
  if (typeof key === 'string') return JSON.stringify([[key, 1]]);
  if (Array.isArray(key)) return JSON.stringify(key);
  return JSON.stringify(Object.entries(key ?? {}));
}

function stableStringify(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return JSON.stringify(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (value as Record<string, unknown>)[key];
        return acc;
      }, {}),
  );
}

function hasEquivalentIndex(
  indexes: ExistingMongoIndex[],
  indexSpec: IndexSpecification,
  options: CreateIndexesOptions,
): boolean {
  const requestedKey = normalizeIndexKey(indexSpec);

  return indexes.some((index) => {
    if (normalizeIndexKey(index.key) !== requestedKey) return false;
    if (Boolean(index.unique) !== Boolean(options.unique)) return false;
    if (Boolean(index.sparse) !== Boolean(options.sparse)) return false;
    if ((index.expireAfterSeconds ?? null) !== (options.expireAfterSeconds ?? null)) return false;
    if (
      stableStringify(index.partialFilterExpression ?? null) !==
      stableStringify(options.partialFilterExpression ?? null)
    ) {
      return false;
    }

    return true;
  });
}

export async function ensureMongoIndex(
  collection: MongoIndexCollection,
  indexSpec: IndexSpecification,
  options: CreateIndexesOptions = {},
): Promise<string | undefined> {
  const indexes = await collection.indexes();
  if (hasEquivalentIndex(indexes, indexSpec, options)) {
    return undefined;
  }

  return collection.createIndex(indexSpec, options);
}

export async function connectDatabases() {
  try {
    // MongoDB
    const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017/har-analyzer';
    mongoClient = new MongoClient(mongoUrl, {
      // Allow up to 20 simultaneous connections.
      // Default is 5, which causes queuing when 4 backend instances + 2 workers
      // all fire insertMany concurrently.
      maxPoolSize: 20,
      // Don't wait forever if a connection can't be obtained from the pool.
      waitQueueTimeoutMS: 10000,
      // Keep-alive helps avoid silent TCP drops on Oracle Linux VMs.
      socketTimeoutMS: 60000,
      connectTimeoutMS: 10000,
    });
    await mongoClient.connect();
    db = mongoClient.db();
    
    console.log('✅ MongoDB connected');
    
    // ✅ ENHANCED: Create comprehensive indexes for performance
    console.log('📊 Creating MongoDB indexes...');
    
    // HAR Files metadata indexes
    await ensureMongoIndex(db.collection('har_files'), { fileId: 1 }, { unique: true });
    await ensureMongoIndex(db.collection('har_files'), { uploadedAt: -1 });
    await ensureMongoIndex(db.collection('har_files'), { status: 1 });
    
    // HAR Entries indexes (for fast queries and filtering)
    await ensureMongoIndex(db.collection('har_entries'), { fileId: 1 });
    await ensureMongoIndex(db.collection('har_entries'), { fileId: 1, index: 1 });
    await ensureMongoIndex(db.collection('har_entries'), { fileId: 1, 'request.method': 1 });
    await ensureMongoIndex(db.collection('har_entries'), { fileId: 1, 'response.status': 1 });
    await ensureMongoIndex(db.collection('har_entries'), { fileId: 1, 'request.url': 1 });
    await ensureMongoIndex(db.collection('har_entries'), { fileId: 1, 'response.content.mimeType': 1 });
    
    // Console Log Files metadata indexes
    await ensureMongoIndex(db.collection('console_log_files'), { fileId: 1 }, { unique: true });
    await ensureMongoIndex(db.collection('console_log_files'), { uploadedAt: -1 });
    await ensureMongoIndex(db.collection('console_log_files'), { status: 1 });
    
    // Console Logs indexes (for fast queries and filtering)
    await ensureMongoIndex(db.collection('console_logs'), { fileId: 1 });
    await reconcileConsoleLogEntryIndex(db.collection('console_logs'));
    await ensureMongoIndex(db.collection('console_logs'), { fileId: 1, level: 1, index: 1 });
    await ensureMongoIndex(db.collection('console_logs'), { fileId: 1, source: 1, index: 1 });
    await ensureMongoIndex(db.collection('console_logs'), { fileId: 1, timestamp: 1, index: 1 });
    await ensureMongoIndex(db.collection('console_logs'), { fileId: 1, issueTags: 1, index: 1 });
    await ensureMongoIndex(db.collection('console_logs'), { fileId: 1, inferredSeverity: 1, index: 1 });
    await ensureMongoIndex(db.collection('console_logs'), { fileId: 1, parseStatus: 1, index: 1 });
    await ensureMongoIndex(db.collection('console_logs'), { fileId: 1, parseFormat: 1, index: 1 });
    await ensureMongoIndex(db.collection('console_logs'), { fileId: 1, parseWarnings: 1, index: 1 });
    
    console.log('✅ MongoDB indexes created');
    
    // Cache/queue backend: local Redis-compatible service or Oracle-managed OCI Cache.
    const cacheConfig = buildCacheConnectionConfig();
    redisClient = cacheConfig.url
      ? new Redis(cacheConfig.url, cacheConfig.options)
      : new Redis(cacheConfig.options);
    
    redisClient.on('error', (err) => {
      console.error('❌ Cache error:', err);
    });
    
    redisClient.on('connect', () => {
      console.log(`✅ Cache connected: ${cacheConfig.description}`);
    });
    
    redisClient.on('ready', () => {
      console.log('✅ Cache ready');
    });
    
    // Qdrant (Optional - for future AI embeddings)
    try {
      qdrantClient = new QdrantClient({
        url: process.env.QDRANT_URL || 'http://localhost:6333'
      });
      
      // Create collections if they don't exist
      const collections = await qdrantClient.getCollections();
      const collectionNames = collections.collections.map(c => c.name);
      
      if (!collectionNames.includes('har_embeddings')) {
        await qdrantClient.createCollection('har_embeddings', {
          vectors: {
            size: 768, // nomic-embed-text dimension
            distance: 'Cosine'
          },
          optimizers_config: {
            indexing_threshold: 10000
          }
        });
        console.log('✅ Created Qdrant collection: har_embeddings');
      }
      
      if (!collectionNames.includes('log_embeddings')) {
        await qdrantClient.createCollection('log_embeddings', {
          vectors: {
            size: 768,
            distance: 'Cosine'
          },
          optimizers_config: {
            indexing_threshold: 10000
          }
        });
        console.log('✅ Created Qdrant collection: log_embeddings');
      }
      
      console.log('✅ Qdrant connected (optional - for AI features)');
    } catch (error) {
      console.warn('⚠️ Qdrant not available (optional - app will work without AI features):', (error as Error).message);
      // Don't throw error - Qdrant is optional
    }
    
    console.log('🎉 All databases connected successfully!');
    
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

export function getMongoDb(): Db {
  if (!db) {
    throw new Error('Database not connected');
  }
  return db;
}

export function getRedis(): Redis {
  if (!redisClient) {
    throw new Error('Redis not connected');
  }
  return redisClient;
}

export function getQdrant(): QdrantClient {
  if (!qdrantClient) {
    throw new Error('Qdrant not connected (optional - only needed for AI features)');
  }
  return qdrantClient;
}

export async function closeDatabases() {
  console.log('🔌 Closing database connections...');
  
  if (mongoClient) {
    await mongoClient.close();
    console.log('✅ MongoDB closed');
  }
  
  if (redisClient) {
    await redisClient.quit();
    console.log('✅ Redis closed');
  }
  
  // Qdrant doesn't need explicit close
  console.log('✅ All databases closed');
}
