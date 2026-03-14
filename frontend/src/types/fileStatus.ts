export interface FileStatus {
  fileName: string;
  fileSize: number;
  status: 'uploading' | 'processing' | 'parsing' | 'indexing' | 'analyzing' | 'ready' | 'error';
  progress?: number;
  totalEntries?: number;
  stats?: any; // Will be HarStats or LogStats depending on context
  error?: string;
}
