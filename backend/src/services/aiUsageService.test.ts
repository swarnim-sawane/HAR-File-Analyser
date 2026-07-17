import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estimateOpenAiCostUsd,
  extractOpenAiResponseMetadata,
  getAiUsagePricing,
  getAiUsageSummary,
  parseAiUsageSummaryQuery,
  recordAiUsageEvent,
} from './aiUsageService';
import type { PostgresStore } from '../persistence/postgresStore';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('AI usage accounting', () => {
  it('extracts authoritative token categories from a Responses API completion event', () => {
    const metadata = extractOpenAiResponseMetadata({
      type: 'response.completed',
      response: {
        id: 'resp_123',
        model: 'approved-model-2026-07',
        usage: {
          input_tokens: 1_200,
          input_tokens_details: { cached_tokens: 300 },
          output_tokens: 450,
          output_tokens_details: { reasoning_tokens: 120 },
          total_tokens: 1_650,
        },
      },
    });

    expect(metadata).toEqual({
      responseId: 'resp_123',
      model: 'approved-model-2026-07',
      usage: {
        inputTokens: 1_200,
        cachedInputTokens: 300,
        outputTokens: 450,
        reasoningTokens: 120,
        totalTokens: 1_650,
      },
    });
  });

  it('calculates a transparent cached-input-aware USD estimate', () => {
    expect(estimateOpenAiCostUsd(
      {
        inputTokens: 1_000_000,
        cachedInputTokens: 250_000,
        outputTokens: 500_000,
        reasoningTokens: 100_000,
        totalTokens: 1_500_000,
      },
      {
        inputUsdPerMillionTokens: 2,
        cachedInputUsdPerMillionTokens: 0.5,
        outputUsdPerMillionTokens: 8,
        cachedInputRateSource: 'configured',
      },
    )).toBe(5.625);
  });

  it('uses the input rate as a visible conservative fallback when no cached rate is supplied', () => {
    const pricing = getAiUsagePricing({
      OPENAI_INPUT_USD_PER_1M_TOKENS: '2',
      OPENAI_OUTPUT_USD_PER_1M_TOKENS: '8',
    });

    expect(pricing).toMatchObject({
      inputUsdPerMillionTokens: 2,
      cachedInputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 8,
      cachedInputRateSource: 'input_rate_fallback',
    });
  });

  it('does not produce cost estimates from malformed configured rates', () => {
    expect(getAiUsagePricing({
      OPENAI_INPUT_USD_PER_1M_TOKENS: '2',
      OPENAI_CACHED_INPUT_USD_PER_1M_TOKENS: 'not-a-number',
      OPENAI_OUTPUT_USD_PER_1M_TOKENS: '8',
    })).toBeNull();
  });

  it('persists usage metadata without prompt, response, or credential fields', async () => {
    process.env.AI_USAGE_TRACKING_ENABLED = 'true';
    process.env.OPENAI_INPUT_USD_PER_1M_TOKENS = '2';
    process.env.OPENAI_OUTPUT_USD_PER_1M_TOKENS = '8';
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const database = { query } as unknown as PostgresStore;

    await expect(recordAiUsageEvent({
      requestId: 'request-123',
      operation: 'insights',
      status: 'completed',
      model: 'approved-model',
      providerResponseId: 'resp_123',
      providerHttpStatus: 200,
      durationMs: 1250,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 50,
        reasoningTokens: 10,
        totalTokens: 150,
      },
    }, database)).resolves.toBe(true);

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO ai_usage_events');
    expect(values).toEqual(expect.arrayContaining(['request-123', 'insights', 'openai', 100, 50, 150]));
    expect(sql).not.toMatch(/prompt|messages|api_key/i);
    expect(logSpy.mock.calls.flat().join(' ')).toContain('"totalUnits":150');
  });

  it('validates bounded summary filters before constructing a database query', () => {
    const now = new Date('2026-07-15T12:00:00.000Z');

    expect(parseAiUsageSummaryQuery({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-15T00:00:00.000Z',
      operation: 'chat',
      model: 'approved-model',
    }, now).value).toMatchObject({
      operation: 'chat',
      model: 'approved-model',
    });
    expect(parseAiUsageSummaryQuery({ operation: '$where' }, now).error).toMatch(/operation must be one of/i);
    expect(parseAiUsageSummaryQuery({
      from: '2025-01-01T00:00:00.000Z',
      to: '2026-07-15T00:00:00.000Z',
    }, now).error).toMatch(/cannot exceed 366 days/i);
  });

  it('returns totals and breakdowns with explicit pricing and privacy metadata', async () => {
    const totals = [{
        _id: null,
        requestCount: 2,
        completedRequests: 2,
        failedRequests: 0,
        usageCapturedRequests: 2,
        inputTokens: 100,
        cachedInputTokens: 10,
        outputTokens: 40,
        reasoningTokens: 5,
        totalTokens: 140,
        estimatedCostUsd: 0.002,
        costedRequests: 2,
      }];
    const database = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: totals })
        .mockResolvedValue({ rows: [] }),
    } as unknown as PostgresStore;
    const query = {
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-07-15T00:00:00.000Z'),
    };

    const summary = await getAiUsageSummary(query, database);

    expect(summary.totals).toMatchObject({
      requests: 2,
      totalTokens: 140,
      estimatedCostUsd: 0.002,
      unpricedRequests: 0,
    });
    expect(summary.pricing.estimate).toBe(true);
    expect(summary.privacy).toEqual({
      promptsStored: false,
      responsesStored: false,
      apiKeysStored: false,
    });
  });

  it('reports unconfigured cost as null instead of falsely reporting zero cost', async () => {
    const totals = [{
        _id: null,
        requestCount: 1,
        completedRequests: 1,
        failedRequests: 0,
        usageCapturedRequests: 1,
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 20,
        reasoningTokens: 0,
        totalTokens: 120,
        estimatedCostUsd: 0,
        costedRequests: 0,
      }];
    const database = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: totals })
        .mockResolvedValue({ rows: [] }),
    } as unknown as PostgresStore;

    const summary = await getAiUsageSummary({
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-07-15T00:00:00.000Z'),
    }, database);

    expect(summary.totals).toMatchObject({
      totalTokens: 120,
      estimatedCostUsd: null,
      unpricedRequests: 1,
    });
  });
});
