import { describe, expect, it } from 'vitest';
import { buildCacheConnectionConfig } from './database';

describe('buildCacheConnectionConfig', () => {
  it('uses OCI Cache URL with TLS and auth when provided', () => {
    const config = buildCacheConnectionConfig({
      OCI_CACHE_URL: 'rediss://cache.example.oraclecloud.com:6379',
      OCI_CACHE_USERNAME: 'default',
      OCI_CACHE_PASSWORD: 'secret',
      OCI_CACHE_TLS: 'true',
    });

    expect(config.url).toBe('rediss://cache.example.oraclecloud.com:6379');
    expect(config.description).toBe('cache.example.oraclecloud.com:6379');
    expect(config.options.username).toBe('default');
    expect(config.options.password).toBe('secret');
    expect(config.options.tls).toEqual({});
  });

  it('supports host and port settings with OCI names first', () => {
    const config = buildCacheConnectionConfig({
      OCI_CACHE_HOST: 'oci-cache.internal',
      OCI_CACHE_PORT: '6380',
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6379',
    });

    expect(config.url).toBeUndefined();
    expect(config.description).toBe('oci-cache.internal:6380');
    expect(config.options.host).toBe('oci-cache.internal');
    expect(config.options.port).toBe(6380);
  });

  it('keeps local Redis-compatible defaults for development', () => {
    const config = buildCacheConnectionConfig({});

    expect(config.url).toBeUndefined();
    expect(config.description).toBe('localhost:6379');
    expect(config.options.host).toBe('localhost');
    expect(config.options.port).toBe(6379);
    expect(config.options.maxRetriesPerRequest).toBeNull();
  });
});
