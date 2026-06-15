import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chunkedUploader } from './chunkedUploader';

describe('chunkedUploader', () => {
  const originalCompressionStream = globalThis.CompressionStream;
  const originalResponse = globalThis.Response;

  beforeEach(() => {
    vi.spyOn(axios, 'post').mockImplementation(async (url: string) => {
      if (url.endsWith('/api/upload/complete')) {
        return {
          data: {
            success: true,
            fileId: 'video-file-id',
            jobId: 'job-id',
            fileName: 'customer-session.mp4',
            fileSize: 11,
            hash: 'hash',
            message: 'ok',
          },
        };
      }

      return { data: { success: true } };
    });
    globalThis.CompressionStream = class PassthroughCompressionStream {
      readable: ReadableStream;
      writable: WritableStream;

      constructor() {
        const transform = new TransformStream();
        this.readable = transform.readable;
        this.writable = transform.writable;
      }
    } as typeof CompressionStream;
    globalThis.Response = class FakeResponse {
      constructor(_body?: BodyInit | null) {}
      async blob() {
        return new Blob(['compressed-video-bytes']);
      }
    } as typeof Response;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.CompressionStream = originalCompressionStream;
    globalThis.Response = originalResponse;
  });

  it('does not gzip-compress video uploads before sending them to the backend', async () => {
    const pipeThrough = vi.fn(() => ({}));
    const videoFile = {
      name: 'customer-session.mp4',
      size: 11,
      type: 'video/mp4',
      lastModified: 0,
      stream: () => ({ pipeThrough }),
      slice: vi.fn(() => new Blob(['video-bytes'], { type: 'video/mp4' })),
    } as unknown as File;

    await chunkedUploader.uploadFile(videoFile, 'video');

    expect(pipeThrough).not.toHaveBeenCalled();
    const completeCall = vi.mocked(axios.post).mock.calls.find(([url]) =>
      String(url).endsWith('/api/upload/complete')
    );
    expect(completeCall).toBeDefined();
    expect(completeCall?.[1]).toMatchObject({
      fileName: 'customer-session.mp4',
      fileType: 'video',
    });
    expect(completeCall?.[1]).not.toHaveProperty('compressed');
  });
});
