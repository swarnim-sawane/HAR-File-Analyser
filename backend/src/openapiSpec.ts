type HttpMethod = 'get' | 'post';

interface OpenApiOperation {
  tags: string[];
  summary: string;
  operationId: string;
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}

export interface OpenApiDocument {
  openapi: '3.0.3';
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>;
  components: {
    schemas: Record<string, unknown>;
  };
}

const jsonResponse = (schemaRef: string, description = 'Successful response') => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const errorResponse = {
  description: 'Request failed',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
    },
  },
};

const fileIdParam = {
  name: 'fileId',
  in: 'path',
  required: true,
  description: 'Identifier returned by the upload or sanitize workflow.',
  schema: { type: 'string' },
};

const automationFileIdParam = {
  ...fileIdParam,
  description: 'Safe HAR file identifier returned by the upload or sanitize workflow.',
  schema: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
};

const indexParam = {
  name: 'index',
  in: 'path',
  required: true,
  description: 'Zero-based entry index.',
  schema: { type: 'integer', minimum: 0 },
};

const pageParam = {
  name: 'page',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1, default: 1 },
};

const limitParam = {
  name: 'limit',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1, default: 100 },
};

const automationLimitParam = {
  name: 'limit',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
};

const path = (
  method: HttpMethod,
  operation: OpenApiOperation
): Partial<Record<HttpMethod, OpenApiOperation>> => ({
  [method]: operation,
});

