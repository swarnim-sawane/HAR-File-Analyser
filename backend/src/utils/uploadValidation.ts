const SAFE_UPLOAD_FILE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SUPPORTED_UPLOAD_FILE_TYPES = new Set(['har', 'log']);

export function isSafeUploadFileId(fileId: unknown): fileId is string {
  return typeof fileId === 'string' && SAFE_UPLOAD_FILE_ID_PATTERN.test(fileId);
}

export function isSupportedUploadFileType(fileType: unknown): fileType is 'har' | 'log' {
  return typeof fileType === 'string' && SUPPORTED_UPLOAD_FILE_TYPES.has(fileType);
}
