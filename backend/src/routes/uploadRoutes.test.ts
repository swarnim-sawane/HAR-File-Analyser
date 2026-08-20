// @vitest-environment node

import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const sets = new Map<string, Set<string>>();
  const values = new Map<string, string>();
  const add = vi.fn(async () => ({ id: 'job-1' }));
  const upsertFile = vi.fn(async () => undefined);

  return {
    add,
    upsertFile,
    sets,
    values,
    publishEvalError: null as Error | null,
    redis: {
      sadd: vi.fn(async (key: string, value: string) => {
        const set = sets.get(key) || new Set<string>();
        set.add(value);
        sets.set(key, set);
        return 1;
      }),
      scard: vi.fn(async (key: string) => sets.get(key)?.size || 0),
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      set: vi.fn(async (key: string, value: string, ...args: Array<string | number>) => {
        if (args.includes('NX') && values.has(key)) return null;
        values.set(key, value);
        return 'OK';
      }),
      expire: vi.fn(async () => 1),
      setex: vi.fn(async (key: string, _ttl: number, value: string) => {
        values.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (...keys: string[]) => {
        keys.forEach((key) => {
          sets.delete(key);
          values.delete(key);
        });
        return keys.length;
      }),
      eval: vi.fn(async (
        _script: string,
        numberOfKeys: number,
        ...args: Array<string>
      ) => {
        if (numberOfKeys === 2) {
          if (testState.publishEvalError) throw testState.publishEvalError;
          const [lockKey, resultKey, token, record] = args;
          if (values.get(lockKey) !== token) return 0;
          values.set(resultKey, record);
          values.delete(lockKey);
          return 1;
        }
        const [lockKey, token] = args;
        if (values.get(lockKey) !== token) return 0;
        values.delete(lockKey);
        return 1;
      }),
    },
  };
});

vi.mock('../config/database', () => ({
  getRedis: () => testState.redis,
  getDatabase: () => ({ upsertFile: testState.upsertFile }),
}));
vi.mock('bullmq', () => ({
  Queue: class {
    add = testState.add;
  },
}));
vi.mock('../utils/socketHelper', () => ({ publishGlobal: vi.fn(async () => undefined) }));

let server: Server | undefined;
let temporaryRoot: string | undefined;

async function startServer(): Promise<string> {
  const uploadRoutes = (await import('./uploadRoutes')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/upload', uploadRoutes);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server?.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
  vi.resetModules();
  testState.add.mockClear();
  testState.add.mockResolvedValue({ id: 'job-1' });
  testState.upsertFile.mockClear();
  testState.sets.clear();
  testState.values.clear();
  testState.publishEvalError = null;
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'har-upload-route-'));
  process.env.ARTIFACT_STORE = 'local';
  process.env.ARTIFACT_LOCAL_DIR = path.join(temporaryRoot, 'artifacts');
  process.env.UPLOAD_DIR = path.join(temporaryRoot, 'scratch');
  process.env.ARTIFACT_SCRATCH_DIR = path.join(temporaryRoot, 'assembled');
  process.env.UPLOAD_COMPLETION_WAIT_MS = '1000';
  process.env.UPLOAD_COMPLETION_POLL_MS = '10';
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
  delete process.env.ARTIFACT_STORE;
  delete process.env.ARTIFACT_LOCAL_DIR;
  delete process.env.UPLOAD_DIR;
  delete process.env.ARTIFACT_SCRATCH_DIR;
  delete process.env.UPLOAD_COMPLETION_WAIT_MS;
  delete process.env.UPLOAD_COMPLETION_POLL_MS;
});

async function uploadHarChunks(baseUrl: string, fileId: string, payload: string): Promise<number> {
  const splitAt = Math.floor(payload.length / 2);
  const chunks = [payload.slice(0, splitAt), payload.slice(splitAt)];
  for (let index = 0; index < chunks.length; index++) {
    const body = new FormData();
    body.set('fileId', fileId);
    body.set('chunkIndex', String(index));
    body.set('totalChunks', String(chunks.length));
    body.set('chunk', new Blob([chunks[index]]), `chunk-${index}`);
    const response = await fetch(`${baseUrl}/api/upload/chunk`, { method: 'POST', body });
    expect(response.status).toBe(200);
  }
  return chunks.length;
}