export function buildOpenApiDocument(serverUrl: string): OpenApiDocument {
  const normalizedServerUrl = serverUrl.replace(/\/+$/, '') || 'http://localhost:4000';

  return {
    openapi: '3.0.3',
    info: {
      title: 'HAR File Analyzer API',
      version: '1.0.0',
      description:
        'REST API contract for HAR File Analyzer automation, including upload, processing status, HAR review, console log review, sanitization, and AI-assisted diagnostics.',
    },
    servers: [{ url: normalizedServerUrl }],
    tags: [
      { name: 'Health', description: 'Service health and readiness.' },
      { name: 'Upload', description: 'Chunked file upload and progress tracking.' },
      { name: 'HAR', description: 'HAR retrieval, search, entry details, and statistics.' },
      { name: 'Automation', description: 'Stable v1 endpoints optimized for OCI automation flows.' },
      { name: 'Console Log', description: 'Console log retrieval, search, entry details, and statistics.' },
      { name: 'Sanitize', description: 'Sensitive data scan and redaction workflows.' },
      { name: 'AI', description: 'AI status, insights, and chat endpoints.' },
    ],
    paths: {
      '/health': path('get', {
        tags: ['Health'],
        summary: 'Check backend health',
        operationId: 'getHealth',
        responses: {
          '200': jsonResponse('#/components/schemas/HealthResponse'),
        },
      }),
      '/api/upload/chunk': path('post', {
        tags: ['Upload'],
        summary: 'Upload one file chunk',
        operationId: 'uploadFileChunk',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['chunk', 'fileId', 'chunkIndex', 'totalChunks'],
                properties: {
                  chunk: { type: 'string', format: 'binary' },
                  fileId: { type: 'string' },
                  chunkIndex: { type: 'integer', minimum: 0 },
                  totalChunks: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
        },
        responses: {
          '200': jsonResponse('#/components/schemas/ChunkUploadResponse'),
          '400': errorResponse,
          '413': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/upload/complete': path('post', {
        tags: ['Upload'],
        summary: 'Assemble uploaded chunks and enqueue processing',
        operationId: 'completeUpload',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CompleteUploadRequest' },
            },
          },
        },
        responses: {
          '200': jsonResponse('#/components/schemas/UploadCompleteResponse'),
          '400': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/upload/progress/{fileId}': path('get', {
        tags: ['Upload'],
        summary: 'Get upload progress',
        operationId: 'getUploadProgress',
        parameters: [fileIdParam],
        responses: {
          '200': jsonResponse('#/components/schemas/UploadProgressResponse'),
          '500': errorResponse,
        },
      }),
      '/api/har/{fileId}': path('get', {
        tags: ['HAR'],
        summary: 'Stream the full HAR JSON payload',
        operationId: 'getHarData',
        parameters: [fileIdParam],
        responses: {
          '200': {
            description: 'Full HAR file JSON.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/har/{fileId}/status': path('get', {
        tags: ['HAR'],
        summary: 'Get HAR processing status',
        operationId: 'getHarStatus',
        parameters: [fileIdParam],
        responses: {
          '200': jsonResponse('#/components/schemas/FileStatusResponse'),
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/har/{fileId}/entries': path('get', {
        tags: ['HAR'],
        summary: 'List paginated HAR entries',
        operationId: 'listHarEntries',
        parameters: [fileIdParam, pageParam, limitParam],
        responses: {
          '200': jsonResponse('#/components/schemas/PaginatedEntriesResponse'),
          '500': errorResponse,
        },
      }),
      '/api/har/{fileId}/entries/{index}': path('get', {
        tags: ['HAR'],
        summary: 'Get one HAR entry by index',
        operationId: 'getHarEntry',
        parameters: [fileIdParam, indexParam],
        responses: {
          '200': { description: 'HAR entry JSON.', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/har/{fileId}/stats': path('get', {
        tags: ['HAR'],
        summary: 'Get HAR file statistics',
        operationId: 'getHarStats',
        parameters: [fileIdParam],
        responses: {
          '200': { description: 'HAR statistics JSON.', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/har/{fileId}/search': path('get', {
        tags: ['HAR'],
        summary: 'Search or filter HAR entries',
        operationId: 'searchHarEntries',
        parameters: [
          fileIdParam,
          pageParam,
          limitParam,
          { name: 'method', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'integer' } },
          { name: 'domain', in: 'query', schema: { type: 'string' } },
          { name: 'contentType', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': jsonResponse('#/components/schemas/PaginatedEntriesResponse'),
          '500': errorResponse,
        },
      }),
      '/api/v1/har/{fileId}/summary': path('get', {
        tags: ['Automation'],
        summary: 'Get an automation-ready HAR diagnostic summary',
        operationId: 'getHarAutomationSummary',
        parameters: [automationFileIdParam],
        responses: {
          '200': jsonResponse('#/components/schemas/AutomationHarSummaryResponse'),
          '202': jsonResponse('#/components/schemas/AutomationHarPendingResponse', 'File is still processing'),
          '400': errorResponse,
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/v1/har/{fileId}/errors': path('get', {
        tags: ['Automation'],
        summary: 'List failed HAR requests for automation triage',
        operationId: 'listHarAutomationErrors',
        parameters: [automationFileIdParam, pageParam, automationLimitParam],
        responses: {
          '200': jsonResponse('#/components/schemas/AutomationHarErrorListResponse'),
          '202': jsonResponse('#/components/schemas/AutomationHarPendingResponse', 'File is still processing'),
          '400': errorResponse,
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/v1/har/{fileId}/insights/context': path('get', {
        tags: ['Automation'],
        summary: 'Build backend-owned HAR context for AI insight generation',
        operationId: 'getHarAutomationInsightContext',
        parameters: [automationFileIdParam],
        responses: {
          '200': jsonResponse('#/components/schemas/AutomationHarInsightContextResponse'),
          '202': jsonResponse('#/components/schemas/AutomationHarPendingResponse', 'File is still processing'),
          '400': errorResponse,
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/v1/har/{fileId}/insights': path('post', {
        tags: ['Automation'],
        summary: 'Generate AI insights for a processed HAR file',
        operationId: 'generateHarAutomationInsights',
        parameters: [automationFileIdParam],
        responses: {
          '200': jsonResponse('#/components/schemas/AutomationHarInsightsResponse'),
          '202': jsonResponse('#/components/schemas/AutomationHarPendingResponse', 'File is still processing'),
          '400': errorResponse,
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/sanitize/{fileId}/scan': path('get', {
        tags: ['Sanitize'],
        summary: 'Scan a HAR for sensitive fields',
        operationId: 'scanHarForSensitiveData',
        parameters: [fileIdParam],
        responses: {
          '200': jsonResponse('#/components/schemas/SanitizeScanResponse'),
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/sanitize/{fileId}': path('post', {
        tags: ['Sanitize'],
        summary: 'Create a sanitized HAR and enqueue processing',
        operationId: 'sanitizeHar',
        parameters: [fileIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SanitizeRequest' },
            },
          },
        },
        responses: {
          '200': jsonResponse('#/components/schemas/SanitizeResponse'),
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/console-log/{fileId}/status': path('get', {
        tags: ['Console Log'],
        summary: 'Get console log processing status',
        operationId: 'getConsoleLogStatus',
        parameters: [fileIdParam],
        responses: {
          '200': jsonResponse('#/components/schemas/FileStatusResponse'),
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/console-log/{fileId}/entries': path('get', {
        tags: ['Console Log'],
        summary: 'List paginated console log entries',
        operationId: 'listConsoleLogEntries',
        parameters: [
          fileIdParam,
          pageParam,
          limitParam,
          { name: 'levels', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'quickFocus', in: 'query', schema: { type: 'string' } },
          { name: 'startTime', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'endTime', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'sortBy', in: 'query', schema: { type: 'string' } },
          { name: 'sortDir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
        ],
        responses: {
          '200': jsonResponse('#/components/schemas/PaginatedEntriesResponse'),
          '500': errorResponse,
        },
      }),
      '/api/console-log/{fileId}/entries/{index}': path('get', {
        tags: ['Console Log'],
        summary: 'Get one console log entry by index',
        operationId: 'getConsoleLogEntry',
        parameters: [fileIdParam, indexParam],
        responses: {
          '200': { description: 'Console log entry JSON.', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/console-log/{fileId}/stats': path('get', {
        tags: ['Console Log'],
        summary: 'Get console log statistics',
        operationId: 'getConsoleLogStats',
        parameters: [fileIdParam],
        responses: {
          '200': { description: 'Console log statistics JSON.', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': errorResponse,
          '500': errorResponse,
        },
      }),
      '/api/console-log/{fileId}/search': path('get', {
        tags: ['Console Log'],
        summary: 'Search console log entries',
        operationId: 'searchConsoleLogEntries',
        parameters: [
          fileIdParam,
          pageParam,
          limitParam,
          { name: 'level', in: 'query', schema: { type: 'string' } },
          { name: 'source', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': jsonResponse('#/components/schemas/PaginatedEntriesResponse'),
          '500': errorResponse,
        },
      }),
      '/api/ai/status': path('get', {
        tags: ['AI'],
        summary: 'Check AI backend connectivity',
        operationId: 'getAiStatus',
        responses: {
          '200': jsonResponse('#/components/schemas/AiStatusResponse'),
        },
      }),
      '/api/ai/insights': path('post', {
        tags: ['AI'],
        summary: 'Generate AI diagnostic insights from prepared context',
        operationId: 'generateAiInsights',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AiInsightsRequest' },
            },
          },
        },
        responses: {
          '200': jsonResponse('#/components/schemas/AiInsightsResponse'),
          '400': errorResponse,
          '502': errorResponse,
          '503': errorResponse,
        },
      }),
      '/api/ai/chat': path('post', {
        tags: ['AI'],
        summary: 'Stream AI chat completion for diagnostic follow-up',
        operationId: 'chatWithAi',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AiChatRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Server-sent event stream from the AI backend.',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
          '400': errorResponse,
          '500': errorResponse,
        },
      }),
    },
    components: {
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'string' },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            timestamp: { type: 'string', format: 'date-time' },
            services: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
        ChunkUploadResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            fileId: { type: 'string' },
            chunkIndex: { type: 'integer' },
            receivedChunks: { type: 'integer' },
            totalChunks: { type: 'integer' },
            progress: { type: 'number' },
          },
        },
        CompleteUploadRequest: {
          type: 'object',
          required: ['fileId', 'totalChunks', 'fileName', 'fileType'],
          properties: {
            fileId: { type: 'string' },
            totalChunks: { type: 'integer', minimum: 1 },
            fileName: { type: 'string' },
            fileType: { type: 'string', enum: ['har', 'log'] },
            compressed: { type: 'string', enum: ['gzip'] },
          },
        },
        UploadCompleteResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            fileId: { type: 'string' },
            jobId: { type: 'string' },
            fileName: { type: 'string' },
            fileSize: { type: 'number' },
            hash: { type: 'string' },
            message: { type: 'string' },
          },
        },
        UploadProgressResponse: {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            progress: { type: 'number' },
          },
        },
        FileStatusResponse: {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            fileName: { type: 'string' },
            status: { type: 'string' },
            totalEntries: { type: 'integer', nullable: true },
            uploadedAt: { type: 'string', nullable: true },
            processedAt: { type: 'string', nullable: true },
          },
        },
        PaginatedEntriesResponse: {
          type: 'object',
          properties: {
            entries: { type: 'array', items: { type: 'object' } },
            pagination: { $ref: '#/components/schemas/Pagination' },
            facets: { type: 'object' },
          },
        },
        AutomationHarSummaryResponse: {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            fileName: { type: 'string', nullable: true },
            status: { type: 'string' },
            uploadedAt: { type: 'string', nullable: true },
            processedAt: { type: 'string', nullable: true },
            summary: {
              type: 'object',
              properties: {
                totalRequests: { type: 'integer' },
                totalEntries: { type: 'integer' },
                errors: { type: 'integer' },
                errorRate: { type: 'number' },
                statusBuckets: {
                  type: 'object',
                  properties: {
                    '0': { type: 'integer' },
                    '1xx': { type: 'integer' },
                    '2xx': { type: 'integer' },
                    '3xx': { type: 'integer' },
                    '4xx': { type: 'integer' },
                    '5xx': { type: 'integer' },
                  },
                },
                topDomains: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      domain: { type: 'string' },
                      count: { type: 'integer' },
                    },
                  },
                },
                topMethods: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      method: { type: 'string' },
                      count: { type: 'integer' },
                    },
                  },
                },
                averageTime: { type: 'number' },
                maxTime: { type: 'number' },
                totalSize: { type: 'number' },
              },
            },
          },
        },
        AutomationHarPendingResponse: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'File is not ready for automation analysis yet' },
            message: { type: 'string' },
            fileId: { type: 'string' },
            fileName: { type: 'string', nullable: true },
            status: { type: 'string', example: 'processing' },
            totalEntries: { type: 'integer', nullable: true },
            uploadedAt: { type: 'string', nullable: true },
            processedAt: { type: 'string', nullable: true },
          },
        },
        AutomationHarErrorListResponse: {
          type: 'object',
          properties: {
            entries: {
              type: 'array',
              items: { $ref: '#/components/schemas/AutomationHarErrorEntry' },
            },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        },
        AutomationHarErrorEntry: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            startedDateTime: { type: 'string', format: 'date-time' },
            method: { type: 'string', nullable: true },
            url: { type: 'string', nullable: true },
            status: { type: 'integer' },
            statusText: { type: 'string' },
            time: { type: 'number' },
            mimeType: { type: 'string', nullable: true },
            serverIPAddress: { type: 'string', nullable: true },
          },
        },
        AutomationHarInsightContextResponse: {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            fileName: { type: 'string', nullable: true },
            sourceType: { type: 'string', enum: ['har'] },
            context: { type: 'string' },
            entrySampleCount: { type: 'integer' },
          },
        },
        AutomationHarInsightsResponse: {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            fileName: { type: 'string', nullable: true },
            sourceType: { type: 'string', enum: ['har'] },
            entrySampleCount: { type: 'integer' },
            result: { $ref: '#/components/schemas/AiInsightsResult' },
            ai: { $ref: '#/components/schemas/AiExecutionMetadata' },
          },
        },
        AiExecutionMetadata: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['oca', 'deterministic_fallback'] },
            fallbackReason: { type: 'string' },
          },
        },
        AiInsightsResult: {
          type: 'object',
          properties: {
            overallHealth: { type: 'string', enum: ['critical', 'degraded', 'warning', 'healthy'] },
            summary: { type: 'string' },
            sections: {
              type: 'array',
              items: { type: 'object' },
            },
            detectedProducts: {
              type: 'array',
              items: { type: 'object' },
            },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            currentPage: { type: 'integer' },
            totalPages: { type: 'integer' },
            totalEntries: { type: 'integer' },
            hasMore: { type: 'boolean' },
            limit: { type: 'integer' },
          },
        },
        SanitizeScanResponse: {
          type: 'object',
          properties: {
            info: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
            sensitiveCount: { type: 'integer' },
          },
        },
        SanitizeRequest: {
          type: 'object',
          required: ['mode'],
          properties: {
            mode: { type: 'string', enum: ['auto', 'custom'] },
            scrubWords: { type: 'array', items: { type: 'string' } },
            scrubMimetypes: { type: 'array', items: { type: 'string' } },
            scrubDomains: { type: 'array', items: { type: 'string' } },
          },
        },
        SanitizeResponse: {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            jobId: { type: 'string' },
          },
        },
        AiStatusResponse: {
          type: 'object',
          properties: {
            connected: { type: 'boolean' },
            model: { type: 'string', nullable: true },
          },
        },
        AiInsightsRequest: {
          type: 'object',
          required: ['context'],
          properties: {
            context: { type: 'string' },
            sourceType: { type: 'string', enum: ['har', 'console'] },
          },
        },
        AiInsightsResponse: {
          type: 'object',
          properties: {
            result: { $ref: '#/components/schemas/AiInsightsResult' },
            ai: { $ref: '#/components/schemas/AiExecutionMetadata' },
          },
        },
        AiChatRequest: {
          type: 'object',
          required: ['messages'],
          properties: {
            messages: {
              type: 'array',
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
            systemPrompt: { type: 'string' },
          },
        },
      },
    },
  };
}

