import { describe, expect, it } from 'vitest';
import { isSafeUploadFileId, isSupportedUploadFileType } from './uploadValidation';

describe('upload validation', () => {
  it('allows only path-safe upload file IDs', () => {
    expect(isSafeUploadFileId('file_1779815703891_small_har')).toBe(true);
    expect(isSafeUploadFileId('sanitized-file_123')).toBe(true);

    expect(isSafeUploadFileId('../secret')).toBe(false);
    expect(isSafeUploadFileId('file id with spaces')).toBe(false);
    expect(isSafeUploadFileId('{"$ne":null}')).toBe(false);
  });

  it('allows only file types declared by the OpenAPI upload contract', () => {
    expect(isSupportedUploadFileType('har')).toBe(true);
    expect(isSupportedUploadFileType('log')).toBe(true);

    expect(isSupportedUploadFileType('zip')).toBe(false);
    expect(isSupportedUploadFileType('')).toBe(false);
    expect(isSupportedUploadFileType(undefined)).toBe(false);
  });
});
