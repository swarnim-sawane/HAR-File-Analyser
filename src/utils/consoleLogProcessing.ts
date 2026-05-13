import type { UploadResult } from '../services/chunkedUploader';

export const CONSOLE_LOG_LOCAL_PARSE_THRESHOLD_BYTES = 64 * 1024 * 1024;

export function shouldParseConsoleLogLocally(fileSizeBytes: number): boolean {
  return fileSizeBytes > 0 && fileSizeBytes <= CONSOLE_LOG_LOCAL_PARSE_THRESHOLD_BYTES;
}

export function createLocalConsoleLogUploadResult(file: File): UploadResult {
  return {
    success: true,
    fileId: `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    jobId: 'local',
    fileName: file.name,
    fileSize: file.size,
    hash: 'local',
    message: 'Console log will be parsed locally',
  };
}
