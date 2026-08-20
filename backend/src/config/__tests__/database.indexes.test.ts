import { describe, expect, it } from 'vitest';
import { buildPostgresPoolConfig } from '../../persistence/postgresConfig';

describe('PostgreSQL connection configuration', () => {
  it('uses a local database without TLS for development', () => {
    const config = buildPostgresPoolConfig({});
    expect(config.connectionString).toContain('localhost:5432/har_analyzer');
    expect(config.ssl).toBe(false);
  });

  it('requires a CA-backed TLS connection in Hosted Deployment', () => {
    expect(() => buildPostgresPoolConfig({
      HOSTED_DEPLOYMENT: 'true',
      DATABASE_URL: 'postgresql://user:secret@db.example:5432/app',
    })).toThrow(/POSTGRES_SSL_CA/);

    const config = buildPostgresPoolConfig({
      HOSTED_DEPLOYMENT: 'true',
      DATABASE_URL: 'postgresql://user:secret@db.example:5432/app',
      POSTGRES_SSL_CA: 'test-ca',
    });
    expect(config.ssl).toMatchObject({ rejectUnauthorized: true, ca: 'test-ca' });
  });

  it('rejects plaintext PostgreSQL in Hosted Deployment', () => {
    expect(() => buildPostgresPoolConfig({
      HOSTED_DEPLOYMENT: 'true',
      DATABASE_URL: 'postgresql://user:secret@db.example:5432/app',
      POSTGRES_SSL_MODE: 'disable',
    })).toThrow(/requires TLS/);
  });

  it('uses a client-side query timeout without sending a PostgreSQL startup parameter', () => {
    const config = buildPostgresPoolConfig({
      HOSTED_DEPLOYMENT: 'true',
      DATABASE_URL: 'postgresql://user:secret@db.example:5432/app',
      POSTGRES_SSL_CA: 'test-ca',
      POSTGRES_QUERY_TIMEOUT_MS: '45000',
    });

    expect(config.query_timeout).toBe(45_000);
    expect(config.statement_timeout).toBeUndefined();
  });

  it('keeps the former timeout environment variable as a compatibility fallback', () => {
    const config = buildPostgresPoolConfig({
      HOSTED_DEPLOYMENT: 'true',
      DATABASE_URL: 'postgresql://user:secret@db.example:5432/app',
      POSTGRES_SSL_CA: 'test-ca',
      POSTGRES_STATEMENT_TIMEOUT_MS: '30000',
    });

    expect(config.query_timeout).toBe(30_000);
    expect(config.statement_timeout).toBeUndefined();
  });
});
