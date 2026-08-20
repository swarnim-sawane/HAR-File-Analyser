import axios from 'axios';
import { apiClient } from './apiClient';
import { API_BASE_URL } from './runtimeUrls';

const MAX_ERROR_DETAIL_LENGTH = 240;

const sanitizeErrorDetail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_ERROR_DETAIL_LENGTH);
};

export const formatUploadError = (error: unknown, fallback: string): string => {
  if (!axios.isAxiosError(error)) {
    return sanitizeErrorDetail(error instanceof Error ? error.message : null) ?? fallback;
  }

  const status = error.response?.status;
  const responseData = error.response?.data;
  const serverDetail =
    sanitizeErrorDetail(typeof responseData === 'object' && responseData !== null
      ? (responseData as { error?: unknown; message?: unknown }).error
        ?? (responseData as { error?: unknown; message?: unknown }).message
      : responseData);
  const requestId = sanitizeErrorDetail(
    error.response?.headers?.['opc-request-id'] ?? error.response?.headers?.['x-request-id'],
  );

  const parts = [
    serverDetail ?? sanitizeErrorDetail(error.message) ?? fallback,
    status ? `HTTP ${status}` : null,
    requestId ? `request ${requestId}` : null,
  ].filter(Boolean);

  return parts.join(' - ');
};

const logUploadFailure = (operation: string, error: unknown) => {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  const requestId = axios.isAxiosError(error)
    ? error.response?.headers?.['opc-request-id'] ?? error.response?.headers?.['x-request-id']
    : undefined;
  console.error(operation, {
    status,
    requestId: sanitizeErrorDetail(requestId),
    message: formatUploadError(error, 'Upload request failed'),
  });
};

// Tuned for bandwidth-constrained deployments (corporate LAN ~0.8 MB/s):
// 3MB chunks → cheaper retry cost on timeout vs 10MB chunks
// 2 parallel streams → avoids bandwidth contention on slow links
// Data compressed before chunking → 99MB HAR ≈ 10MB on wire
const CHUNK_SIZE = 3 * 1024 * 1024;  // 3 MB per chunk
const PARALLEL_UPLOADS = 2;           // concurrent chunk uploads
const CHUNK_TIMEOUT_MS = 120_000;     // 2 min per chunk (large files on slow connections)
// Assembly timeout scales with file size: base 30s + 1s per MB, capped at 30 min
const assemblyTimeout = (fileSizeBytes: number) =>
  Math.min(30_000 + Math.ceil(fileSizeBytes / 1024 / 1024) * 1000, 30 * 60 * 1000);
const MAX_TRANSIENT_COMPLETION_REQUESTS = 3;
const COMPLETION_STATUS_RECOVERY_ATTEMPTS = 3;
const RECOVERABLE_ACCEPTED_STATUSES = new Set([
  'processing',
  'parsing',
  'analyzing',
  'ready',
  'complete',
  'completed',
]);

const isRetryableCompletionError = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false;
  if (!error.response) return error.code !== 'ERR_CANCELED';

  const status = error.response.status;
  return status === 408 || status === 425 || status === 429
    || status === 502 || status === 503 || status === 504;
};

const isAmbiguousCompletionError = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false;
  if (!error.response) return error.code !== 'ERR_CANCELED';
  return error.response.status >= 500
    || error.response.status === 408
    || error.response.status === 425
    || error.response.status === 429;
};

export interface UploadProgress {
  fileId: string;
  fileName: string;
  totalChunks: number;
  uploadedChunks: number;
  progress: number;
}

export interface UploadResult {
  success: boolean;
  fileId: string;
  jobId: string;
  fileName: string;
  fileSize: number;
  hash: string;
  message: string;
  /** Stable client id used to replace a progressive local preview with the server result. */
  previewId?: string;
}

interface InFlightUpload {
  promise: Promise<UploadResult>;
  progressListeners: Set<(progress: UploadProgress) => void>;
  controller: AbortController;
}

class ChunkedUploader {
  private readonly inFlightUploads = new WeakMap<File, Map<'har' | 'log', InFlightUpload>>();

