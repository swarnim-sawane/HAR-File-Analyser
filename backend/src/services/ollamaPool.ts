import axios, { AxiosResponse } from 'axios';

interface OllamaInstance {
  id: string;
  url: string;
  status: 'idle' | 'busy';
  currentLoad: number;
  maxConcurrency: number;
  lastHealthCheck: Date | null;
  healthy: boolean;
}

interface QueuedRequest {
  resolve: (instance: OllamaInstance) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

class OllamaPoolManager {
  private instances: OllamaInstance[] = [];
  private queue: QueuedRequest[] = [];
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Parse OLLAMA_URLS from environment
    const urls = (process.env.OLLAMA_URLS || 'http://localhost:11434').split(',');
    
    this.instances = urls.map((url, index) => ({
      id: `ollama-${index + 1}`,
      url: url.trim(),
      status: 'idle',
      currentLoad: 0,
      maxConcurrency: 2, // Each instance handles 2 concurrent requests
      lastHealthCheck: null,
      healthy: true
    }));
    
    // Start health checks
    this.startHealthChecks();
  }

  async acquireInstance(): Promise<OllamaInstance> {
    // Find instance with available capacity
    const available = this.instances
      .filter(i => i.healthy && i.currentLoad < i.maxConcurrency)
      .sort((a, b) => a.currentLoad - b.currentLoad)[0];
    
    if (available) {
      available.currentLoad++;
      available.status = available.currentLoad >= available.maxConcurrency ? 'busy' : 'idle';
      return available;
    }
    
    // Queue request if all busy
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.queue.findIndex(q => q.resolve === resolve);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error('Ollama pool timeout - all instances busy'));
        }
      }, 30000); // 30 second timeout
      
      this.queue.push({ resolve, reject, timeoutId });
    });
  }

  releaseInstance(instance: OllamaInstance): void {
    instance.currentLoad = Math.max(0, instance.currentLoad - 1);
    instance.status = 'idle';
    
    // Process queued requests
    if (this.queue.length > 0) {
      const { resolve, timeoutId } = this.queue.shift()!;
      clearTimeout(timeoutId);
      instance.currentLoad++;
      instance.status = instance.currentLoad >= instance.maxConcurrency ? 'busy' : 'idle';
      resolve(instance);
    }
  }

  getStats() {
    return {
      instances: this.instances.map(i => ({
        id: i.id,
        url: i.url,
        status: i.status,
        load: `${i.currentLoad}/${i.maxConcurrency}`,
        healthy: i.healthy,
        lastCheck: i.lastHealthCheck
      })),
      totalCapacity: this.instances.reduce((sum, i) => sum + i.maxConcurrency, 0),
      availableCapacity: this.instances
        .filter(i => i.healthy)
        .reduce((sum, i) => sum + (i.maxConcurrency - i.currentLoad), 0),
      queuedRequests: this.queue.length
    };
  }

  async checkInstanceHealth(instance: OllamaInstance): Promise<boolean> {
    try {
      const response = await axios.get(`${instance.url}/api/tags`, {
        timeout: 5000
      });
      
      instance.healthy = response.status === 200;
      instance.lastHealthCheck = new Date();
      return instance.healthy;
    } catch (error) {
      console.error(`Health check failed for ${instance.id}:`, (error as Error).message);
      instance.healthy = false;
      instance.lastHealthCheck = new Date();
      return false;
    }
  }

  startHealthChecks(): void {
    // Check health every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      await Promise.all(
        this.instances.map(instance => this.checkInstanceHealth(instance))
      );
      
      const unhealthy = this.instances.filter(i => !i.healthy);
      if (unhealthy.length > 0) {
        console.warn('Unhealthy Ollama instances:', unhealthy.map(i => i.id));
      }
    }, 30000);
    
    // Initial health check
    this.instances.forEach(instance => this.checkInstanceHealth(instance));
  }

  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }
}

export const ollamaPool = new OllamaPoolManager();

// Stream LLM response
export async function* streamLLMResponse(
  query: string,
  context: string
): AsyncGenerator<string> {
  const instance = await ollamaPool.acquireInstance();
  
  try {
    const prompt = buildPrompt(query, context);
    const model = process.env.OLLAMA_LLM_MODEL || 'llama3.2';
    
    const response = await axios.post(
      `${instance.url}/api/generate`,
      {
        model,
        prompt,
        stream: true,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_predict: 500,
          stop: ['User:', '\n\n\n']
        }
      },
      {
        responseType: 'stream',
        timeout: 60000
      }
    );

    let buffer = '';
    
    for await (const chunk of response.data) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) {
              yield parsed.response;
            }
            if (parsed.done) {
              return;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  } finally {
    ollamaPool.releaseInstance(instance);
  }
}

function buildPrompt(query: string, context: string): string {
  return `You are an expert network analyst analyzing HAR (HTTP Archive) files and console logs. Based on the following data, answer the user's question accurately and concisely.

Context (Relevant Data):
${context}

User Question: ${query}

Instructions:
- Provide specific, data-driven answers based on the context
- Include relevant URLs, status codes, timing information, or log messages
- If the question cannot be answered from the context, say so
- Be concise but thorough
- Format your response clearly with bullet points or paragraphs as appropriate

Answer:`;
}
