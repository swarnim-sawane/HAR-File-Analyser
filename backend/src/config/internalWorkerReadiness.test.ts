import { describe, expect, it, vi } from 'vitest';
import { probeInternalWorkerReadiness } from './internalWorkerReadiness';

describe('probeInternalWorkerReadiness', () => {
  it('preserves standalone API behavior when no worker endpoint is configured', async () => {
    await expect(probeInternalWorkerReadiness({}, vi.fn())).resolves.toMatchObject({
      configured: false,
      ready: true,
    });
  });

  it('accepts a ready response from the loopback worker endpoint', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ready' }),
    }));

    await expect(probeInternalWorkerReadiness({
      INTERNAL_WORKER_READY_URL: 'http://127.0.0.1:8081/ready',
    }, fetchImpl)).resolves.toMatchObject({ configured: true, ready: true });
  });

  it('rejects non-loopback readiness URLs without making a request', async () => {
    const fetchImpl = vi.fn();
    const result = await probeInternalWorkerReadiness({
      INTERNAL_WORKER_READY_URL: 'https://example.com/ready',
    }, fetchImpl);

    expect(result).toMatchObject({ configured: true, ready: false });
    expect(result.detail).toMatch(/loopback/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats worker failures as not ready', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ status: 'not_ready' }),
    }));

    await expect(probeInternalWorkerReadiness({
      INTERNAL_WORKER_READY_URL: 'http://localhost:8081/ready',
    }, fetchImpl)).resolves.toMatchObject({ configured: true, ready: false });
  });
});
