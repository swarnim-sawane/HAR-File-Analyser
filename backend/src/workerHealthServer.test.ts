import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorkerHealthServer } from './workerHealthServer';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => error ? reject(error) : resolve());
  });
  server = undefined;
});

describe('startWorkerHealthServer', () => {
  it('reports liveness independently from readiness', async () => {
    let ready = false;
    server = startWorkerHealthServer(
      { isReady: () => ready, isShuttingDown: () => false },
      { host: '127.0.0.1', port: 0 },
    );
    await new Promise<void>((resolve) => server?.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;

    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(503);

    ready = true;
    expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(200);
  });
});
