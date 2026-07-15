import { describe, expect, it } from 'vitest';
import {
  isSafeUploadFileId,
  isSupportedUploadFileType,
  parseUploadChunkIndex,
  parseUploadTotalChunks,
} from './uploadValidation';

describe('upload validation helpers', () => {
  it('accepts only safe upload file ids and supported file types', () => {
    expect(isSafeUploadFileId('file_123-abc')).toBe(true);
    expect(isSafeUploadFileId('../file')).toBe(false);
    expect(isSafeUploadFileId('file/123')).toBe(false);
    expect(isSafeUploadFileId('file id with spaces')).toBe(false);
    expect(isSafeUploadFileId('{"$ne":null}')).toBe(false);

    expect(isSupportedUploadFileType('har')).toBe(true);
    expect(isSupportedUploadFileType('log')).toBe(true);
    expect(isSupportedUploadFileType('zip')).toBe(false);
    expect(isSupportedUploadFileType(undefined)).toBe(false);
  });

  it('parses bounded positive total chunk counts', () => {
    expect(parseUploadTotalChunks('1')).toBe(1);
    expect(parseUploadTotalChunks(12)).toBe(12);
    expect(parseUploadTotalChunks('0')).toBeNull();
    expect(parseUploadTotalChunks('-1')).toBeNull();
    expect(parseUploadTotalChunks('1.5')).toBeNull();
    expect(parseUploadTotalChunks('10001')).toBeNull();
  });

  it('parses chunk indexes within the declared total chunk range', () => {
    expect(parseUploadChunkIndex('0', 3)).toBe(0);
    expect(parseUploadChunkIndex(2, 3)).toBe(2);
    expect(parseUploadChunkIndex('3', 3)).toBeNull();
    expect(parseUploadChunkIndex('-1', 3)).toBeNull();
    expect(parseUploadChunkIndex('1.5', 3)).toBeNull();
  });
});
