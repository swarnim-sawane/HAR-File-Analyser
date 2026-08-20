// @vitest-environment node

import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  file: null as null | Record<string, unknown>,
  metadata: null as string | null,
  redisError: null as Error | null,
}));

vi.mock('../config/database', () => ({
  getDatabase: () => ({
    getFile: vi.fn(async () => state.file),
  }),
  getRedis: () => ({
    get: vi.fn(async () => {
      if (state.redisError) throw state.redisError;
      return state.metadata;
    }),
  }),
}));

vi.mock('../services/artifactStore', () => ({
  getArtifactStore: vi.fn(),
}));

let server: Server | undefined;

const startServer = async () => {
  const routes = (await import('./harRoutes')).default;
  const app = express();
  app.use('/api/har', routes);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
};

beforeEach(() => {
  vi.resetModules();
  state.file = null;
  state.metadata = null;
  state.redisError = null;
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

describe('HAR status route', () => {
  it('returns a bounded persisted processing error', async () => {
    state.file = {
      fileId: 'file-invalid',
      fileName: 'invalid.har',
      status: 'error',
      totalEntries: 0,
      uploadedAt: new Date('2026-08-19T00:00:00Z'),
      processedAt: new Date('2026-08-19T00:00:01Z'),
      stats: { processingError: `Invalid ${'x'.repeat(400)}` },
    };
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/har/file-invalid/status`);
    const body = await response.json() as { status: string; error: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe('error');
    expect(body.error.length).toBeLessThanOrEqual(240);
  });

  it('lets a Redis terminal error override stale PostgreSQL processing state', async () => {
    state.file = {
      fileId: 'file-invalid',
      fileName: 'invalid.har',
      status: 'processing',
      totalEntries: 0,
      uploadedAt: new Date('2026-08-19T00:00:00Z'),
      processedAt: null,
      stats: {},
    };
    state.metadata = JSON.stringify({
      status: 'error',
      error: 'HAR file is invalid or contains unsupported request entries.',
    });
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/har/file-invalid/status`);
    const body = await response.json() as { status: string; error: string };

    expect(body).toMatchObject({
      status: 'error',
      error: 'HAR file is invalid or contains unsupported request entries.',
    });
  });

  it('returns durable processing metadata when Redis is unavailable', async () => {
    state.file = {
      fileId: 'file-recoverable',
      fileName: 'recoverable.har',
      fileSize: 1234,
      hash: 'sha256-value',
      status: 'processing',
      totalEntries: 0,
      uploadedAt: new Date('2026-08-20T00:00:00Z'),
      processedAt: null,
      stats: {},
    };
    state.redisError = new Error('subscriber mode');
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/har/file-recoverable/status`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      fileId: 'file-recoverable',
      fileName: 'recoverable.har',
      fileSize: 1234,
      hash: 'sha256-value',
      jobId: 'file-recoverable',
      status: 'processing',
    });
  });

  it('rejects unsafe file IDs before constructing Redis keys', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/har/not%20safe/status`);
    expect(response.status).toBe(400);
  });
});
