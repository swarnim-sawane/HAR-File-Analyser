import Redis, { type RedisOptions } from 'ioredis';
import { QdrantClient } from '@qdrant/js-client-rest';
import { createOracleJsonDatabase, type OracleJsonDatabase } from '../persistence/oracleJsonStore';

let persistenceDb: OracleJsonDatabase | undefined;
let redisClient: Redis | undefined;
let qdrantClient: QdrantClient | undefined;

interface CacheConnectionConfig {
  url?: string;
  options: RedisOptions;
  description: string;
}

interface OraclePersistenceConfig {
  user: string;
  password: string;
  connectString: string;
  tableName?: string;
  poolMin?: number;
  poolMax?: number;
}

export interface PersistenceConfig {
  backend: 'oracle-json';
  oracle: OraclePersistenceConfig;
}

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function firstEnv(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

export function buildPersistenceConfig(env: NodeJS.ProcessEnv = process.env): PersistenceConfig {
  const backend = String(env.PERSISTENCE_BACKEND || env.DATABASE_BACKEND || 'oracle-json')
    .trim()
    .toLowerCase();

  if (backend !== 'oracle-json' && backend !== 'oracle') {
    throw new Error('This branch is Oracle-only. Set PERSISTENCE_BACKEND=oracle-json.');
  }

  const user = firstEnv(env, ['ORACLE_DB_USER', 'ORACLE_USER']);
  const password = firstEnv(env, ['ORACLE_DB_PASSWORD', 'ORACLE_PASSWORD']);
  const connectString = firstEnv(env, ['ORACLE_DB_CONNECT_STRING', 'ORACLE_CONNECT_STRING']);

  if (!user || !password || !connectString) {
    throw new Error(
      'Oracle JSON persistence requires ORACLE_DB_USER, ORACLE_DB_PASSWORD, and ORACLE_DB_CONNECT_STRING.',
    );
  }

  return {
    backend: 'oracle-json',
    oracle: {
      user,
      password,
      connectString,
      tableName: firstEnv(env, ['ORACLE_JSON_TABLE']),
      poolMin: parseOptionalPositiveInt(firstEnv(env, ['ORACLE_DB_POOL_MIN'])),
      poolMax: parseOptionalPositiveInt(firstEnv(env, ['ORACLE_DB_POOL_MAX'])),
    },
  };
}

export function getPersistenceBackend(): 'oracle-json' {
  return 'oracle-json';
}

export function getPersistenceLabel(): string {
  return 'Oracle JSON Database';
}

export function buildCacheConnectionConfig(env: NodeJS.ProcessEnv = process.env): CacheConnectionConfig {
  const url = firstEnv(env, ['OCI_CACHE_URL', 'CACHE_URL', 'REDIS_URL']);
  const username = firstEnv(env, ['OCI_CACHE_USERNAME', 'CACHE_USERNAME', 'REDIS_USERNAME']);
  const password = firstEnv(env, ['OCI_CACHE_PASSWORD', 'CACHE_PASSWORD', 'REDIS_PASSWORD']);
  const tlsEnabled = parseBoolean(firstEnv(env, ['OCI_CACHE_TLS', 'CACHE_TLS', 'REDIS_TLS']));

  const options: RedisOptions = {
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: null,
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

export async function connectDatabases() {
  try {
    const persistenceConfig = buildPersistenceConfig();
    persistenceDb = await createOracleJsonDatabase(persistenceConfig.oracle);
    console.log('Oracle JSON Database connected');
    console.log('Oracle JSON document table and indexes ready');

    const cacheConfig = buildCacheConnectionConfig();
    redisClient = cacheConfig.url
      ? new Redis(cacheConfig.url, cacheConfig.options)
      : new Redis(cacheConfig.options);

    redisClient.on('error', (err) => {
      console.error('Cache error:', err);
    });

    redisClient.on('connect', () => {
      console.log(`Cache connected: ${cacheConfig.description}`);
    });

    redisClient.on('ready', () => {
      console.log('Cache ready');
    });

    try {
      qdrantClient = new QdrantClient({
        url: process.env.QDRANT_URL || 'http://localhost:6333',
      });

      const collections = await qdrantClient.getCollections();
      const collectionNames = collections.collections.map((collection) => collection.name);

      if (!collectionNames.includes('har_embeddings')) {
        await qdrantClient.createCollection('har_embeddings', {
          vectors: {
            size: 768,
            distance: 'Cosine',
          },
          optimizers_config: {
            indexing_threshold: 10000,
          },
        });
        console.log('Created Qdrant collection: har_embeddings');
      }

      if (!collectionNames.includes('log_embeddings')) {
        await qdrantClient.createCollection('log_embeddings', {
          vectors: {
            size: 768,
            distance: 'Cosine',
          },
          optimizers_config: {
            indexing_threshold: 10000,
          },
        });
        console.log('Created Qdrant collection: log_embeddings');
      }

      console.log('Qdrant connected (optional - for AI features)');
    } catch (error) {
      console.warn('Qdrant not available (optional - app will work without embedding search):', (error as Error).message);
    }

    console.log('All backend dependencies connected successfully');
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
}

export function getPersistenceDb(): OracleJsonDatabase {
  if (!persistenceDb) {
    throw new Error('Oracle JSON Database not connected');
  }
  return persistenceDb;
}

export function getRedis(): Redis {
  if (!redisClient) {
    throw new Error('Cache not connected');
  }
  return redisClient;
}

export function getQdrant(): QdrantClient {
  if (!qdrantClient) {
    throw new Error('Qdrant not connected (optional - only needed for embedding search)');
  }
  return qdrantClient;
}

export async function closeDatabases() {
  console.log('Closing backend dependency connections...');

  if (persistenceDb) {
    await persistenceDb.close();
    persistenceDb = undefined;
    console.log('Oracle JSON Database closed');
  }

  if (redisClient) {
    await redisClient.quit();
    redisClient = undefined;
    console.log('Cache closed');
  }

  console.log('All backend dependency connections closed');
}
