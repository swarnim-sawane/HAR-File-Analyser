import express from 'express';
import { once } from 'events';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/aiUsageService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/aiUsageService')>();
  return {
    ...actual,
    getAiUsageSummary: vi.fn(),
  };
});

import opsRouter from './opsRoutes';
import { getAiUsageSummary } from '../services/aiUsageService';

const getAiUsageSummaryMock = vi.mocked(getAiUsageSummary);

afterEach(() => {
  vi.clearAllMocks();
});

async function withServer(
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use('/api/ops', opsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe('GET /api/ops/ai-usage', () => {
  it('returns aggregate usage without prompts, responses, or credentials', async () => {
    getAiUsageSummaryMock.mockResolvedValue({
      provider: 'openai',
      generatedAt: '2026-07-15T12:00:00.000Z',
      range: {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-15T00:00:00.000Z',
      },
      filters: { operation: 'insights', model: null },
      totals: {
        requests: 3,
        completedRequests: 3,
        failedRequests: 0,
        usageCapturedRequests: 3,
        usageMissingRequests: 0,
        inputTokens: 1200,
        cachedInputTokens: 200,
        outputTokens: 400,
        reasoningTokens: 100,
        totalTokens: 1600,
        estimatedCostUsd: 0.02,
        costedRequests: 3,
        unpricedRequests: 0,
      },
      byModel: [],
      byOperation: [],
      byDay: [],
      pricing: {
        currency: 'USD',
        estimate: true,
        configured: true,
        currentRatesPerMillionTokens: null,
        note: 'Estimate only.',
      },
      privacy: {
        promptsStored: false,
        responsesStored: false,
        apiKeysStored: false,
      },
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/ops/ai-usage?from=2026-07-01T00%3A00%3A00.000Z&to=2026-07-15T00%3A00%3A00.000Z&operation=insights`,
      );
      const payload = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        provider: 'openai',
        privacy: {
          promptsStored: false,
          responsesStored: false,
          apiKeysStored: false,
        },
      });
      expect(payload).not.toHaveProperty('prompt');
      expect(payload).not.toHaveProperty('messages');
      expect(payload).not.toHaveProperty('response');
      expect(payload).not.toHaveProperty('apiKey');
      expect(getAiUsageSummaryMock).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'insights',
      }));
    });
  });

  it('rejects unsupported operations before querying MongoDB', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/ai-usage?operation=%24where`);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringMatching(/operation must be one of/i),
      });
      expect(getAiUsageSummaryMock).not.toHaveBeenCalled();
    });
  });
});
