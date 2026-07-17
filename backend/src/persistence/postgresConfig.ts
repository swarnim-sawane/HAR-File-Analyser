import { readFileSync } from 'fs';
import type { PoolConfig } from 'pg';

export type PostgresSslMode = 'disable' | 'require' | 'verify-full';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readCa(env: NodeJS.ProcessEnv): string | undefined {
  if (env.POSTGRES_SSL_CA?.trim()) return env.POSTGRES_SSL_CA.replace(/\\n/g, '\n');
  if (env.POSTGRES_SSL_CA_BASE64?.trim()) {
    return Buffer.from(env.POSTGRES_SSL_CA_BASE64, 'base64').toString('utf8');
  }
  const file = env.POSTGRES_SSL_CA_FILE?.trim() || env.PGSSLROOTCERT?.trim();
  return file ? readFileSync(file, 'utf8') : undefined;
}

export function buildPostgresPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const hosted = env.HOSTED_DEPLOYMENT === 'true';
  const connectionString = env.DATABASE_URL?.trim()
    || env.POSTGRES_URL?.trim()
    || (hosted ? '' : 'postgresql://postgres:postgres@localhost:5432/har_analyzer');
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for Hosted Deployment.');
  }

  const sslMode = (env.POSTGRES_SSL_MODE?.trim().toLowerCase()
    || (hosted ? 'verify-full' : 'disable')) as PostgresSslMode;
  if (!['disable', 'require', 'verify-full'].includes(sslMode)) {
    throw new Error('POSTGRES_SSL_MODE must be disable, require, or verify-full.');
  }
  if (hosted && sslMode === 'disable') {
    throw new Error('Hosted Deployment requires TLS for PostgreSQL.');
  }

  const ca = readCa(env);
  if (sslMode === 'verify-full' && !ca) {
    throw new Error('POSTGRES_SSL_CA, POSTGRES_SSL_CA_BASE64, or POSTGRES_SSL_CA_FILE is required for verify-full.');
  }

  return {
    connectionString,
    max: positiveInteger(env.POSTGRES_POOL_MAX, 20),
    connectionTimeoutMillis: positiveInteger(env.POSTGRES_CONNECT_TIMEOUT_MS, 10_000),
    idleTimeoutMillis: positiveInteger(env.POSTGRES_IDLE_TIMEOUT_MS, 30_000),
    statement_timeout: positiveInteger(env.POSTGRES_STATEMENT_TIMEOUT_MS, 60_000),
    application_name: env.POSTGRES_APPLICATION_NAME?.trim() || 'har-analyzer',
    ssl: sslMode === 'disable'
      ? false
      : {
          rejectUnauthorized: sslMode === 'verify-full',
          ...(ca ? { ca } : {}),
        },
  };
}
