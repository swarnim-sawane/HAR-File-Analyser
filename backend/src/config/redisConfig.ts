import { readFileSync } from 'fs';
import type { RedisOptions } from 'ioredis';

export interface RedisConnectionConfig {
  url?: string;
  options: RedisOptions;
  source: 'REDIS_URL' | 'REDIS_HOST' | 'development-default';
}

export interface RedisConnectionDiagnostics {
  source: RedisConnectionConfig['source'];
  hostname: string;
  port: number;
  tls: boolean;
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
  const configuredHost = env.REDIS_HOST?.trim() || undefined;
  const host = configuredHost || (hosted ? undefined : 'localhost');
  const source: RedisConnectionConfig['source'] = url
    ? 'REDIS_URL'
    : configuredHost
      ? 'REDIS_HOST'
      : 'development-default';

  if (!url && !host) {
    throw new Error('Hosted Deployment requires REDIS_URL or REDIS_HOST.');
  }
  // A complete REDIS_URL is authoritative. In OCI GenAI Hosted Applications,
  // the injected URL can point to a plaintext loopback proxy even when the
  // managed cache connection behind that proxy is secured by the platform.
  // Applying REDIS_TLS on top of that URL creates a contradictory client
  // configuration, so the separate flag is only valid for host-based setups.
  const urlUsesTls = Boolean(url?.toLowerCase().startsWith('rediss://'));
  const tlsEnabled = url ? urlUsesTls : enabled(env.REDIS_TLS);

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

  return { url, options, source };
}

export function describeRedisConnectionConfig(config: RedisConnectionConfig): RedisConnectionDiagnostics {
  if (config.url) {
    const parsed = new URL(config.url);
    return {
      source: config.source,
      hostname: parsed.hostname,
      port: Number.parseInt(parsed.port || '6379', 10),
      tls: parsed.protocol.toLowerCase() === 'rediss:' || Boolean(config.options.tls),
    };
  }

  return {
    source: config.source,
    hostname: String(config.options.host || 'localhost'),
    port: Number(config.options.port || 6379),
    tls: Boolean(config.options.tls),
  };
}
