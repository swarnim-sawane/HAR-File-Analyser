import { describe, expect, it } from 'vitest';
import { resolveOutboundProxyUrl } from './outboundProxy';

describe('resolveOutboundProxyUrl', () => {
  it('prefers HTTPS proxy settings for outbound OCA fetches', () => {
    expect(resolveOutboundProxyUrl({
      HTTPS_PROXY: 'http://https-proxy.example.com:80',
      HTTP_PROXY: 'http://http-proxy.example.com:80',
    })).toBe('http://https-proxy.example.com:80');
  });

  it('falls back to lowercase proxy variables', () => {
    expect(resolveOutboundProxyUrl({
      https_proxy: 'http://lowercase-proxy.example.com:80',
    })).toBe('http://lowercase-proxy.example.com:80');
  });
});
