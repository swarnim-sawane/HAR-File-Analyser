// src/services/aiService.ts
import { pipeline, env } from '@xenova/transformers';
import { v4 as uuidv4 } from 'uuid';
import { HarFile, Entry } from '../types/har';

// ✅ Points to your backend proxy, not OCA directly
const BACKEND_BASE_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:4000';
const BACKEND_AI_URL = `${BACKEND_BASE_URL}/api/ai`;

env.allowLocalModels = false;

interface ChunkMetadata {
  id: string;
  entryIndex: number;
  url: string;
  method: string;
  status: number;
  domain: string;
  resourceType: string;
  timestamp: string;
}

interface StoredChunk {
  id: string;
  text: string;
  embedding: number[];
  metadata: ChunkMetadata;
}

interface AnalysisResult {
  answer: string;
  relevantEntries: Entry[];
  sources: ChunkMetadata[];
}

export class HarAIService {
  private embedder: any = null;
  private chunks: StoredChunk[] = [];
  private harData: HarFile | null = null;
  private isEmbedderReady: boolean = false;

  constructor() {
    this.initEmbedder();
  }

  private async initEmbedder() {
    try {
      this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      this.isEmbedderReady = true;
    } catch (error) {
      console.error('Failed to initialize embedder:', error);
      throw new Error('Failed to initialize AI model');
    }
  }

  // ✅ UPDATED: Calls backend /api/ai/status instead of Ollama
  async checkConnection(): Promise<{ connected: boolean; model: string | null }> {
    try {
      const response = await fetch(`${BACKEND_AI_URL}/status`);
      if (!response.ok) return { connected: false, model: null };
      const data = await response.json();
      return { connected: data.connected, model: data.model };
    } catch {
      return { connected: false, model: null };
    }
  }

  // ---- Chunking, embeddings, cosine similarity — ALL UNCHANGED ----
  private chunkHarFile(harFile: HarFile): { chunks: string[]; metadata: ChunkMetadata[] } {
    const chunks: string[] = [];
    const metadata: ChunkMetadata[] = [];

    harFile.log.entries.forEach((entry, index) => {
      let domain = '';
      try { domain = new URL(entry.request.url).hostname; } catch { domain = 'unknown'; }

      const mimeType = entry.response.content.mimeType;
      let resourceType = 'other';
      if (mimeType.includes('javascript')) resourceType = 'script';
      else if (mimeType.includes('css')) resourceType = 'stylesheet';
      else if (mimeType.includes('image')) resourceType = 'image';
      else if (mimeType.includes('json')) resourceType = 'api';
      else if (mimeType.includes('html')) resourceType = 'document';

      chunks.push(`
Request #${index + 1}
URL: ${entry.request.url}
Method: ${entry.request.method}
Status: ${entry.response.status} ${entry.response.statusText}
Domain: ${domain}
Type: ${resourceType}
Size: ${entry.response.bodySize} bytes
Total Time: ${entry.time}ms
Timing:
  DNS: ${entry.timings.dns || 0}ms
  Connect: ${entry.timings.connect || 0}ms
  SSL: ${entry.timings.ssl || 0}ms
  Send: ${entry.timings.send}ms
  Wait: ${entry.timings.wait}ms
  Receive: ${entry.timings.receive}ms
      `.trim());

      metadata.push({
        id: uuidv4(), entryIndex: index, url: entry.request.url,
        method: entry.request.method, status: entry.response.status,
        domain, resourceType, timestamp: entry.startedDateTime,
      });
    });

    return { chunks, metadata };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.isEmbedderReady) await this.initEmbedder();
    const output = await this.embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  async indexHarFile(harFile: HarFile, onProgress?: (current: number, total: number) => void): Promise<void> {
    this.harData = harFile;
    this.chunks = [];
    const { chunks, metadata } = this.chunkHarFile(harFile);
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await this.generateEmbedding(chunks[i]);
      this.chunks.push({ id: metadata[i].id, text: chunks[i], embedding, metadata: metadata[i] });
      if (onProgress) onProgress(i + 1, chunks.length);
    }
  }

  private async retrieveRelevantChunks(query: string, topK = 5) {
    if (this.chunks.length === 0) throw new Error('HAR file not indexed.');
    const queryEmbedding = await this.generateEmbedding(query);
    const similarities = this.chunks
      .map(chunk => ({ chunk, similarity: this.cosineSimilarity(queryEmbedding, chunk.embedding) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
    return {
      documents: similarities.map(s => s.chunk.text),
      metadata: similarities.map(s => s.chunk.metadata),
    };
  }

  private buildSystemPrompt(context: string): string {
    return `You are an expert network analyst analyzing HAR (HTTP Archive) files. Based on the following network request data, answer the user's question accurately and concisely.

Context (Relevant Network Requests):
${context}

Instructions:
- Provide specific, data-driven answers based on the context
- Include relevant URLs, status codes, and timing information
- If the question cannot be answered from the context, say so
- Be concise but thorough
- Format your response clearly with bullet points or paragraphs as appropriate`;
  }

  // ✅ UPDATED: Calls backend proxy, parses OpenAI SSE format
  async *analyzeWithQueryStream(query: string): AsyncGenerator<string, void, unknown> {
    if (!this.harData) throw new Error('No HAR file loaded');

    const { documents, metadata } = await this.retrieveRelevantChunks(query, 5);
    const context = documents.join('\n\n---\n\n');

    const response = await fetch(`${BACKEND_AI_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: this.buildSystemPrompt(context),
        messages: [{ role: 'user', content: query }],
      }),
    });

    if (!response.ok) throw new Error('Failed to get response from AI service');

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) throw new Error('Response body is not readable');

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6).trim(); // strip "data: "
          if (data === '[DONE]') return;
          try {
            const json = JSON.parse(data);
            // ✅ OpenAI SSE format (OCA) — NOT Ollama's json.response
            const content = json.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch { /* skip malformed lines */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async analyzeWithQuery(query: string): Promise<AnalysisResult> {
    if (!this.harData) throw new Error('No HAR file loaded');
    const { documents, metadata } = await this.retrieveRelevantChunks(query, 5);
    let answer = '';
    // Collect full stream
    for await (const chunk of this.analyzeWithQueryStream(query)) {
      answer += chunk;
    }
    return {
      answer,
      relevantEntries: metadata.map(m => this.harData!.log.entries[m.entryIndex]),
      sources: metadata,
    };
  }

  getSuggestedQueries(): string[] {
    return [
      'What are the slowest requests and why?',
      'Which domains are being contacted the most?',
      'Are there any failed requests (4xx or 5xx errors)?',
      'What is the total page load time and main bottlenecks?',
      'Which resources are largest and affecting performance?',
      'Are there any security concerns?',
      'What third-party services are being used?',
      'Are there any duplicate or redundant requests?',
      'What is the caching strategy?',
      'Which API calls are taking the longest?',
    ];
  }

  isIndexed(): boolean { return this.chunks.length > 0; }
  cleanup(): void { this.chunks = []; this.harData = null; }
}
