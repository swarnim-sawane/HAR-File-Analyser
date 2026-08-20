import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chunkedUploader, formatUploadError } from './chunkedUploader';
import { apiClient } from './apiClient';

vi.mock('./apiClient', () => ({
  apiClient: {
    getSessionId: vi.fn(() => 'test-session'),
    getHarStatus: vi.fn(),
  },
}));

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    isAxiosError: (error: unknown) => Boolean(
      error && typeof error === 'object' && (error as { isAxiosError?: boolean }).isAxiosError,
    ),
  },
}));

describe('chunkedUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getHarStatus).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404 },
    });
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: {
          success: true,
          fileId: 'assembled-file',
          jobId: 'job-1',
          fileName: 'sample.har',
          fileSize: 2,
          hash: 'hash',
          message: 'ok',
        },
      });
  });

  it('lets the browser add the multipart boundary for chunk requests', async () => {
    await chunkedUploader.uploadFile(new File(['{}'], 'sample.har'), 'har');

    const chunkConfig = vi.mocked(axios.post).mock.calls[0][2];
    expect(chunkConfig?.headers).toMatchObject({ 'X-Session-Id': 'test-session' });
    expect(chunkConfig?.headers).not.toHaveProperty('Content-Type');
  });

  it('formats server failures without exposing arbitrary response objects', () => {
    const error = {
      isAxiosError: true,
      message: 'Request failed',
      response: {
        status: 403,
        data: { error: 'Cross-site mutation requests are not allowed' },
        headers: { 'opc-request-id': 'request-id-1' },
      },
    };

    expect(formatUploadError(error, 'Upload failed')).toBe(
      'Cross-site mutation requests are not allowed - HTTP 403 - request request-id-1',
    );
  });

  it('recovers the original fileId when completion returns 500 after the job was accepted', async () => {
    vi.mocked(axios.post).mockReset();
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Request failed',
        response: {
          status: 500,
          data: { error: 'Failed to complete upload' },
          headers: {},
        },
      });
    vi.mocked(apiClient.getHarStatus).mockResolvedValue({
      fileId: 'recovered-file',
      fileName: 'broken.har',
      fileSize: 2,
      hash: 'recovered-hash',
      jobId: 'recovered-file',
      status: 'processing',
    });

    const result = await chunkedUploader.uploadFile(new File(['{}'], 'broken.har'), 'har');

    expect(result).toMatchObject({
      success: true,
      message: 'File upload was accepted; processing continues.',
    });
    expect(axios.post).toHaveBeenCalledTimes(2);
    const completionBody = vi.mocked(axios.post).mock.calls[1][1] as { fileId: string };
    expect(apiClient.getHarStatus).toHaveBeenCalledWith(completionBody.fileId);
    expect(result.fileId).toBe(completionBody.fileId);
  });

  it('retries completion with the same fileId when status is still not found', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(axios.post).mockReset();
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce({
          isAxiosError: true,
          code: 'ECONNRESET',
          message: 'Network Error',
        })
        .mockImplementationOnce(async (_url, body) => {
          const fileId = (body as { fileId: string }).fileId;
          return {
            status: 200,
            headers: {},
            data: {
              success: true,
              fileId,
              jobId: fileId,
              fileName: 'retry.har',
              fileSize: 2,
              hash: 'hash',
              message: 'ok',
            },
          };
        });

      const upload = chunkedUploader.uploadFile(new File(['{}'], 'retry.har'), 'har');
      await vi.runAllTimersAsync();
      const result = await upload;

      const firstCompletionBody = vi.mocked(axios.post).mock.calls[1][1] as { fileId: string };
      const retriedCompletionBody = vi.mocked(axios.post).mock.calls[2][1] as { fileId: string };
      expect(retriedCompletionBody.fileId).toBe(firstCompletionBody.fileId);
      expect(result.fileId).toBe(firstCompletionBody.fileId);
      expect(axios.post).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces concurrent submissions while an ambiguous completion is recovering', async () => {
    let releaseStatus!: () => void;
    const statusPending = new Promise<void>((resolve) => { releaseStatus = resolve; });
    vi.mocked(axios.post).mockReset();
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Request failed',
        response: { status: 500, data: { error: 'Failed to complete upload' }, headers: {} },
      });
    vi.mocked(apiClient.getHarStatus).mockImplementation(async (fileId) => {
      await statusPending;
      return {
        fileId,
        fileName: 'recovering.har',
        status: 'processing',
        jobId: fileId,
      };
    });

    const file = new File(['{}'], 'recovering.har');
    const first = chunkedUploader.uploadFile(file, 'har');
    await vi.waitFor(() => expect(apiClient.getHarStatus).toHaveBeenCalledTimes(1));
    const second = chunkedUploader.uploadFile(file, 'har');
    expect(second).toBe(first);

    releaseStatus();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(secondResult).toEqual(firstResult);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('surfaces an authoritative terminal processing error after an ambiguous completion failure', async () => {
    vi.mocked(axios.post).mockReset();
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Request failed',
        response: { status: 500, data: { error: 'Failed to complete upload' }, headers: {} },
      });
    vi.mocked(apiClient.getHarStatus).mockResolvedValue({
      fileId: 'invalid-file',
      fileName: 'invalid.har',
      status: 'error',
      error: 'HAR file contains an invalid request entry.',
    });

    await expect(
      chunkedUploader.uploadFile(new File(['{}'], 'invalid.har'), 'har'),
    ).rejects.toThrow('HAR file contains an invalid request entry.');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent uploads of the same File object', async () => {
    let releaseChunk!: () => void;
    const chunkPending = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    vi.mocked(axios.post).mockReset();
    vi.mocked(axios.post)
      .mockImplementationOnce(async () => {
        await chunkPending;
        return { data: {} };
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: {
          success: true,
          fileId: 'assembled-file',
          jobId: 'job-1',
          fileName: 'sample.har',
          fileSize: 2,
          hash: 'hash',
          message: 'ok',
        },
      });

    const file = new File(['{}'], 'sample.har');
    const first = chunkedUploader.uploadFile(file, 'har');
    const second = chunkedUploader.uploadFile(file, 'har');

    expect(second).toBe(first);
    releaseChunk();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('cancels an active upload through its abort signal', async () => {
    vi.mocked(axios.post).mockReset().mockImplementation((_url, _data, config) => (
      new Promise((_resolve, reject) => {
        config?.signal?.addEventListener('abort', () => reject({
          isAxiosError: true,
          code: 'ERR_CANCELED',
          message: 'canceled',
        }));
      })
    ));
    const file = new File(['{}'], 'invalid.har');
    const upload = chunkedUploader.uploadFile(file, 'har');

    await vi.waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1));
    expect(chunkedUploader.cancelUpload(file, 'har')).toBe(true);
    await expect(upload).rejects.toBeTruthy();
  });
});
