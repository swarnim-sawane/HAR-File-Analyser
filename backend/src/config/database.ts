import Redis from 'ioredis';
import { buildRedisConnectionConfig, describeRedisConnectionConfig } from './redisConfig';
import {
  getInitialConnectionRetryOptions,
  getPostgresInitialConnectionRetryOptions,
  retryInitialConnection,
} from './initialConnectionRetry';
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
  const diagnostics = describeRedisConnectionConfig(config);
  console.log(
    `Redis configuration: role=${role} source=${diagnostics.source} `
    + `host=${diagnostics.hostname} port=${diagnostics.port} tls=${diagnostics.tls}`,
  );
  return config.url ? new Redis(config.url, config.options) : new Redis(config.options);
}

async function connectRedisForStartup(): Promise<Redis> {
  const retryOptions = getInitialConnectionRetryOptions();

  return retryInitialConnection(
    async () => {
      const client = createRedis('application');
      client.on('error', (error) => console.error('Redis error:', error));

      try {
        await client.connect();
        await client.ping();
        return client;
      } catch (error) {
        client.disconnect();
        client.removeAllListeners();
        throw error;
      }
    },
    retryOptions,
    ({ failedAttempt, nextAttempt, maxAttempts, delayMs }) => {
      console.warn(
        `Redis initial connection attempt ${failedAttempt}/${maxAttempts} failed; `
        + `retrying with attempt ${nextAttempt}/${maxAttempts} in ${delayMs}ms`,
      );
    },
  );
}

async function connectPostgresForStartup(): Promise<PostgresStore> {
  const retryOptions = getPostgresInitialConnectionRetryOptions();

  return retryInitialConnection(
    async () => connectPostgres(),
    retryOptions,
    ({ failedAttempt, nextAttempt, maxAttempts, delayMs }) => {
      console.warn(
        `PostgreSQL initial connection attempt ${failedAttempt}/${maxAttempts} failed; `
        + `retrying with attempt ${nextAttempt}/${maxAttempts} in ${delayMs}ms`,
      );
    },
  );
}

export async function connectDatabases(): Promise<void> {
  try {
    await connectPostgresForStartup();
    console.log('PostgreSQL connected and schema migrations applied');

    redisClient = await connectRedisForStartup();
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