function completeHar(baseUrl: string, fileId: string, totalChunks: number, fileName = 'sample.har') {
  return fetch(`${baseUrl}/api/upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, totalChunks, fileName, fileType: 'har' }),
  });
}

describe('upload routes with ArtifactStore', () => {
  it('persists chunks outside the API replica and queues an artifact key', async () => {
    const baseUrl = await startServer();
    const fileId = 'file_123';
    const payload = '{"log":{"version":"1.2","entries":[]}}';
    const totalChunks = await uploadHarChunks(baseUrl, fileId, payload);
    const completeResponse = await completeHar(baseUrl, fileId, totalChunks);
    expect(completeResponse.status).toBe(200);
    expect(testState.add).toHaveBeenCalledWith(
      'process_file',
      expect.objectContaining({
        fileId,
        artifactKey: 'artifacts/file_123/source',
      }),
      expect.objectContaining({ jobId: fileId }),
    );
    expect(testState.add.mock.calls[0][1]).not.toHaveProperty('filePath');

    const storedPath = path.join(
      process.env.ARTIFACT_LOCAL_DIR as string,
      'artifacts',
      fileId,
      'source',
    );
    expect(await fs.readFile(storedPath, 'utf8')).toBe(payload);
  });

  it('returns the committed result for concurrent and repeated completion requests', async () => {
    const baseUrl = await startServer();
    const fileId = 'file_concurrent';
    const payload = '{"log":{"version":"1.2","entries":[]}}';
    const totalChunks = await uploadHarChunks(baseUrl, fileId, payload);

    let releaseQueue!: () => void;
    const queueGate = new Promise<void>((resolve) => { releaseQueue = resolve; });
    testState.add.mockImplementationOnce(async () => {
      await queueGate;
      return { id: 'job-1' };
    });

    const first = completeHar(baseUrl, fileId, totalChunks);
    const second = completeHar(baseUrl, fileId, totalChunks);
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseQueue();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    const firstResult = await firstResponse.json();
    const secondResult = await secondResponse.json();
    expect(secondResult).toEqual(firstResult);

    const repeatedResponse = await completeHar(baseUrl, fileId, totalChunks);
    expect(repeatedResponse.status).toBe(200);
    expect(await repeatedResponse.json()).toEqual(firstResult);
    expect(testState.add).toHaveBeenCalledTimes(1);
    expect(testState.upsertFile).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of a completed fileId with different upload parameters', async () => {
    const baseUrl = await startServer();
    const fileId = 'file_conflict';
    const payload = '{"log":{"version":"1.2","entries":[]}}';
    const totalChunks = await uploadHarChunks(baseUrl, fileId, payload);

    expect((await completeHar(baseUrl, fileId, totalChunks)).status).toBe(200);
    const conflict = await completeHar(baseUrl, fileId, totalChunks, 'different.har');
    expect(conflict.status).toBe(409);
    expect(testState.add).toHaveBeenCalledTimes(1);
    expect(testState.upsertFile).toHaveBeenCalledTimes(1);
  });

  it('returns success when only the Redis completion replay cache fails after queueing', async () => {
    const baseUrl = await startServer();
    const fileId = 'file_cache_failure';
    const payload = '{"log":{"version":"1.2","entries":[]}}';
    const totalChunks = await uploadHarChunks(baseUrl, fileId, payload);
    testState.publishEvalError = new Error('subscriber mode');

    const response = await completeHar(baseUrl, fileId, totalChunks);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, fileId, jobId: 'job-1' });
    expect(testState.add).toHaveBeenCalledTimes(1);
    expect(testState.upsertFile).toHaveBeenCalledTimes(1);
  });
});
