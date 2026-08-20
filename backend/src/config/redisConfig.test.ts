import { describe, expect, it } from 'vitest';
import { buildRedisConnectionConfig, describeRedisConnectionConfig } from './redisConfig';

describe('buildRedisConnectionConfig', () => {
  it('keeps local Redis defaults for development', () => {
    const config = buildRedisConnectionConfig({});
    expect(config.url).toBeUndefined();
    expect(config.source).toBe('development-default');
    expect(config.options).toMatchObject({
      host: 'localhost',
      port: 6379,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  });

  it('uses the REDIS_URL scheme for hosted TLS', () => {
    const config = buildRedisConnectionConfig({
      HOSTED_DEPLOYMENT: 'true',
      REDIS_URL: 'rediss://cache.example:6379',
      REDIS_TLS: 'false',
    });
    expect(config.url).toBe('rediss://cache.example:6379');
    expect(config.source).toBe('REDIS_URL');
    expect(config.options.tls).toEqual({ servername: 'cache.example' });
    expect(config.options.host).toBeUndefined();
    expect(config.options.lazyConnect).toBe(true);
  });

  it('fails fast when hosted Redis configuration is absent', () => {
    expect(() => buildRedisConnectionConfig({ HOSTED_DEPLOYMENT: 'true' }))
      .toThrow(/REDIS_URL or REDIS_HOST/);
  });

  it('uses the injected plaintext loopback proxy URL without adding TLS', () => {
    const config = buildRedisConnectionConfig({
      HOSTED_DEPLOYMENT: 'true',
      REDIS_URL: 'redis://127.0.0.1:6379',
    });

    expect(config.url).toBe('redis://127.0.0.1:6379');
    expect(config.options.tls).toBeUndefined();
    expect(describeRedisConnectionConfig(config).tls).toBe(false);
  });

  it('ignores a contradictory REDIS_TLS override when REDIS_URL is supplied', () => {
    const config = buildRedisConnectionConfig({
      HOSTED_DEPLOYMENT: 'true',
      REDIS_URL: 'redis://127.0.0.1:6379',
      REDIS_TLS: 'true',
      REDIS_TLS_SERVERNAME: 'must-not-be-used.example',
    });

    expect(config.options.tls).toBeUndefined();
    expect(describeRedisConnectionConfig(config)).toMatchObject({
      source: 'REDIS_URL',
      hostname: '127.0.0.1',
      port: 6379,
      tls: false,
    });
  });

  it('still allows TLS for a host-based Redis configuration', () => {
    const config = buildRedisConnectionConfig({
      REDIS_HOST: 'cache.example',
      REDIS_TLS: 'true',
    });

    expect(config.url).toBeUndefined();
    expect(config.options.tls).toEqual({ servername: 'cache.example' });
  });

  it('describes a managed Redis target without exposing URL credentials', () => {
    const config = buildRedisConnectionConfig({
      HOSTED_DEPLOYMENT: 'true',
      REDIS_URL: 'rediss://managed-user:super-secret@cache.example:6380/0?token=hidden',
    });

    const diagnostics = describeRedisConnectionConfig(config);

    expect(diagnostics).toEqual({
      source: 'REDIS_URL',
      hostname: 'cache.example',
      port: 6380,
      tls: true,
    });
    expect(JSON.stringify(diagnostics)).not.toContain('managed-user');
    expect(JSON.stringify(diagnostics)).not.toContain('super-secret');
    expect(JSON.stringify(diagnostics)).not.toContain('token');
  });
});
