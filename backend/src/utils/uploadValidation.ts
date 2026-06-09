const SAFE_UPLOAD_FILE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SUPPORTED_UPLOAD_FILE_TYPES = new Set(['har', 'log']);
const MAX_UPLOAD_CHUNKS = 10_000;

export function isSafeUploadFileId(fileId: unknown): fileId is string {
  return typeof fileId === 'string' && SAFE_UPLOAD_FILE_ID_PATTERN.test(fileId);
}

export function isSupportedUploadFileType(fileType: unknown): fileType is 'har' | 'log' {
  return typeof fileType === 'string' && SUPPORTED_UPLOAD_FILE_TYPES.has(fileType);
}

function parseIntegerField(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  return null;
}

export function parseUploadTotalChunks(value: unknown): number | null {
  const parsed = parseIntegerField(value);
  if (parsed === null || parsed < 1 || parsed > MAX_UPLOAD_CHUNKS) {
    return null;
  }

  return parsed;
}

export function parseUploadChunkIndex(value: unknown, totalChunks: number): number | null {
  const parsed = parseIntegerField(value);
  if (parsed === null || parsed < 0 || parsed >= totalChunks) {
    return null;
  }

  return parsed;
}
