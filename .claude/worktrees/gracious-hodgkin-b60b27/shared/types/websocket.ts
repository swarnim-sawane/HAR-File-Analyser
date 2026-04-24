export interface SocketEvent<T = any> {
  event: string;
  data: T;
  timestamp?: number;
}

export interface UploadProgressEvent {
  fileId: string;
  progress: number;
  receivedChunks: number;
  totalChunks: number;
}

export interface UploadCompleteEvent {
  fileId: string;
  jobId: string;
  fileName: string;
  fileSize: number;
}

export interface ProcessingProgressEvent {
  fileId: string;
  status: string;
  progress?: number;
  step?: string;
  message?: string;
}

export interface FileStatusEvent {
  fileId: string;
  status: string;
  progress?: number;
  error?: string;
}

export interface EmbeddingProgressEvent {
  fileId?: string;
  processed: number;
  total: number;
  progress: number;
}

export interface IndexingProgressEvent {
  fileId: string;
  processed: number;
  total: number;
  progress?: number;
}

export interface AiStreamEvent {
  fileId: string;
  chunk: string;
  done: boolean;
}

export interface AiCompleteEvent {
  fileId: string;
  answer: string;
  context?: string[];
}

export interface AiErrorEvent {
  fileId: string;
  error: string;
  message?: string;
}

export interface AiQueryEvent {
  fileId: string;
  query: string;
  timestamp: number;
}

export type WebSocketEventType =
  | 'upload:progress'
  | 'upload:complete'
  | 'processing:progress'
  | 'file:status'
  | 'embedding:progress'
  | 'indexing:progress'
  | 'ai:stream'
  | 'ai:complete'
  | 'ai:error'
  | 'ai:query'
  | 'ai:received'
  | 'subscribe:file'
  | 'connect'
  | 'disconnect';
