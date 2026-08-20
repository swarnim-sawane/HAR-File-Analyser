export interface InitialConnectionRetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export interface InitialConnectionRetryEvent {
  failedAttempt: number;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
}

type Sleep = (delayMs: number) => Promise<void>;

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 5_000;

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value?.trim() ? Number(value) : fallback;
  const candidate = Number.isSafeInteger(parsed) ? parsed : fallback;
  return Math.min(Math.max(candidate, minimum), maximum);
}

export function getInitialConnectionRetryOptions(
  env: NodeJS.ProcessEnv = process.env,
): InitialConnectionRetryOptions {
  const initialDelayMs = boundedInteger(
    env.REDIS_INITIAL_CONNECT_RETRY_DELAY_MS,
    DEFAULT_INITIAL_DELAY_MS,
    0,
    30_000,
  );

  return {
    maxAttempts: boundedInteger(
      env.REDIS_INITIAL_CONNECT_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      1,
      50,
    ),
    initialDelayMs,
    maxDelayMs: boundedInteger(
      env.REDIS_INITIAL_CONNECT_RETRY_MAX_DELAY_MS,
      DEFAULT_MAX_DELAY_MS,
      initialDelayMs,
      30_000,
    ),
  };
}

export function getPostgresInitialConnectionRetryOptions(
  env: NodeJS.ProcessEnv = process.env,
): InitialConnectionRetryOptions {
  const initialDelayMs = boundedInteger(
    env.POSTGRES_INITIAL_CONNECT_RETRY_DELAY_MS,
    DEFAULT_INITIAL_DELAY_MS,
    0,
    30_000,
  );

  return {
    maxAttempts: boundedInteger(
      env.POSTGRES_INITIAL_CONNECT_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      1,
      50,
    ),
    initialDelayMs,
    maxDelayMs: boundedInteger(
      env.POSTGRES_INITIAL_CONNECT_RETRY_MAX_DELAY_MS,
      DEFAULT_MAX_DELAY_MS,
      initialDelayMs,
      30_000,
    ),
  };
}

function retryDelayMs(failedAttempt: number, options: InitialConnectionRetryOptions): number {
  const exponentialDelay = options.initialDelayMs * (2 ** (failedAttempt - 1));
  return Math.min(exponentialDelay, options.maxDelayMs);
}

const sleep: Sleep = async (delayMs) => {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
};

export async function retryInitialConnection<T>(
  operation: (attempt: number) => Promise<T>,
  options: InitialConnectionRetryOptions,
  onRetry?: (event: InitialConnectionRetryEvent) => void,
  sleepFn: Sleep = sleep,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === options.maxAttempts) break;

      const delayMs = retryDelayMs(attempt, options);
      onRetry?.({
        failedAttempt: attempt,
        nextAttempt: attempt + 1,
        maxAttempts: options.maxAttempts,
        delayMs,
      });
      await sleepFn(delayMs);
    }
  }

  throw lastError;
}
