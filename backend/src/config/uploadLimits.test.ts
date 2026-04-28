import { describe, expect, it } from 'vitest';
import {
  CURRENT_CLIENT_CHUNK_SIZE_BYTES,
  LEGACY_CLIENT_CHUNK_SIZE_BYTES,
  MAX_UPLOAD_CHUNK_SIZE_BYTES,
  buildChunkTooLargeResponse,
  isMulterFileTooLargeError,
} from './uploadLimits';

describe('upload chunk limits', () => {
  it('allows current and legacy client chunk sizes with server headroom', () => {
    expect(CURRENT_CLIENT_CHUNK_SIZE_BYTES).toBe(3 * 1024 * 1024);
    expect(LEGACY_CLIENT_CHUNK_SIZE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_UPLOAD_CHUNK_SIZE_BYTES).toBeGreaterThan(LEGACY_CLIENT_CHUNK_SIZE_BYTES);
  });

  it('identifies Multer file-size rejections and returns a clear 413 payload', () => {
    const error = { code: 'LIMIT_FILE_SIZE' };

    expect(isMulterFileTooLargeError(error)).toBe(true);
    expect(buildChunkTooLargeResponse()).toMatchObject({
      error: 'Upload chunk too large',
      maxChunkSize: MAX_UPLOAD_CHUNK_SIZE_BYTES,
    });
    expect(buildChunkTooLargeResponse().details).toContain('refresh');
  });
});
