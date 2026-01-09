// src/services/aiService.ts
import { pipeline, env } from '@xenova/transformers';
import { v4 as uuidv4 } from 'uuid';
import { HarFile, Entry } from '../types/har';

const OLLAMA_BASE_URL =
  import.meta.env.VITE_OLLAMA_URL || 'http://localhost:11435';
const OLLAMA_MODEL =
  import.meta.env.VITE_OLLAMA_MODEL || 'llama3.2';


// Disable local model loading, use CDN
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

  // Initialize the embedding model
  private async initEmbedder() {
    try {
      // Use a lightweight embedding model that runs in browser
      this.embedder = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2'
      );
      this.isEmbedderReady = true;
    } catch (error) {
      console.error('Failed to initialize embedder:', error);
      throw new Error('Failed to initialize AI model');
    }
  }

  // Check if Ollama is running
  async checkConnection(): Promise<{ ollama: boolean; model: string | null }> {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
  method: 'GET',
});

      if (!response.ok) {
        return { ollama: false, model: null };
      }

      const data = await response.json();
      const hasLlama = data.models?.some((m: any) => 
        m.name.includes('llama3.2') || m.name.includes('llama3')
      );

      return {
        ollama: true,
        model: hasLlama ? 'llama3.2' : null,
      };
    } catch (error) {
      return { ollama: false, model: null };
    }
  }

  // Chunk HAR file into semantic pieces
  private chunkHarFile(harFile: HarFile): { chunks: string[]; metadata: ChunkMetadata[] } {
    const chunks: string[] = [];
    const metadata: ChunkMetadata[] = [];

    harFile.log.entries.forEach((entry, index) => {
      let domain = '';
      try {
        domain = new URL(entry.request.url).hostname;
      } catch {
        domain = 'unknown';
      }

      const mimeType = entry.response.content.mimeType;
      let resourceType = 'other';
      if (mimeType.includes('javascript')) resourceType = 'script';
      else if (mimeType.includes('css')) resourceType = 'stylesheet';
      else if (mimeType.includes('image')) resourceType = 'image';
      else if (mimeType.includes('json')) resourceType = 'api';
      else if (mimeType.includes('html')) resourceType = 'document';

      const chunk = `
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
      `.trim();

      chunks.push(chunk);
      metadata.push({
        id: uuidv4(),
        entryIndex: index,
        url: entry.request.url,
        method: entry.request.method,
        status: entry.response.status,
        domain,
        resourceType,
        timestamp: entry.startedDateTime,
      });
    });

    return { chunks, metadata };
  }

  // Calculate cosine similarity
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Generate embedding for text
  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.isEmbedderReady) {
      await this.initEmbedder();
    }

    const output = await this.embedder(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(output.data);
  }

  // Index HAR file
  async indexHarFile(harFile: HarFile, onProgress?: (current: number, total: number) => void): Promise<void> {
    this.harData = harFile;
    this.chunks = [];

    const { chunks, metadata } = this.chunkHarFile(harFile);

    // Generate embeddings for all chunks
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await this.generateEmbedding(chunks[i]);
      
      this.chunks.push({
        id: metadata[i].id,
        text: chunks[i],
        embedding,
        metadata: metadata[i],
      });

      if (onProgress) {
        onProgress(i + 1, chunks.length);
      }
    }
  }

  // Retrieve relevant chunks using semantic search
  private async retrieveRelevantChunks(
    query: string,
    topK: number = 5
  ): Promise<{ documents: string[]; metadata: ChunkMetadata[] }> {
    if (this.chunks.length === 0) {
      throw new Error('HAR file not indexed. Please index first.');
    }

    // Generate embedding for query
    const queryEmbedding = await this.generateEmbedding(query);

    // Calculate similarities
    const similarities = this.chunks.map((chunk) => ({
      chunk,
      similarity: this.cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    // Sort by similarity and get top K
    similarities.sort((a, b) => b.similarity - a.similarity);
    const topChunks = similarities.slice(0, topK);

    return {
      documents: topChunks.map((item) => item.chunk.text),
      metadata: topChunks.map((item) => item.chunk.metadata),
    };
  }

  // Generate analysis using Ollama API
  async analyzeWithQuery(query: string): Promise<AnalysisResult> {
    if (!this.harData) {
      throw new Error('No HAR file loaded');
    }

    const { documents, metadata } = await this.retrieveRelevantChunks(query, 5);
    const context = documents.join('\n\n---\n\n');

    const prompt = `You are an expert network analyst analyzing HAR (HTTP Archive) files. Based on the following network request data, answer the user's question accurately and concisely.

Context (Relevant Network Requests):
${context}

User Question: ${query}

Instructions:
- Provide specific, data-driven answers based on the context
- Include relevant URLs, status codes, and timing information
- If the question cannot be answered from the context, say so
- Be concise but thorough
- Format your response clearly with bullet points or paragraphs as appropriate

Answer:`;

    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_predict: 500,
        },
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate response from Ollama');
    }

    const data = await response.json();
    const relevantEntries = metadata.map((m) => this.harData!.log.entries[m.entryIndex]);

    return {
      answer: data.response,
      relevantEntries,
      sources: metadata,
    };
  }

  // Generate streaming analysis
  async *analyzeWithQueryStream(query: string): AsyncGenerator<string, void, unknown> {
    if (!this.harData) {
      throw new Error('No HAR file loaded');
    }

    const { documents } = await this.retrieveRelevantChunks(query, 5);
    const context = documents.join('\n\n---\n\n');

    const prompt = `You are an expert network analyst analyzing HAR (HTTP Archive) files. Based on the following network request data, answer the user's question accurately and concisely.

Context (Relevant Network Requests):
${context}

User Question: ${query}

Instructions:
- Provide specific, data-driven answers based on the context
- Include relevant URLs, status codes, and timing information
- If the question cannot be answered from the context, say so
- Be concise but thorough
- Format your response clearly with bullet points or paragraphs as appropriate

Answer:`;

    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: true,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_predict: 500,
        },
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate response from Ollama');
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('Response body is not readable');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.response) {
              yield json.response;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Suggest common analysis queries
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

  // Get indexing status
  isIndexed(): boolean {
    return this.chunks.length > 0;
  }

  // Clean up
  cleanup(): void {
    this.chunks = [];
    this.harData = null;
  }
}
