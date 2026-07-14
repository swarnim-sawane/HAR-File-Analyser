import { describe, expect, it } from 'vitest';
import { buildRedisConnectionConfig } from './redisConfig';

describe('buildRedisConnectionConfig', () => {
  it('keeps local Redis defaults for development', () => {
    const config = buildRedisConnectionConfig({});
    expect(config.url).toBeUndefined();
    expect(config.options).toMatchObject({ host: 'localhost', port: 6379 });
  });

  it('accepts a managed Redis URL and TLS options', () => {
    const config = buildRedisConnectionConfig({
      HOSTED_DEPLOYMENT: 'true',
      REDIS_URL: 'rediss://cache.example:6379',
      REDIS_TLS: 'true',
    });
    expect(config.url).toBe('rediss://cache.example:6379');
    expect(config.options.tls).toEqual({});
    expect(config.options.host).toBeUndefined();
  });

  it('fails fast when hosted Redis configuration is absent', () => {
    expect(() => buildRedisConnectionConfig({ HOSTED_DEPLOYMENT: 'true' }))
      .toThrow(/REDIS_URL or REDIS_HOST/);
  });
});
