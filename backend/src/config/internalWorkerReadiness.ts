export interface InternalWorkerReadiness {
  configured: boolean;
  ready: boolean;
  detail: string;
  latencyMs?: number;
}

export type WorkerReadinessFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

const DEFAULT_TIMEOUT_MS = 2_000;

function parseTimeout(rawValue: string | undefined): number {
  if (!rawValue?.trim()) return DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error('INTERNAL_WORKER_READY_TIMEOUT_MS must be between 100 and 10000.');
  }
  return timeoutMs;
}

function validateLoopbackUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname)) {
    throw new Error('INTERNAL_WORKER_READY_URL must use HTTP on a loopback host.');
  }
  return url.toString();
}

export async function probeInternalWorkerReadiness(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: WorkerReadinessFetch = fetch,
): Promise<InternalWorkerReadiness> {
  const rawUrl = env.INTERNAL_WORKER_READY_URL?.trim();
  if (!rawUrl) {
    return {
      configured: false,
      ready: true,
      detail: 'No embedded worker readiness endpoint is configured.',
    };
  }

  const startedAt = Date.now();
  let timeout: NodeJS.Timeout | undefined;
  const controller = new AbortController();

  try {
    const url = validateLoopbackUrl(rawUrl);
    timeout = setTimeout(() => controller.abort(), parseTimeout(env.INTERNAL_WORKER_READY_TIMEOUT_MS));
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const payload = await response.json() as { status?: unknown };
    const ready = response.ok && payload.status === 'ready';
    return {
      configured: true,
      ready,
      detail: ready
        ? 'Embedded worker is ready.'
        : `Embedded worker readiness returned HTTP ${response.status}.`,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      configured: true,
      ready: false,
      detail: error instanceof Error ? error.message : 'Embedded worker readiness check failed.',
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
