import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorkerHealthServer } from './workerHealthServer';
import type { Server } from 'http';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

async function request(path: string): Promise<Response> {
  const address = server?.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}${path}`);
}

describe('worker health server', () => {
  it('separates liveness from readiness', async () => {
    let ready = false;
    let shuttingDown = false;
    server = startWorkerHealthServer({
      isReady: () => ready,
      isShuttingDown: () => shuttingDown,
    }, { host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server?.once('listening', () => resolve()));

    expect((await request('/health')).status).toBe(200);
    expect((await request('/ready')).status).toBe(503);

    ready = true;
    expect((await request('/ready')).status).toBe(200);

    shuttingDown = true;
    expect((await request('/health')).status).toBe(503);
    expect((await request('/ready')).status).toBe(503);
  });
});
