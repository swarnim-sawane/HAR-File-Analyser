import Redis from 'ioredis';
import { buildRedisConnectionConfig } from './redisConfig';
import {
  closePostgres,
  connectPostgres,
  getPostgresStore,
  type PostgresStore,
} from '../persistence/postgresStore';

let redisClient: Redis | null = null;
let workerRedisClient: Redis | null = null;

function createRedis(role: 'application' | 'worker'): Redis {
  const config = buildRedisConnectionConfig(process.env, role);
  return config.url ? new Redis(config.url, config.options) : new Redis(config.options);
}

export async function connectDatabases(): Promise<void> {
  try {
    await connectPostgres();
    console.log('PostgreSQL connected and schema migrations applied');

    redisClient = createRedis('application');
    redisClient.on('error', (error) => console.error('Redis error:', error));
    await redisClient.connect();
    await redisClient.ping();
    console.log('Redis connected and responding to ping');
    console.log('All persistence services connected successfully');
  } catch (error) {
    console.error('Persistence connection failed:', error);
    await closeDatabases().catch(() => undefined);
    throw error;
  }
}

export function getDatabase(): PostgresStore {
  return getPostgresStore();
}

export function getRedis(): Redis {
  if (!redisClient) throw new Error('Redis is not connected.');
  return redisClient;
}

export function getWorkerRedis(): Redis {
  if (!workerRedisClient) {
    workerRedisClient = createRedis('worker');
    workerRedisClient.on('error', (error) => console.error('Worker Redis error:', error));
  }
  return workerRedisClient;
}

export async function closeDatabases(): Promise<void> {
  console.log('Closing persistence connections...');
  await closePostgres();
  if (redisClient) {
    const current = redisClient;
    redisClient = null;
    await current.quit().catch(() => current.disconnect());
  }
  if (workerRedisClient) {
    const current = workerRedisClient;
    workerRedisClient = null;
    await current.quit().catch(() => current.disconnect());
  }
  console.log('Persistence connections closed');
}
