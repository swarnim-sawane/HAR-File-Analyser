export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

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

export interface FileMetadata {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: 'har' | 'log';
  hash: string;
  uploadedAt: string;
  status: FileStatus;
  jobId?: string;
}

export type FileStatus = 
  | 'uploading' 
  | 'processing' 
  | 'parsing' 
  | 'indexing' 
  | 'analyzing' 
  | 'ready' 
  | 'error';

export interface ProcessingStatus {
  fileId: string;
  fileName: string;
  status: FileStatus;
  progress?: number;
  totalEntries?: number;
  currentStep?: string;
  error?: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  services?: {
    mongodb?: string;
    redis?: string;
    qdrant?: string;
  };
}

export interface HarEntriesResponse {
  entries: any[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface LogEntriesResponse {
  entries: any[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface StatsResponse {
  stats: any;
  fileId: string;
  generatedAt: string;
}

export interface AiQueryRequest {
  fileId: string;
  query: string;
  fileType?: 'har' | 'log';
}

export interface AiQueryResponse {
  answer: string;
  context?: string[];
  sources?: string[];
}