  private async compressFile(file: File): Promise<{ blob: Blob; compressed: boolean }> {
    if (typeof CompressionStream === 'undefined') {
      return { blob: file, compressed: false };
    }
    try {
      const stream = file.stream().pipeThrough(new CompressionStream('gzip'));
      const response = new Response(stream);
      const blob = await response.blob();
      console.log(`Compressed: ${(file.size / 1024 / 1024).toFixed(1)} MB → ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
      return { blob, compressed: true };
    } catch {
      return { blob: file, compressed: false };
    }
  }

  uploadFile(
    file: File,
    fileType: 'har' | 'log',
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    const byType = this.inFlightUploads.get(file);
    const existing = byType?.get(fileType);
    if (existing) {
      if (onProgress) existing.progressListeners.add(onProgress);
      return existing.promise;
    }

    const progressListeners = new Set<(progress: UploadProgress) => void>();
    if (onProgress) progressListeners.add(onProgress);
    const notifyProgress = (progress: UploadProgress) => {
      progressListeners.forEach((listener) => listener(progress));
    };

    const controller = new AbortController();
    const promise = this.performUpload(file, fileType, notifyProgress, controller.signal);
    const entry: InFlightUpload = { promise, progressListeners, controller };
    const registry = byType ?? new Map<'har' | 'log', InFlightUpload>();
    registry.set(fileType, entry);
    if (!byType) this.inFlightUploads.set(file, registry);

    const cleanup = () => {
      const current = this.inFlightUploads.get(file);
      if (current?.get(fileType) !== entry) return;
      current.delete(fileType);
      if (current.size === 0) this.inFlightUploads.delete(file);
    };
    void promise.then(cleanup, cleanup);
    return promise;
  }

  cancelUpload(file: File, fileType: 'har' | 'log'): boolean {
    const active = this.inFlightUploads.get(file)?.get(fileType);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  private async performUpload(
    file: File,
    fileType: 'har' | 'log',
    onProgress?: (progress: UploadProgress) => void,
    signal?: AbortSignal,
  ): Promise<UploadResult> {
    const fileId = this.generateFileId();

    const { blob: uploadBlob, compressed } = await this.compressFile(file);
    if (signal?.aborted) throw new Error('Upload cancelled.');
    const totalChunks = Math.ceil(uploadBlob.size / CHUNK_SIZE);

    console.log(`Starting chunked upload: ${file.name}`);
    console.log(`File size: ${(file.size / 1024 / 1024).toFixed(1)} MB → ${(uploadBlob.size / 1024 / 1024).toFixed(1)} MB compressed, Chunks: ${totalChunks} × ${CHUNK_SIZE / 1024 / 1024}MB, Parallel: ${PARALLEL_UPLOADS}`);

    let uploadedChunks = 0;

    for (let batchStart = 0; batchStart < totalChunks; batchStart += PARALLEL_UPLOADS) {
      const batchEnd = Math.min(batchStart + PARALLEL_UPLOADS, totalChunks);
      const batch = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, uploadBlob.size);
        const chunk = uploadBlob.slice(start, end);
        batch.push(this.uploadChunk(fileId, i, totalChunks, chunk, signal));
      }

      await Promise.all(batch);
      uploadedChunks += batchEnd - batchStart;

      if (onProgress) {
        onProgress({
          fileId,
          fileName: file.name,
          totalChunks,
          uploadedChunks,
          progress: (uploadedChunks / totalChunks) * 100
        });
      }
    }

    console.log(`All ${totalChunks} chunks uploaded, requesting assembly...`);
    const result = await this.completeUpload(
      fileId,
      totalChunks,
      file.name,
      fileType,
      file.size,
      compressed,
      signal,
    );
    return result;
  }

  private async uploadChunk(
    fileId: string,
    chunkIndex: number,
    totalChunks: number,
    chunk: Blob,
    signal?: AbortSignal,
  ): Promise<void> {
    const formData = new FormData();
    formData.append('chunk', chunk);
    formData.append('fileId', fileId);
    formData.append('chunkIndex', chunkIndex.toString());
    formData.append('totalChunks', totalChunks.toString());

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await axios.post(`${API_BASE_URL}/api/upload/chunk`, formData, {
          headers: {
            'X-Session-Id': apiClient.getSessionId()
          },
          timeout: CHUNK_TIMEOUT_MS,
          signal,
        });
        return; // success
      } catch (error) {
        if (signal?.aborted || (axios.isAxiosError(error) && error.code === 'ERR_CANCELED')) {
          throw error;
        }
        if (attempt === MAX_RETRIES) {
          logUploadFailure(`Failed to upload chunk ${chunkIndex} after ${MAX_RETRIES} attempts`, error);
          throw new Error(`Chunk ${chunkIndex + 1} upload failed: ${formatUploadError(error, 'Request failed')}`);
        }
        // Exponential back-off: 1s, 2s, 4s
        const delay = 1000 * Math.pow(2, attempt - 1);
        console.warn(`Chunk ${chunkIndex} attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  private async completeUpload(
    fileId: string,
    totalChunks: number,
    fileName: string,
    fileType: 'har' | 'log',
    fileSizeBytes: number,
    compressed: boolean,
    signal?: AbortSignal,
  ): Promise<UploadResult> {
    const timeout = assemblyTimeout(fileSizeBytes);
    const deadline = Date.now() + timeout;
    let transientAttempt = 0;

    try {
      console.log(`Assembly timeout set to ${Math.round(timeout / 1000)}s for ${(fileSizeBytes / 1024 / 1024).toFixed(0)} MB file`);

      while (Date.now() < deadline) {
        const remaining = Math.max(1_000, deadline - Date.now());
        try {
          const response = await axios.post(
            `${API_BASE_URL}/api/upload/complete`,
            { fileId, totalChunks, fileName, fileType, ...(compressed ? { compressed: 'gzip' } : {}) },
            {
              headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': apiClient.getSessionId()
              },
              timeout: remaining,
              signal,
            }
          );

          if (response.status === 202 || response.data?.status === 'processing') {
            const retryAfterSeconds = Number.parseInt(response.headers?.['retry-after'] ?? '1', 10);
            const delayMs = Math.min(
              5_000,
              Math.max(250, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1_000 : 1_000),
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }

          if (response.data?.success !== true) {
            throw new Error('Upload completion returned an invalid response.');
          }
          return response.data;
        } catch (error) {
          if (isAmbiguousCompletionError(error)) {
            const recovered = await this.recoverAcceptedCompletion(
              fileId,
              fileName,
              fileSizeBytes,
              signal,
            );
            if (recovered) return recovered;
          }

          transientAttempt += 1;
          if (
            !isRetryableCompletionError(error)
            || transientAttempt >= MAX_TRANSIENT_COMPLETION_REQUESTS
            || Date.now() >= deadline - 1_000
          ) throw error;
          await new Promise((resolve) => setTimeout(
            resolve,
            Math.min(5_000, 500 * (2 ** Math.min(transientAttempt - 1, 3))),
          ));
        }
      }

      throw new Error('Upload completion timed out.');
    } catch (error) {
      logUploadFailure('Failed to complete upload', error);
      throw new Error(`Upload completion failed: ${formatUploadError(error, 'Request failed')}`);
    }
  }

  private async recoverAcceptedCompletion(
    fileId: string,
    fallbackFileName: string,
    fallbackFileSize: number,
    signal?: AbortSignal,
  ): Promise<UploadResult | null> {
    for (let attempt = 0; attempt < COMPLETION_STATUS_RECOVERY_ATTEMPTS; attempt += 1) {
      if (signal?.aborted) throw new Error('Upload cancelled.');

      try {
        const status = await apiClient.getHarStatus(fileId);
        const normalizedStatus = status.status?.trim().toLowerCase() || '';
        if (RECOVERABLE_ACCEPTED_STATUSES.has(normalizedStatus)) {
          return {
            success: true,
            fileId,
            jobId: status.jobId || fileId,
            fileName: status.fileName || fallbackFileName,
            fileSize: typeof status.fileSize === 'number' ? status.fileSize : fallbackFileSize,
            hash: status.hash || '',
            message: normalizedStatus === 'ready'
              ? 'File processing completed; upload status recovered.'
              : 'File upload was accepted; processing continues.',
          };
        }

        if (normalizedStatus === 'error' || normalizedStatus === 'failed') {
          throw new Error(
            sanitizeErrorDetail(status.error)
              ?? 'The server rejected this HAR file during processing.',
          );
        }
      } catch (statusError) {
        if (!axios.isAxiosError(statusError)) throw statusError;
        const statusCode = statusError.response?.status;
        if (statusCode !== 404 && statusCode !== 409 && statusCode !== undefined && statusCode < 500) {
          return null;
        }
      }

      if (attempt < COMPLETION_STATUS_RECOVERY_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }

    return null;
  }

  private generateFileId(): string {
    return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async getUploadProgress(fileId: string): Promise<number> {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/upload/progress/${fileId}`,
        { headers: { 'X-Session-Id': apiClient.getSessionId() } }
      );
      return response.data.progress;
    } catch (error) {
      console.error('Failed to get upload progress:', error);
      return 0;
    }
  }
}

export const chunkedUploader = new ChunkedUploader();