export function renderOpenApiDocsHtml(specUrl = '/openapi.json'): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HAR File Analyzer API</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7fb;
        --panel: #ffffff;
        --text: #172033;
        --muted: #5d6678;
        --line: #d9e0ea;
        --code-bg: #eef2f7;
        --accent: #2558d4;
        --ok: #0f7b4f;
        --warn: #a45b00;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: Arial, sans-serif;
        line-height: 1.5;
      }
      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 2.5rem 1.5rem 4rem;
      }
      header {
        margin-bottom: 1.5rem;
      }
      h1 {
        margin: 0 0 0.5rem;
        font-size: 2.2rem;
        line-height: 1.1;
      }
      h2 {
        margin: 0 0 0.85rem;
        font-size: 1.35rem;
      }
      h3 {
        margin: 1.1rem 0 0.45rem;
        font-size: 1.05rem;
      }
      p {
        margin: 0 0 0.9rem;
      }
      a { color: var(--accent); }
      code {
        background: var(--code-bg);
        padding: 0.12rem 0.3rem;
        border-radius: 4px;
        font-size: 0.92em;
      }
      pre {
        margin: 0.7rem 0 0;
        padding: 1rem;
        overflow: auto;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #101723;
        color: #f4f7fb;
      }
      pre code {
        background: transparent;
        color: inherit;
        padding: 0;
      }
      .lead {
        max-width: 860px;
        color: var(--muted);
        font-size: 1.05rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 1.25rem;
        margin: 1rem 0;
      }
      .full {
        grid-column: 1 / -1;
      }
      .endpoint {
        display: grid;
        grid-template-columns: 4.5rem 1fr;
        gap: 0.6rem;
        align-items: start;
        padding: 0.7rem 0;
        border-top: 1px solid var(--line);
      }
      .endpoint:first-of-type {
        border-top: 0;
      }
      .method {
        display: inline-block;
        min-width: 3.4rem;
        padding: 0.18rem 0.35rem;
        border-radius: 4px;
        background: #e8f2ff;
        color: #174ea6;
        font-weight: 700;
        text-align: center;
        font-size: 0.82rem;
      }
      .note {
        color: var(--muted);
        font-size: 0.94rem;
      }
      .status {
        display: inline-block;
        margin-right: 0.45rem;
        font-weight: 700;
      }
      .status.ok { color: var(--ok); }
      .status.warn { color: var(--warn); }
      .table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 0.5rem;
      }
      .table th,
      .table td {
        border-top: 1px solid var(--line);
        padding: 0.6rem 0.5rem;
        text-align: left;
        vertical-align: top;
      }
      .table th {
        color: var(--muted);
        font-size: 0.88rem;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
      }
      input {
        min-width: 22rem;
        max-width: 100%;
        padding: 0.55rem 0.65rem;
        border: 1px solid var(--line);
        border-radius: 6px;
        font: inherit;
      }
      @media (max-width: 760px) {
        .grid { grid-template-columns: 1fr; }
        main { padding: 1.5rem 1rem 3rem; }
        input { min-width: 100%; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>HAR File Analyzer API</h1>
        <p class="lead">
          Human-readable quick start for OCI automation and internal integration testing.
          The full machine-readable OpenAPI 3.0 contract is available at
          <a href="${specUrl}"><code>${specUrl}</code></a>.
        </p>
      </header>

      <section class="panel">
        <h2>What This API Provides</h2>
        <p>
          The backend exposes REST endpoints for upload, HAR processing status, HAR diagnostics,
          console log diagnostics, sanitization, and AI-assisted analysis. OCI automation should use
          the stable <code>/api/v1</code> HAR endpoints for summary, failed-request triage, and
          backend-built AI context.
        </p>
      </section>

      <section class="grid">
        <div class="panel">
          <h2>Required Local Services</h2>
          <p>
            For local development, run <code>npm run dev:all</code> from the project root to start all
            three services together. The command is only a wrapper around the separate processes below.
          </p>
          <table class="table">
            <thead>
              <tr><th>Process</th><th>Command</th><th>Purpose</th></tr>
            </thead>
            <tbody>
              <tr><td>Frontend</td><td><code>npm run dev</code></td><td>Browser UI on port <code>3000</code>.</td></tr>
              <tr><td>Backend</td><td><code>npm run dev</code> from <code>backend</code></td><td>REST API on port <code>4000</code>.</td></tr>
              <tr><td>Worker</td><td><code>npm run dev:worker</code> from <code>backend</code></td><td>Parses uploaded files into MongoDB.</td></tr>
            </tbody>
          </table>
        </div>

        <div class="panel">
          <h2>Status Lifecycle</h2>
          <p><span class="status warn">202 Accepted</span> means the file exists but is still processing. Poll status and retry.</p>
          <p><span class="status ok">200 OK</span> means the file is ready and the endpoint returned diagnostic data.</p>
          <p><code>404 File not found</code> means the <code>fileId</code> is unknown to the backend.</p>
        </div>
      </section>

      <section class="panel">
        <h2>HAR Automation Quick Start</h2>
        <ol>
          <li>Upload the HAR through the UI or with <code>POST /api/upload/chunk</code> and <code>POST /api/upload/complete</code>.</li>
          <li>Keep the worker running so the file is parsed into MongoDB.</li>
          <li>Poll <code>GET /api/har/{fileId}/status</code> until <code>status</code> is <code>ready</code>.</li>
          <li>Call the stable v1 endpoints below for automation output.</li>
        </ol>

        <div class="endpoint">
          <span class="method">GET</span>
          <div>
            <code>/api/v1/har/{fileId}/summary</code>
            <div class="note">Compact diagnostic summary: request count, errors, status buckets, top domains, and timing metrics.</div>
          </div>
        </div>
        <div class="endpoint">
          <span class="method">GET</span>
          <div>
            <code>/api/v1/har/{fileId}/errors</code>
            <div class="note">Paginated 4xx/5xx request list for support triage. Empty array is valid when the HAR has no HTTP errors.</div>
          </div>
        </div>
        <div class="endpoint">
          <span class="method">GET</span>
          <div>
            <code>/api/v1/har/{fileId}/insights/context</code>
            <div class="note">Backend-built AI context that prioritizes 5xx, then 4xx, then slow requests.</div>
          </div>
        </div>
        <div class="endpoint">
          <span class="method">POST</span>
          <div>
            <code>/api/v1/har/{fileId}/insights</code>
            <div class="note">One-call insight generation for a processed HAR. Returns OCA output when available, otherwise deterministic fallback findings.</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>PowerShell Smoke Test</h2>
        <p class="note">Replace the sample value with a file ID from a fresh upload that has reached <code>status: ready</code>.</p>
        <pre><code>$fileId = "file_1779708244860_pgj5w9e3m"

Invoke-RestMethod "http://localhost:4000/api/har/$fileId/status"
Invoke-RestMethod "http://localhost:4000/api/v1/har/$fileId/summary"
Invoke-RestMethod "http://localhost:4000/api/v1/har/$fileId/errors"
Invoke-RestMethod "http://localhost:4000/api/v1/har/$fileId/insights/context"
Invoke-RestMethod "http://localhost:4000/api/v1/har/$fileId/insights" -Method Post</code></pre>
      </section>

      <section class="panel">
        <h2>Clickable V1 Links</h2>
        <p class="note">Paste a processed HAR <code>fileId</code> to generate local test links.</p>
        <div class="toolbar">
          <input id="fileIdInput" value="file_1779708244860_pgj5w9e3m" aria-label="HAR file ID" />
          <a id="statusLink" href="#">status</a>
          <a id="summaryLink" href="#">summary</a>
          <a id="errorsLink" href="#">errors</a>
          <a id="contextLink" href="#">insights context</a>
        </div>
      </section>

      <section class="panel">
        <h2>Integration Notes For OCI</h2>
        <ul>
          <li>Use <code>${specUrl}</code> as the OpenAPI import/discovery contract.</li>
          <li>Use <code>/api/v1</code> endpoints for stable automation responses.</li>
          <li>Use <code>POST /api/v1/har/{fileId}/insights</code> when AI output is required from an already processed HAR.</li>
          <li>Use <code>/api/ai/insights</code> directly only when the integration needs to supply its own context string.</li>
          <li>Confirm the deployment access model before exposing the API outside trusted internal networks.</li>
        </ul>
      </section>
    </main>
    <script>
      const input = document.getElementById('fileIdInput');
      const links = {
        statusLink: '/api/har/{fileId}/status',
        summaryLink: '/api/v1/har/{fileId}/summary',
        errorsLink: '/api/v1/har/{fileId}/errors',
        contextLink: '/api/v1/har/{fileId}/insights/context',
      };

      function updateLinks() {
        const fileId = encodeURIComponent(input.value.trim() || '{fileId}');
        for (const [id, template] of Object.entries(links)) {
          document.getElementById(id).href = template.replace('{fileId}', fileId);
        }
      }

      input.addEventListener('input', updateLinks);
      updateLinks();
    </script>
  </body>
</html>`;
}
