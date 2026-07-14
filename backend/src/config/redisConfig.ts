import type { RedisOptions } from 'ioredis';

export interface RedisConnectionConfig {
  url?: string;
  options: RedisOptions;
}

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

export function buildRedisConnectionConfig(
  env: NodeJS.ProcessEnv = process.env,
): RedisConnectionConfig {
  const url = env.REDIS_URL?.trim() || undefined;
  const hosted = env.HOSTED_DEPLOYMENT === 'true';
  const host = env.REDIS_HOST?.trim() || (hosted ? undefined : 'localhost');

  if (!url && !host) {
    throw new Error('Hosted Deployment requires REDIS_URL or REDIS_HOST.');
  }

  const options: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: true,
    connectTimeout: Number.parseInt(env.REDIS_CONNECT_TIMEOUT_MS || '10000', 10),
    ...(host ? {
      host,
      port: Number.parseInt(env.REDIS_PORT || '6379', 10),
    } : {}),
    ...(env.REDIS_USERNAME ? { username: env.REDIS_USERNAME } : {}),
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    ...(enabled(env.REDIS_TLS) ? { tls: {} } : {}),
    retryStrategy: (times) => Math.min(times * 50, 2000),
  };

  return { url, options };
}
