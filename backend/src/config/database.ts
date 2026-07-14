import { MongoClient, Db, type CreateIndexesOptions, type IndexSpecification } from 'mongodb';
import Redis from 'ioredis';
import { reconcileConsoleLogEntryIndex } from './consoleLogIndexBootstrap';
import { buildRedisConnectionConfig } from './redisConfig';

let mongoClient: MongoClient;
let db: Db;
let redisClient: Redis;

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
    const mongoUrl = process.env.MONGODB_URL
      || (process.env.HOSTED_DEPLOYMENT === 'true' ? '' : 'mongodb://localhost:27017/har-analyzer');
    if (!mongoUrl) {
      throw new Error('Hosted Deployment requires MONGODB_URL.');
    }
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

    // Redis - FIXED for BullMQ
    const redisConfig = buildRedisConnectionConfig();
    redisClient = redisConfig.url
      ? new Redis(redisConfig.url, redisConfig.options)
      : new Redis(redisConfig.options);

    redisClient.on('error', (err) => {
      console.error('❌ Redis error:', err);
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis connected');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis ready');
    });

    console.log('All databases connected successfully!');

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

  console.log('✅ All databases closed');
}
