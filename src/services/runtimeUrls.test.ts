import { describe, expect, it } from 'vitest';
import { resolveRuntimeBaseUrl } from './runtimeUrls';

const origin = 'https://har.example.test';

describe('resolveRuntimeBaseUrl', () => {
  it('uses the browser origin when a production URL is omitted', () => {
    expect(resolveRuntimeBaseUrl({
      developmentUrl: 'http://localhost:4000',
      isDevelopment: false,
      origin,
    })).toBe(origin);
  });

  it.each(['.', './', '/'])('treats %s as an explicit same-origin marker', (configuredUrl) => {
    expect(resolveRuntimeBaseUrl({
      configuredUrl,
      developmentUrl: 'http://localhost:4000',
      isDevelopment: false,
      origin,
    })).toBe(origin);
  });

  it('keeps the localhost fallback only in development', () => {
    expect(resolveRuntimeBaseUrl({
      developmentUrl: 'http://localhost:4000/',
      isDevelopment: true,
      origin,
    })).toBe('http://localhost:4000');
  });

  it('normalizes configured absolute and root-relative endpoints', () => {
    expect(resolveRuntimeBaseUrl({
      configuredUrl: 'https://api.example.test/',
      developmentUrl: 'http://localhost:4000',
      isDevelopment: false,
      origin,
    })).toBe('https://api.example.test');

    expect(resolveRuntimeBaseUrl({
      configuredUrl: '/backend/',
      developmentUrl: 'http://localhost:4000',
      isDevelopment: false,
      origin,
    })).toBe(`${origin}/backend`);
  });

  it.each([
    'http://10.65.39.163:4000',
    'http://localhost:4000',
    'ws://10.65.39.163:4000',
  ])('refuses insecure configured endpoint %s on an HTTPS production page', (configuredUrl) => {
    expect(resolveRuntimeBaseUrl({
      configuredUrl,
      developmentUrl: 'http://localhost:4000',
      isDevelopment: false,
      origin,
    })).toBe(origin);
  });

  it('keeps an explicit HTTP endpoint available in development', () => {
    expect(resolveRuntimeBaseUrl({
      configuredUrl: 'http://10.65.39.163:4000/',
      developmentUrl: 'http://localhost:4000',
      isDevelopment: true,
      origin,
    })).toBe('http://10.65.39.163:4000');
  });
});
