import axios from 'axios';
import { apiClient } from './apiClient';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

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
}

class ChunkedUploader {
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

  async uploadFile(
    file: File,
    fileType: 'har' | 'log',
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    const fileId = this.generateFileId();

    const { blob: uploadBlob, compressed } = await this.compressFile(file);
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
        batch.push(this.uploadChunk(fileId, i, totalChunks, chunk));
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
    const result = await this.completeUpload(fileId, totalChunks, file.name, fileType, file.size, compressed);
    return result;
  }

  private async uploadChunk(
    fileId: string,
    chunkIndex: number,
    totalChunks: number,
    chunk: Blob
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
            'Content-Type': 'multipart/form-data',
            'X-Session-Id': apiClient.getSessionId()
          },
          timeout: CHUNK_TIMEOUT_MS
        });
        return; // success
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          console.error(`Failed to upload chunk ${chunkIndex} after ${MAX_RETRIES} attempts:`, error);
          throw new Error(`Chunk upload failed: ${chunkIndex}`);
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
    compressed: boolean
  ): Promise<UploadResult> {
    try {
      const timeout = assemblyTimeout(fileSizeBytes);
      console.log(`Assembly timeout set to ${Math.round(timeout / 1000)}s for ${(fileSizeBytes / 1024 / 1024).toFixed(0)} MB file`);

      const response = await axios.post(
        `${API_BASE_URL}/api/upload/complete`,
        { fileId, totalChunks, fileName, fileType, ...(compressed ? { compressed: 'gzip' } : {}) },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': apiClient.getSessionId()
          },
          timeout
        }
      );
      return response.data;
    } catch (error) {
      console.error('Failed to complete upload:', error);
      throw new Error('Upload completion failed');
    }
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
