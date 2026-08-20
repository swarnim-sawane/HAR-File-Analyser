import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const client = {
    get: vi.fn(),
    post: vi.fn(),
    interceptors: {
      response: { use: vi.fn() },
    },
  };

  return {
    client,
    create: vi.fn(() => client),
  };
});

vi.mock('axios', () => ({
  default: {
    create: mocks.create,
    isAxiosError: vi.fn(() => false),
  },
  isAxiosError: vi.fn(() => false),
}));

import { apiClient, HAR_DATA_TIMEOUT_MS } from './apiClient';

describe('ApiClient large HAR download timeout', () => {
  beforeEach(() => {
    mocks.client.get.mockReset();
  });

  it('keeps the authoritative HAR download below the gateway ceiling without the 60 second restart', async () => {
    const har = { log: { entries: [] } };
    mocks.client.get.mockResolvedValue({ data: har });

    await expect(apiClient.getHarData('file-large')).resolves.toBe(har);

    expect(HAR_DATA_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(HAR_DATA_TIMEOUT_MS).toBeLessThan(300_000);
    expect(mocks.client.get).toHaveBeenCalledWith('/api/har/file-large', {
      timeout: HAR_DATA_TIMEOUT_MS,
    });
  });
});
