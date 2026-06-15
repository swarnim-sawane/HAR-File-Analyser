// @vitest-environment node

import express from 'express';
import { createServer, type Server } from 'http';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetch } from 'undici';
import videoRoutes from './videoRoutes';

type MockCollection = {
  findOne: ReturnType<typeof vi.fn>;
  insertOne: ReturnType<typeof vi.fn>;
  updateOne: ReturnType<typeof vi.fn>;
};

const collections = new Map<string, MockCollection>();
const redisGet = vi.fn();
const redisSetex = vi.fn();
const queueAdd = vi.hoisted(() => vi.fn());
const publishToFile = vi.hoisted(() => vi.fn());
const tempDirs: string[] = [];

vi.mock('bullmq', () => ({
  Queue: vi.fn(function MockQueue() {
    return {
      add: queueAdd,
    };
  }),
}));

vi.mock('../utils/socketHelper', () => ({
  publishToFile,
}));

vi.mock('../config/database', () => ({
  getMongoDb: () => ({
    collection: (name: string) => getCollection(name),
  }),
  getRedis: () => ({
    get: redisGet,
    setex: redisSetex,
  }),
}));

const servers: Server[] = [];

beforeEach(() => {
  collections.clear();
  redisGet.mockReset();
  redisSetex.mockReset();
  queueAdd.mockReset();
  queueAdd.mockResolvedValue({ id: 'video-analysis-job-id' });
  publishToFile.mockReset();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('videoRoutes', () => {
  it('returns processing status from Redis metadata before video preparation completes', async () => {
    redisGet.mockResolvedValue(JSON.stringify({
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      status: 'preparing',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    }));
    const server = await listen(createVideoServer());

    const response = await fetch(`${serverUrl(server)}/api/video/video-file-id/status`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      status: 'preparing',
      ffprobeAvailable: null,
    });
  });

  it('returns ready status and metadata from MongoDB after preparation completes', async () => {
    getCollection('video_files').findOne.mockResolvedValue({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      status: 'ready',
      metadata: {
        durationSeconds: 182.5,
        ffprobeAvailable: true,
      },
      analysis: {
        keyframes: [
          { fileName: 'frame_001.jpg', relativePath: 'video-file-id_keyframes/frame_001.jpg' },
        ],
        keyframeCount: 1,
        vision: {
          status: 'ready',
          summary: 'The recording shows a login error modal.',
          findings: [{ title: 'Login error appears', evidence: 'Frame 1 shows the error modal.' }],
        },
      },
      uploadedAt: new Date('2026-06-11T10:00:00.000Z'),
      processedAt: new Date('2026-06-11T10:00:04.000Z'),
    });
    const server = await listen(createVideoServer());

    const response = await fetch(`${serverUrl(server)}/api/video/video-file-id/status`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      status: 'ready',
      durationSeconds: 182.5,
      ffprobeAvailable: true,
      analysis: {
        keyframeCount: 1,
        keyframes: [
          {
            fileName: 'frame_001.jpg',
            url: '/api/video/video-file-id/keyframes/frame_001.jpg',
          },
        ],
        vision: {
          status: 'ready',
          summary: 'The recording shows a login error modal.',
        },
      },
    });
  });

  it('streams uploaded video media with range support for timeline seeking', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'video-route-'));
    tempDirs.push(tempDir);
    const mediaPath = path.join(tempDir, 'customer-session.mp4');
    await writeFile(mediaPath, Buffer.from('0123456789abcdef'));
    getCollection('video_files').findOne.mockResolvedValue({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      fileSize: 16,
      filePath: mediaPath,
      fileType: 'video/mp4',
      status: 'vision_ready',
      metadata: {
        durationSeconds: 16,
        ffprobeAvailable: true,
      },
      uploadedAt: new Date('2026-06-11T10:00:00.000Z'),
    });
    const server = await listen(createVideoServer());

    const statusResponse = await fetch(`${serverUrl(server)}/api/video/video-file-id/status`);
    expect(await statusResponse.json()).toMatchObject({
      mediaUrl: '/api/video/video-file-id/media',
    });

    const mediaResponse = await fetch(`${serverUrl(server)}/api/video/video-file-id/media`, {
      headers: { range: 'bytes=2-5' },
    });

    expect(mediaResponse.status).toBe(206);
    expect(mediaResponse.headers.get('content-range')).toBe('bytes 2-5/16');
    expect(mediaResponse.headers.get('accept-ranges')).toBe('bytes');
    expect(mediaResponse.headers.get('content-type')).toContain('video/mp4');
    expect(await mediaResponse.text()).toBe('2345');
  });

  it('queues a backend evidence-analysis job for a prepared video', async () => {
    getCollection('video_files').findOne.mockResolvedValue({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      filePath: 'C:/processed/customer-session.mp4',
      fileType: 'video',
      hash: 'video-hash',
      status: 'ready',
      metadata: { ffprobeAvailable: false },
      uploadedAt: new Date('2026-06-11T10:00:00.000Z'),
    });
    const timeline = getCollection('video_timeline');
    const server = await listen(createVideoServer());

    const response = await fetch(`${serverUrl(server)}/api/video/video-file-id/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'evidence' }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      accepted: true,
      fileId: 'video-file-id',
      status: 'analysis_queued',
      jobId: 'video-analysis-job-id',
    });
    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'analysis_queued' }),
      })
    );
    expect(queueAdd).toHaveBeenCalledWith(
      'analyze_video_evidence',
      expect.objectContaining({
        fileId: 'video-file-id',
        fileName: 'customer-session.mp4',
        filePath: 'C:/processed/customer-session.mp4',
        fileSize: 7340032,
        fileType: 'video',
        hash: 'video-hash',
      }),
      expect.objectContaining({
        attempts: 1,
      })
    );
    expect(timeline.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      fileId: 'video-file-id',
      stage: 'analysis_queued',
      title: 'Video evidence analysis queued',
    }));
  });
});

function createVideoServer(): Server {
  const app = express();
  app.use(express.json());
  app.use('/api/video', videoRoutes);
  return createServer(app);
}

function getCollection(name: string): MockCollection {
  const existing = collections.get(name);
  if (existing) return existing;

  const collection = {
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    updateOne: vi.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
  };
  collections.set(name, collection);
  return collection;
}

function listen(server: Server): Promise<Server> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function serverUrl(server: Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
