import { afterEach, describe, expect, it, vi } from 'vitest';

const redisPublish = vi.hoisted(() => vi.fn(async () => 1));
const getRedis = vi.hoisted(() => vi.fn(() => ({ publish: redisPublish })));

vi.mock('../config/database', () => ({ getRedis }));

import {
  getSocketEventTransport,
  publishGlobal,
  setSocketIOInstance,
} from './socketHelper';

afterEach(() => {
  delete process.env.HOSTED_DEPLOYMENT;
  delete process.env.SOCKET_EVENT_TRANSPORT;
  vi.clearAllMocks();
});

describe('getSocketEventTransport', () => {
  it('disables Redis Pub/Sub by default in OCI Hosted deployments', () => {
    expect(getSocketEventTransport({ HOSTED_DEPLOYMENT: 'true' })).toBe('local');
  });

  it('preserves Redis Pub/Sub for non-hosted deployments', () => {
    expect(getSocketEventTransport({})).toBe('redis');
  });

  it('honors an explicit transport and rejects invalid values', () => {
    expect(getSocketEventTransport({ SOCKET_EVENT_TRANSPORT: 'local' })).toBe('local');
    expect(getSocketEventTransport({ SOCKET_EVENT_TRANSPORT: 'redis' })).toBe('redis');
    expect(() => getSocketEventTransport({ SOCKET_EVENT_TRANSPORT: 'shared' })).toThrow(
      /SOCKET_EVENT_TRANSPORT/,
    );
  });

  it('keeps hosted local events away from the Redis command connection', async () => {
    process.env.HOSTED_DEPLOYMENT = 'true';
    const emit = vi.fn();
    setSocketIOInstance({ emit } as never);

    await publishGlobal('processing:complete', { fileId: 'file-safe' });

    expect(emit).toHaveBeenCalledWith('processing:complete', { fileId: 'file-safe' });
    expect(getRedis).not.toHaveBeenCalled();
    expect(redisPublish).not.toHaveBeenCalled();
  });
});
