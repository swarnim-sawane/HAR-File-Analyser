import type { ParsedHarEntry } from '../services/streamingParser';

export const HAR_STORAGE_TEXT_LIMIT_BYTES = 256 * 1024;

type StoredHarEntry = ParsedHarEntry & {
  fileId: string;
  createdAt: Date;
  storage?: {
    truncatedFields: string[];
  };
};

function truncateTextForStorage(value: unknown): { value: unknown; truncated: boolean } {
  if (typeof value !== 'string') {
    return { value, truncated: false };
  }

  if (Buffer.byteLength(value, 'utf8') <= HAR_STORAGE_TEXT_LIMIT_BYTES) {
    return { value, truncated: false };
  }

  const suffix = '\n[truncated for analyzer storage; original body remains in the processed HAR file]';
  let end = Math.min(value.length, HAR_STORAGE_TEXT_LIMIT_BYTES);
  let truncated = value.slice(0, end);

  while (Buffer.byteLength(truncated + suffix, 'utf8') > HAR_STORAGE_TEXT_LIMIT_BYTES + 128 && end > 0) {
    end = Math.floor(end * 0.9);
    truncated = value.slice(0, end);
  }

  return { value: `${truncated}${suffix}`, truncated: true };
}

export function prepareHarEntryForStorage(
  entry: ParsedHarEntry,
  fileId: string,
  createdAt: Date,
): StoredHarEntry {
  const stored: StoredHarEntry = {
    ...entry,
    request: entry.request ? { ...entry.request } : entry.request,
    response: entry.response ? { ...entry.response } : entry.response,
    fileId,
    createdAt,
  };
  const truncatedFields: string[] = [];

  if (stored.request?.postData) {
    stored.request.postData = { ...stored.request.postData };
    const result = truncateTextForStorage(stored.request.postData.text);
    stored.request.postData.text = result.value;
    if (result.truncated) truncatedFields.push('request.postData.text');
  }

  if (stored.response?.content) {
    stored.response.content = { ...stored.response.content };
    const result = truncateTextForStorage(stored.response.content.text);
    stored.response.content.text = result.value;
    if (result.truncated) truncatedFields.push('response.content.text');
  }

  if (truncatedFields.length > 0) {
    stored.storage = { truncatedFields };
  }

  return stored;
}
