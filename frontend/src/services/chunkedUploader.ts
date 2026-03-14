import axios from 'axios';
import { apiClient } from './apiClient';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

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
  async uploadFile(
    file: File,
    fileType: 'har' | 'log',
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    const fileId = this.generateFileId();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    console.log(`Starting chunked upload: ${file.name}`);
    console.log(`File size: ${file.size} bytes, Chunks: ${totalChunks}`);

    // Upload chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      await this.uploadChunk(fileId, i, totalChunks, chunk);

      // Report progress
      const progress: UploadProgress = {
        fileId,
        fileName: file.name,
        totalChunks,
        uploadedChunks: i + 1,
        progress: ((i + 1) / totalChunks) * 100
      };

      if (onProgress) {
        onProgress(progress);
      }
    }

    // Complete upload
    console.log(`All chunks uploaded, assembling file...`);
    const result = await this.completeUpload(fileId, totalChunks, file.name, fileType);
    
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

    try {
      await axios.post(`${API_BASE_URL}/api/upload/chunk`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'X-Session-Id': apiClient.getSessionId()
        },
        timeout: 60000
      });
    } catch (error) {
      console.error(`Failed to upload chunk ${chunkIndex}:`, error);
      throw new Error(`Chunk upload failed: ${chunkIndex}`);
    }
  }

  private async completeUpload(
    fileId: string,
    totalChunks: number,
    fileName: string,
    fileType: 'har' | 'log'
  ): Promise<UploadResult> {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/upload/complete`,
        {
          fileId,
          totalChunks,
          fileName,
          fileType
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': apiClient.getSessionId()
          },
          timeout: 120000 // 2 minute timeout for assembly
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
        {
          headers: {
            'X-Session-Id': apiClient.getSessionId()
          }
        }
      );
      return response.data.progress;
    } catch (error) {
      console.error('Failed to get upload progress:', error);
      return 0;
    }
  }
}

export const chunkedUploader = new ChunkedUploader();
