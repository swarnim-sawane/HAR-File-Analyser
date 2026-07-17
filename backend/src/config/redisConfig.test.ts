import { describe, expect, it } from 'vitest';
import { buildRedisConnectionConfig } from './redisConfig';

describe('buildRedisConnectionConfig', () => {
  it('keeps local Redis defaults for development', () => {
    const config = buildRedisConnectionConfig({});
    expect(config.url).toBeUndefined();
    expect(config.options).toMatchObject({
      host: 'localhost',
      port: 6379,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  });

  it('accepts a managed Redis URL and TLS options', () => {
    const config = buildRedisConnectionConfig({
      HOSTED_DEPLOYMENT: 'true',
      REDIS_URL: 'rediss://cache.example:6379',
      REDIS_TLS: 'true',
    });
    expect(config.url).toBe('rediss://cache.example:6379');
    expect(config.options.tls).toEqual({ servername: 'cache.example' });
    expect(config.options.host).toBeUndefined();
    expect(config.options.lazyConnect).toBe(true);
  });

  it('fails fast when hosted Redis configuration is absent', () => {
    expect(() => buildRedisConnectionConfig({ HOSTED_DEPLOYMENT: 'true' }))
      .toThrow(/REDIS_URL or REDIS_HOST/);
  });

  it('rejects plaintext Redis in Hosted Deployment', () => {
    expect(() => buildRedisConnectionConfig({
      HOSTED_DEPLOYMENT: 'true',
      REDIS_URL: 'redis://cache.example:6379',
    })).toThrow(/requires TLS/);
  });
});
