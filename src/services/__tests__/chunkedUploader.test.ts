import { describe, expect, it } from 'vitest';
import { describeUploadError } from '../chunkedUploader';

describe('describeUploadError', () => {
  it('explains backend connectivity failures clearly', () => {
    const error = {
      isAxiosError: true,
      code: 'ERR_NETWORK',
      message: 'Network Error',
    };

    expect(describeUploadError(error, 'chunk 1')).toBe(
      'Backend API is unreachable while uploading chunk 1. Confirm the backend is running and reachable.',
    );
  });

  it('includes backend response errors when available', () => {
    const error = {
      isAxiosError: true,
      response: {
        status: 503,
        data: {
          error: 'Oracle JSON Database not connected',
        },
      },
    };

    expect(describeUploadError(error, 'upload completion')).toBe(
      'Upload completion failed during upload completion: Oracle JSON Database not connected',
    );
  });
});
