export const CURRENT_CLIENT_CHUNK_SIZE_BYTES = 3 * 1024 * 1024;
export const LEGACY_CLIENT_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

// Keep this bounded so accidental full-file posts still fail, but allow older
// cached clients that used 5 MB chunks plus multipart overhead.
export const MAX_UPLOAD_CHUNK_SIZE_BYTES = 12 * 1024 * 1024;

const formatMegabytes = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)} MB`;

export const isMulterFileTooLargeError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: string }).code === 'LIMIT_FILE_SIZE';
};

export const buildChunkTooLargeResponse = () => ({
  error: 'Upload chunk too large',
  details:
    `The uploaded chunk exceeded the ${formatMegabytes(MAX_UPLOAD_CHUNK_SIZE_BYTES)} server limit. ` +
    'Please refresh the page and retry so the current chunked uploader is loaded.',
  maxChunkSize: MAX_UPLOAD_CHUNK_SIZE_BYTES,
});
