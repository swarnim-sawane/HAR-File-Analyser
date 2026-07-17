import { describe, expect, it } from 'vitest';
import { makeParsedEntry } from '../test-utils/fixtures';
import {
  HAR_STORAGE_TEXT_LIMIT_BYTES,
  prepareHarEntryForStorage,
} from './harEntryStorage';

describe('HAR entry storage preparation', () => {
  it('preserves normal HAR entries for database storage', () => {
    const createdAt = new Date('2026-05-25T12:00:00.000Z');
    const entry = makeParsedEntry({
      response: {
        ...makeParsedEntry().response,
        content: {
          ...makeParsedEntry().response.content,
          text: '{"ok":true}',
        },
      },
    });

    const stored = prepareHarEntryForStorage(entry, 'file-1', createdAt);

    expect(stored.fileId).toBe('file-1');
    expect(stored.createdAt).toBe(createdAt);
    expect(stored.response.content.text).toBe('{"ok":true}');
    expect(stored.storage).toBeUndefined();
  });

  it('truncates oversized response and request body text before database storage', () => {
    const largeText = 'x'.repeat(HAR_STORAGE_TEXT_LIMIT_BYTES + 1024);
    const entry = makeParsedEntry({
      request: {
        ...makeParsedEntry().request,
        postData: {
          mimeType: 'application/json',
          text: largeText,
        },
      },
      response: {
        ...makeParsedEntry().response,
        content: {
          ...makeParsedEntry().response.content,
          text: largeText,
        },
      },
    });

    const stored = prepareHarEntryForStorage(entry, 'file-1', new Date('2026-05-25T12:00:00.000Z'));

    expect(Buffer.byteLength(stored.response.content.text, 'utf8')).toBeLessThanOrEqual(
      HAR_STORAGE_TEXT_LIMIT_BYTES + 128,
    );
    expect(Buffer.byteLength(stored.request.postData.text, 'utf8')).toBeLessThanOrEqual(
      HAR_STORAGE_TEXT_LIMIT_BYTES + 128,
    );
    expect(stored.response.content.text).toContain('[truncated for database storage');
    expect(stored.request.postData.text).toContain('[truncated for database storage');
    expect(stored.storage?.truncatedFields).toEqual([
      'request.postData.text',
      'response.content.text',
    ]);
  });
});
