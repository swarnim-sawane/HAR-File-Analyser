import { readFileSync } from 'fs';
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
  role: 'application' | 'worker' = 'application',
): RedisConnectionConfig {
  const url = env.REDIS_URL?.trim() || undefined;
  const hosted = env.HOSTED_DEPLOYMENT === 'true';
  const host = env.REDIS_HOST?.trim() || (hosted ? undefined : 'localhost');

  if (!url && !host) {
    throw new Error('Hosted Deployment requires REDIS_URL or REDIS_HOST.');
  }
  const urlUsesTls = Boolean(url?.toLowerCase().startsWith('rediss://'));
  const tlsEnabled = urlUsesTls || enabled(env.REDIS_TLS);
  if (hosted && !tlsEnabled) {
    throw new Error('Hosted Deployment requires TLS for OCI Cache. Use rediss:// or REDIS_TLS=true.');
  }

  const caFile = env.REDIS_TLS_CA_FILE?.trim();
  const ca = env.REDIS_TLS_CA?.replace(/\\n/g, '\n')
    || (env.REDIS_TLS_CA_BASE64 ? Buffer.from(env.REDIS_TLS_CA_BASE64, 'base64').toString('utf8') : undefined)
    || (caFile ? readFileSync(caFile, 'utf8') : undefined);
  const servername = env.REDIS_TLS_SERVERNAME?.trim()
    || (url ? new URL(url).hostname : host);

  const options: RedisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: role === 'worker' ? null : 2,
    enableReadyCheck: true,
    enableOfflineQueue: role === 'worker',
    connectTimeout: Number.parseInt(env.REDIS_CONNECT_TIMEOUT_MS || '10000', 10),
    ...(host ? {
      host,
      port: Number.parseInt(env.REDIS_PORT || '6379', 10),
    } : {}),
    ...(env.REDIS_USERNAME ? { username: env.REDIS_USERNAME } : {}),
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    ...(tlsEnabled ? { tls: { servername, ...(ca ? { ca } : {}) } } : {}),
    retryStrategy: (times) => Math.min(times * 50, 2000),
  };

  return { url, options };
}
