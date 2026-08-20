import { describe, expect, it, vi } from 'vitest';
import {
  getInitialConnectionRetryOptions,
  getPostgresInitialConnectionRetryOptions,
  retryInitialConnection,
} from './initialConnectionRetry';

describe('initial connection retry', () => {
  it('retries with bounded exponential backoff until the operation succeeds', async () => {
    const operation = vi.fn(async (attempt: number) => {
      if (attempt < 4) throw new Error(`temporary failure ${attempt}`);
      return 'connected';
    });
    const retries: number[] = [];
    const sleep = vi.fn(async (delayMs: number) => {
      retries.push(delayMs);
    });

    await expect(retryInitialConnection(
      operation,
      { maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 250 },
      undefined,
      sleep,
    )).resolves.toBe('connected');

    expect(operation).toHaveBeenCalledTimes(4);
    expect(retries).toEqual([100, 200, 250]);
  });

  it('throws the final connection error after exhausting all attempts', async () => {
    const finalError = new Error('proxy unavailable');
    const operation = vi.fn(async () => {
      throw finalError;
    });
    const retryEvents: Array<{ failedAttempt: number; delayMs: number }> = [];

    await expect(retryInitialConnection(
      operation,
      { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
      (event) => retryEvents.push(event),
      async () => undefined,
    )).rejects.toBe(finalError);

    expect(operation).toHaveBeenCalledTimes(3);
    expect(retryEvents).toEqual([
      expect.objectContaining({ failedAttempt: 1, delayMs: 0 }),
      expect.objectContaining({ failedAttempt: 2, delayMs: 0 }),
    ]);
  });

  it('applies safe defaults and bounds environment overrides', () => {
    expect(getInitialConnectionRetryOptions({})).toEqual({
      maxAttempts: 10,
      initialDelayMs: 500,
      maxDelayMs: 5_000,
    });

    expect(getInitialConnectionRetryOptions({
      REDIS_INITIAL_CONNECT_MAX_ATTEMPTS: '500',
      REDIS_INITIAL_CONNECT_RETRY_DELAY_MS: '-1',
      REDIS_INITIAL_CONNECT_RETRY_MAX_DELAY_MS: '999999',
    })).toEqual({
      maxAttempts: 50,
      initialDelayMs: 0,
      maxDelayMs: 30_000,
    });

    expect(getInitialConnectionRetryOptions({
      REDIS_INITIAL_CONNECT_MAX_ATTEMPTS: '10attempts',
      REDIS_INITIAL_CONNECT_RETRY_DELAY_MS: '30000',
    })).toEqual({
      maxAttempts: 10,
      initialDelayMs: 30_000,
      maxDelayMs: 30_000,
    });
  });

  it('supports independent bounded PostgreSQL startup retry settings', () => {
    expect(getPostgresInitialConnectionRetryOptions({})).toEqual({
      maxAttempts: 10,
      initialDelayMs: 500,
      maxDelayMs: 5_000,
    });

    expect(getPostgresInitialConnectionRetryOptions({
      POSTGRES_INITIAL_CONNECT_MAX_ATTEMPTS: '12',
      POSTGRES_INITIAL_CONNECT_RETRY_DELAY_MS: '750',
      POSTGRES_INITIAL_CONNECT_RETRY_MAX_DELAY_MS: '6000',
    })).toEqual({
      maxAttempts: 12,
      initialDelayMs: 750,
      maxDelayMs: 6_000,
    });
  });
});
