import { describe, expect, it } from 'vitest';
import { buildAllowedOrigins, isOriginAllowed, parseConfiguredOrigins } from './corsOrigins';

describe('CORS origins', () => {
  it('allows the VM frontend by IP and DNS hostname', () => {
    expect(buildAllowedOrigins()).toEqual(expect.arrayContaining([
      'http://10.65.39.163:3000',
      'http://celvpvm05798.us.oracle.com:3000',
    ]));
  });

  it('trims configured origins and removes duplicates', () => {
    expect(parseConfiguredOrigins(' http://example.com:3000, ,http://example.com:3000 ')).toEqual([
      'http://example.com:3000',
      'http://example.com:3000',
    ]);

    expect(buildAllowedOrigins(' http://10.65.39.163:3000, http://extra.example.com:3000 ')).toEqual(
      expect.arrayContaining([
        'http://10.65.39.163:3000',
        'http://extra.example.com:3000',
      ])
    );
    expect(buildAllowedOrigins(' http://10.65.39.163:3000 ').filter(
      origin => origin === 'http://10.65.39.163:3000'
    )).toHaveLength(1);
  });

  it('allows any browser origin only when wildcard access is explicitly configured', () => {
    const wildcardOrigins = buildAllowedOrigins('*');

    expect(isOriginAllowed('http://92.4.67.55', wildcardOrigins)).toBe(true);
    expect(isOriginAllowed('https://har-analyzer.example.com', wildcardOrigins)).toBe(true);
  });

  it('allows exact configured origins and rejects unknown origins', () => {
    const allowedOrigins = buildAllowedOrigins('https://har-analyzer.example.com');

    expect(isOriginAllowed('https://har-analyzer.example.com', allowedOrigins)).toBe(true);
    expect(isOriginAllowed('https://untrusted.example.com', allowedOrigins)).toBe(false);
  });

  it('allows requests without an Origin header for health checks and service clients', () => {
    expect(isOriginAllowed(undefined, buildAllowedOrigins())).toBe(true);
  });
});
