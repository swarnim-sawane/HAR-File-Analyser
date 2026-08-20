import axios, { AxiosInstance } from 'axios';
import {
  Entry,
  HarEntriesResponse,
  HarEntryQuery,
  HarFile,
} from '../types/har';
import {
  ConsoleLogEntriesResponse,
  ConsoleLogEntry,
  ConsoleLogQuery,
} from '../types/consolelog';
import { API_BASE_URL } from './runtimeUrls';

const DEFAULT_API_TIMEOUT_MS = 60_000;
// The OCI API Gateway allows 300 seconds. Large HARs can take longer than the
// default API timeout to stream through the signed UI proxy, so keep this
// request just below the gateway ceiling instead of aborting and restarting
// the entire download after 60 seconds.
export const HAR_DATA_TIMEOUT_MS = 295_000;

export interface HarFileStatus {
  fileId: string;
  fileName: string;
  status: string;
  fileSize?: number | null;
  hash?: string;
  jobId?: string;
  totalEntries?: number | null;
  uploadedAt?: string | null;
  processedAt?: string | null;
  error?: string;
}

class ApiClient {
  private client: AxiosInstance;
  private sessionId: string;

  constructor() {
    this.sessionId = this.getOrCreateSessionId();

    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: DEFAULT_API_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': this.sessionId
      }
    });

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('API Error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  private getOrCreateSessionId(): string {
    let sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('sessionId', sessionId);
    }
    return sessionId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  // HAR API Methods
  async getHarData(fileId: string): Promise<HarFile> {
    const response = await this.client.get(`/api/har/${fileId}`, {
      timeout: HAR_DATA_TIMEOUT_MS,
    });
    return response.data;
  }

  async getHarStatus(fileId: string): Promise<HarFileStatus> {
    // ✅ FIXED: Match route pattern /:fileId/status
    const response = await this.client.get(`/api/har/${fileId}/status`);
    return response.data;
  }

  async getHarEntries(
    fileId: string,
    pageOrQuery: number | HarEntryQuery = 1,
    limit: number = 100
  ): Promise<HarEntriesResponse> {
    const params =
      typeof pageOrQuery === 'number'
        ? { page: pageOrQuery, limit }
        : pageOrQuery;
    const response = await this.client.get(`/api/har/${fileId}/entries`, {
      params,
    });
    return response.data;
  }

  async getHarEntry(fileId: string, index: number): Promise<Entry> {
    const response = await this.client.get(`/api/har/${fileId}/entries/${index}`);
    return response.data;
  }

  async getHarStats(fileId: string) {
    const response = await this.client.get(`/api/har/${fileId}/stats`);
    return response.data;
  }

  async exportHarData(fileId: string, _query?: HarEntryQuery, fileName?: string): Promise<void> {
    const harData = await this.getHarData(fileId);
    const blob = new Blob([JSON.stringify(harData, null, 2)], {
      type: 'application/json',
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName || `${fileId}.har`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(objectUrl);
  }

  // Console Log API Methods
  async getLogStatus(fileId: string) {
    // ✅ FIXED: Match route pattern /:fileId/status
    const response = await this.client.get(`/api/console-log/${fileId}/status`);
    return response.data;
  }

  async getLogEntries(
    fileId: string,
    pageOrQuery: number | ConsoleLogQuery = 1,
    limit: number = 100
  ): Promise<ConsoleLogEntriesResponse> {
    const params =
      typeof pageOrQuery === 'number'
        ? { page: pageOrQuery, limit }
        : {
            ...pageOrQuery,
            levels: Array.isArray(pageOrQuery.levels)
              ? pageOrQuery.levels.join(',')
              : pageOrQuery.levels,
          };
    const response = await this.client.get(`/api/console-log/${fileId}/entries`, {
      params,
    });
    return response.data;
  }

  async getLogEntry(fileId: string, index: number): Promise<ConsoleLogEntry> {
    const response = await this.client.get(`/api/console-log/${fileId}/entries/${index}`);
    return response.data;
  }

  async getLogStats(fileId: string) {
    const response = await this.client.get(`/api/console-log/${fileId}/stats`);
    return response.data;
  }

  // AI Query Methods
  async queryAI(fileId: string, query: string, fileType: 'har' | 'log' = 'har') {
    const response = await this.client.post('/api/ai/query', {
      fileId,
      query,
      fileType
    }, {
      responseType: 'stream'
    });
    return response.data;
  }

  // Health check
  async healthCheck() {
    const response = await this.client.get('/health');
    return response.data;
  }
}

export const apiClient = new ApiClient();
