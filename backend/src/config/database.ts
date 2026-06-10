import { QdrantClient } from '@qdrant/js-client-rest';
import { createOracleJsonDatabase, type OracleJsonDatabase } from '../persistence/oracleJsonStore';
import { OracleAqJobQueue, OracleCacheStore, OracleEventBus, type OracleQueueAdapter } from '../runtime/oracleRuntime';

let persistenceDb: OracleJsonDatabase | undefined;
let runtimeCache: OracleCacheStore | undefined;
let runtimeEventBus: OracleEventBus | undefined;
const runtimeQueues = new Map<string, OracleQueueAdapter>();
let qdrantClient: QdrantClient | undefined;

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

export async function connectDatabases() {
  try {
    const persistenceConfig = buildPersistenceConfig();
    persistenceDb = await createOracleJsonDatabase(persistenceConfig.oracle);
    console.log('Oracle JSON Database connected');
    console.log('Oracle JSON document table and indexes ready');

    runtimeCache = new OracleCacheStore(persistenceDb);
    runtimeEventBus = new OracleEventBus(persistenceDb);
    runtimeQueues.clear();
    await runtimeCache.ping();
    console.log('Oracle runtime cache, AQ queue, and event bridge ready');

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

export function getRuntimeCache(): OracleCacheStore {
  if (!runtimeCache) {
    throw new Error('Oracle runtime cache not connected');
  }
  return runtimeCache;
}

export function getEventBus(): OracleEventBus {
  if (!runtimeEventBus) {
    throw new Error('Oracle runtime event bridge not connected');
  }
  return runtimeEventBus;
}

export function getOracleQueue(queueName: string): OracleQueueAdapter {
  const db = getPersistenceDb();
  let queue = runtimeQueues.get(queueName);
  if (!queue) {
    queue = new OracleAqJobQueue(db, queueName, {
      autoCreate: process.env.ORACLE_AQ_AUTO_CREATE === undefined
        ? undefined
        : !/^(false|0|no)$/i.test(process.env.ORACLE_AQ_AUTO_CREATE),
      queuePrefix: process.env.ORACLE_AQ_QUEUE_PREFIX,
    });
    runtimeQueues.set(queueName, queue);
  }
  return queue;
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

  await runtimeCache?.quit();
  runtimeCache = undefined;
  runtimeEventBus = undefined;
  runtimeQueues.clear();
  console.log('Oracle runtime services closed');

  console.log('All backend dependency connections closed');
}
