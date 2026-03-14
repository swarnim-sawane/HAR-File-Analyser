import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

class ApiClient {
  private client: AxiosInstance;
  private sessionId: string;

  constructor() {
    this.sessionId = this.getOrCreateSessionId();

    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 60000,
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
  async getHarStatus(fileId: string) {
    // ✅ FIXED: Match route pattern /:fileId/status
    const response = await this.client.get(`/api/har/${fileId}/status`);
    return response.data;
  }

  async getHarEntries(fileId: string, page: number = 1, limit: number = 100) {
    const response = await this.client.get(`/api/har/${fileId}/entries`, {
      params: { page, limit }
    });
    return response.data;
  }

  async getHarStats(fileId: string) {
    const response = await this.client.get(`/api/har/${fileId}/stats`);
    return response.data;
  }

  // Console Log API Methods
  async getLogStatus(fileId: string) {
    // ✅ FIXED: Match route pattern /:fileId/status
    const response = await this.client.get(`/api/console-log/${fileId}/status`);
    return response.data;
  }

  async getLogEntries(fileId: string, page: number = 1, limit: number = 100) {
    const response = await this.client.get(`/api/console-log/${fileId}/entries`, {
      params: { page, limit }
    });
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
