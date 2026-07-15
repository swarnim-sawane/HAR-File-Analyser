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
      { name: 'Operations', description: 'Runtime readiness, queue, storage, and optional dependency status.' },
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
      '/ready': path('get', {
        tags: ['Operations'],
        summary: 'Check runtime readiness',
        operationId: 'getReadiness',
        responses: {
          '200': jsonResponse('#/components/schemas/OpsStatusResponse'),
          '503': jsonResponse('#/components/schemas/OpsStatusResponse', 'Runtime is not ready'),
        },
      }),
      '/api/ops/status': path('get', {
        tags: ['Operations'],
        summary: 'Get color-coded operational status',
        operationId: 'getOpsStatus',
        responses: {
          '200': jsonResponse('#/components/schemas/OpsStatusResponse'),
          '503': jsonResponse('#/components/schemas/OpsStatusResponse', 'One or more core runtime checks failed'),
        },
      }),
      '/api/ops/ai-usage': path('get', {
        tags: ['Operations'],
        summary: 'Get aggregated OpenAI token usage and estimated cost',
        operationId: 'getAiUsage',
        parameters: [
          {
            name: 'from',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
            description: 'Inclusive range start. Defaults to 30 days before to.',
          },
          {
            name: 'to',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
            description: 'Inclusive range end. Defaults to the current time.',
          },
          {
            name: 'operation',
            in: 'query',
            schema: { type: 'string', enum: ['chat', 'insights', 'status_probe'] },
          },
          {
            name: 'model',
            in: 'query',
            schema: { type: 'string', maxLength: 200 },
          },
        ],
        responses: {
          '200': jsonResponse('#/components/schemas/AiUsageSummaryResponse'),
          '400': errorResponse,
          '500': errorResponse,
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
        OpsStatusResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'warning', 'error', 'unknown'] },
            color: { type: 'string', enum: ['green', 'amber', 'red', 'slate'] },
            timestamp: { type: 'string', format: 'date-time' },
            uptimeSeconds: { type: 'integer' },
            checks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  status: { type: 'string', enum: ['ok', 'warning', 'error', 'unknown'] },
                  color: { type: 'string', enum: ['green', 'amber', 'red', 'slate'] },
                  detail: { type: 'string' },
                  latencyMs: { type: 'number' },
                  affectsOverall: { type: 'boolean' },
                  data: { type: 'object' },
                },
              },
            },
            storage: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  path: { type: 'string' },
                  status: { type: 'string', enum: ['ok', 'warning', 'error', 'unknown'] },
                  color: { type: 'string', enum: ['green', 'amber', 'red', 'slate'] },
                  detail: { type: 'string' },
                  fileCount: { type: 'integer' },
                  sizeBytes: { type: 'integer' },
                  affectsOverall: { type: 'boolean' },
                },
              },
            },
            runtime: {
              type: 'object',
              properties: {
                nodeVersion: { type: 'string' },
                platform: { type: 'string' },
                pid: { type: 'integer' },
              },
            },
          },
        },
        AiUsageTotals: {
          type: 'object',
          properties: {
            requests: { type: 'integer' },
            completedRequests: { type: 'integer' },
            failedRequests: { type: 'integer' },
            usageCapturedRequests: { type: 'integer' },
            usageMissingRequests: { type: 'integer' },
            inputTokens: { type: 'integer' },
            cachedInputTokens: { type: 'integer' },
            outputTokens: { type: 'integer' },
            reasoningTokens: { type: 'integer' },
            totalTokens: { type: 'integer' },
            estimatedCostUsd: { type: 'number', format: 'double', nullable: true },
            costedRequests: { type: 'integer' },
            unpricedRequests: { type: 'integer' },
          },
        },
        AiUsageSummaryResponse: {
          type: 'object',
          properties: {
            provider: { type: 'string', enum: ['openai'] },
            generatedAt: { type: 'string', format: 'date-time' },
            range: {
              type: 'object',
              properties: {
                from: { type: 'string', format: 'date-time' },
                to: { type: 'string', format: 'date-time' },
              },
            },
            filters: {
              type: 'object',
              properties: {
                operation: { type: 'string', nullable: true },
                model: { type: 'string', nullable: true },
              },
            },
            totals: { $ref: '#/components/schemas/AiUsageTotals' },
            byModel: {
              type: 'array',
              items: {
                allOf: [
                  { $ref: '#/components/schemas/AiUsageTotals' },
                  {
                    type: 'object',
                    properties: { model: { type: 'string' } },
                  },
                ],
              },
            },
            byOperation: {
              type: 'array',
              items: {
                allOf: [
                  { $ref: '#/components/schemas/AiUsageTotals' },
                  {
                    type: 'object',
                    properties: {
                      operation: { type: 'string', enum: ['chat', 'insights', 'status_probe'] },
                    },
                  },
                ],
              },
            },
            byDay: {
              type: 'array',
              items: {
                allOf: [
                  { $ref: '#/components/schemas/AiUsageTotals' },
                  {
                    type: 'object',
                    properties: { date: { type: 'string', format: 'date' } },
                  },
                ],
              },
            },
            pricing: {
              type: 'object',
              properties: {
                currency: { type: 'string', enum: ['USD'] },
                estimate: { type: 'boolean' },
                configured: { type: 'boolean' },
                currentRatesPerMillionTokens: {
                  type: 'object',
                  nullable: true,
                  additionalProperties: true,
                },
                note: { type: 'string' },
              },
            },
            privacy: {
              type: 'object',
              properties: {
                promptsStored: { type: 'boolean', enum: [false] },
                responsesStored: { type: 'boolean', enum: [false] },
                apiKeysStored: { type: 'boolean', enum: [false] },
              },
            },
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
            source: { type: 'string', enum: ['openai', 'deterministic_fallback'] },
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
        --bg: #f4f6f9;
        --panel: #ffffff;
        --panel-soft: #f9fafc;
        --text: #111827;
        --muted: #5f6b7a;
        --subtle: #7a8493;
        --line: #d8dee8;
        --line-strong: #bcc7d6;
        --code-bg: #eef2f7;
        --accent: #1f5fbf;
        --accent-soft: #e8f1ff;
        --accent-strong: #174ea6;
        --ok: #0b7a53;
        --ok-soft: #e5f6ee;
        --warn: #a25b00;
        --warn-soft: #fff4df;
        --danger: #b42318;
        --danger-soft: #ffe8e5;
        --ink: #0b1220;
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: Arial, Helvetica, sans-serif;
        line-height: 1.5;
      }
      a {
        color: var(--accent);
        text-decoration-thickness: 0.08em;
        text-underline-offset: 0.16em;
      }
      code {
        background: var(--code-bg);
        padding: 0.12rem 0.32rem;
        border-radius: 5px;
        font-size: 0.92em;
      }
      pre {
        margin: 0.85rem 0 0;
        padding: 1rem;
        overflow: auto;
        border: 1px solid #202a3a;
        border-radius: 8px;
        background: #0d1420;
        color: #f4f7fb;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
      }
      pre code {
        background: transparent;
        color: inherit;
        padding: 0;
      }
      .page {
        max-width: 1280px;
        margin: 0 auto;
        padding: 2rem 1.5rem 4rem;
      }
      .hero {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 12px;
        background:
          linear-gradient(135deg, rgba(31, 95, 191, 0.12), rgba(11, 122, 83, 0.08)),
          var(--panel);
        padding: 2rem;
        margin-bottom: 1.25rem;
      }
      .hero:after {
        content: "";
        position: absolute;
        inset: auto -2rem -5rem auto;
        width: 18rem;
        height: 18rem;
        border: 1px solid rgba(31, 95, 191, 0.14);
        border-radius: 50%;
      }
      .hero-content {
        position: relative;
        z-index: 1;
        max-width: 920px;
      }
      .eyebrow {
        margin: 0 0 0.65rem;
        color: var(--accent-strong);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 0.5rem;
        font-size: 2.55rem;
        line-height: 1.1;
        letter-spacing: 0;
      }
      h2 {
        margin: 0 0 0.85rem;
        font-size: 1.45rem;
        letter-spacing: 0;
      }
      h3 {
        margin: 1rem 0 0.45rem;
        font-size: 1.05rem;
        letter-spacing: 0;
      }
      p { margin: 0 0 0.9rem; }
      .lead {
        color: var(--muted);
        font-size: 1.08rem;
        max-width: 900px;
      }
      .hero-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 1.2rem;
      }
      .button-link {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        min-height: 2.45rem;
        padding: 0.56rem 0.78rem;
        border: 1px solid var(--line-strong);
        border-radius: 7px;
        background: var(--panel);
        color: var(--text);
        font-weight: 700;
        text-decoration: none;
      }
      .button-link.primary {
        border-color: var(--accent);
        background: var(--accent);
        color: #fff;
      }
      .hero-metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.8rem;
        margin-top: 1.5rem;
      }
      .metric {
        border: 1px solid rgba(31, 95, 191, 0.16);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.74);
        padding: 0.85rem;
      }
      .metric span {
        display: block;
        color: var(--subtle);
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
      }
      .metric strong {
        display: block;
        margin-top: 0.2rem;
        font-size: 1rem;
      }
      .layout {
        display: grid;
        grid-template-columns: 250px minmax(0, 1fr);
        gap: 1.25rem;
        align-items: start;
      }
      .toc {
        position: sticky;
        top: 1rem;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--panel);
        padding: 1rem;
      }
      .toc-title {
        margin: 0 0 0.6rem;
        color: var(--muted);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .toc a {
        display: block;
        padding: 0.45rem 0.5rem;
        border-radius: 6px;
        color: var(--text);
        font-size: 0.92rem;
        text-decoration: none;
      }
      .toc a:hover {
        background: var(--accent-soft);
        color: var(--accent-strong);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
      }
      .grid.three {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 1.35rem;
        margin: 0 0 1rem;
      }
      .full {
        grid-column: 1 / -1;
      }
      .callout {
        border-left: 4px solid var(--accent);
        background: var(--panel-soft);
      }
      .section-label {
        margin: 0 0 0.35rem;
        color: var(--accent-strong);
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
      }
      .flow {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 0.75rem;
        margin-top: 1rem;
      }
      .flow-step {
        position: relative;
        min-height: 8.5rem;
        border: 1px solid var(--line);
        border-radius: 9px;
        background: var(--panel-soft);
        padding: 0.9rem;
      }
      .flow-step:not(:last-child):after {
        content: "";
        position: absolute;
        top: 50%;
        right: -0.75rem;
        width: 0.75rem;
        border-top: 2px solid var(--line-strong);
      }
      .flow-step span {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 50%;
        background: var(--accent);
        color: #fff;
        font-size: 0.85rem;
        font-weight: 700;
      }
      .flow-step strong {
        display: block;
        margin-top: 0.65rem;
      }
      .flow-step p {
        margin: 0.3rem 0 0;
        color: var(--muted);
        font-size: 0.9rem;
      }
      .capability {
        min-height: 9.25rem;
      }
      .capability strong {
        display: block;
        margin-bottom: 0.35rem;
      }
      .capability p {
        color: var(--muted);
        font-size: 0.94rem;
      }
      .endpoint {
        display: grid;
        grid-template-columns: 4.7rem 1fr;
        gap: 0.75rem;
        align-items: start;
        padding: 0.85rem 0;
        border-top: 1px solid var(--line);
      }
      .endpoint:first-of-type {
        border-top: 0;
      }
      .method {
        display: inline-block;
        min-width: 3.6rem;
        padding: 0.22rem 0.35rem;
        border-radius: 5px;
        background: var(--accent-soft);
        color: var(--accent-strong);
        font-weight: 700;
        text-align: center;
        font-size: 0.82rem;
      }
      .note {
        color: var(--muted);
        font-size: 0.94rem;
      }
      .pill-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin: 0.7rem 0 0;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        min-height: 1.8rem;
        padding: 0.24rem 0.55rem;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--panel-soft);
        color: var(--muted);
        font-size: 0.84rem;
        font-weight: 700;
      }
      .status {
        display: inline-block;
        margin-right: 0.45rem;
        font-weight: 700;
      }
      .status.ok { color: var(--ok); }
      .status.warn { color: var(--warn); }
      .status.danger { color: var(--danger); }
      .lifecycle {
        display: grid;
        gap: 0.75rem;
      }
      .lifecycle-item {
        display: grid;
        grid-template-columns: 6.8rem 1fr;
        gap: 0.7rem;
        align-items: start;
        padding: 0.8rem;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel-soft);
      }
      .badge {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        min-height: 1.8rem;
        border-radius: 999px;
        font-weight: 700;
        font-size: 0.82rem;
      }
      .badge.ok { background: var(--ok-soft); color: var(--ok); }
      .badge.warn { background: var(--warn-soft); color: var(--warn); }
      .badge.danger { background: var(--danger-soft); color: var(--danger); }
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
      .sample-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 1rem;
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
      .link-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
      }
      .link-list a {
        display: inline-flex;
        align-items: center;
        min-height: 2rem;
        padding: 0.32rem 0.55rem;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--panel-soft);
        text-decoration: none;
      }
      .copy-button {
        margin-top: 0.65rem;
        min-height: 2.1rem;
        padding: 0.38rem 0.62rem;
        border: 1px solid var(--line-strong);
        border-radius: 6px;
        background: var(--panel);
        color: var(--text);
        cursor: pointer;
        font-weight: 700;
      }
      .footer-note {
        color: var(--muted);
        font-size: 0.92rem;
      }
      @media (max-width: 1080px) {
        .layout { grid-template-columns: 1fr; }
        .toc { position: static; }
        .flow { grid-template-columns: 1fr; }
        .flow-step:not(:last-child):after { display: none; }
        .hero-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 760px) {
        .grid,
        .grid.three,
        .sample-grid,
        .hero-metrics {
          grid-template-columns: 1fr;
        }
        .page { padding: 1rem 0.85rem 3rem; }
        .hero { padding: 1.25rem; }
        h1 { font-size: 2rem; }
        input { min-width: 100%; }
        .endpoint { grid-template-columns: 1fr; }
        .lifecycle-item { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header class="hero">
        <div class="hero-content">
          <p class="eyebrow">Internal Integration Documentation</p>
          <h1>HAR File Analyzer API</h1>
          <p class="lead">
            Enterprise quick start for OCI automation, internal integration testing, and support diagnostics.
            Use this page to understand the workflow, API lifecycle, stable v1 endpoints, response shape,
            and operational guardrails. The full machine-readable OpenAPI 3.0 contract is available at
            <a href="${specUrl}"><code>${specUrl}</code></a>.
          </p>
          <div class="hero-actions">
            <a class="button-link primary" href="${specUrl}">Open OpenAPI JSON</a>
            <a class="button-link" href="#workflow">View Workflow</a>
            <a class="button-link" href="#smoke-test">Run Smoke Test</a>
          </div>
          <div class="hero-metrics" aria-label="API capabilities">
            <div class="metric"><span>Contract</span><strong>OpenAPI 3.0.3</strong></div>
            <div class="metric"><span>Automation</span><strong>Stable /api/v1 HAR endpoints</strong></div>
            <div class="metric"><span>Upload</span><strong>Chunked, large-file capable</strong></div>
            <div class="metric"><span>AI Resilience</span><strong>OpenAI with deterministic fallback</strong></div>
          </div>
        </div>
      </header>

      <div class="layout">
        <nav class="toc" aria-label="Documentation sections">
          <p class="toc-title">On this page</p>
          <a href="#overview">Overview</a>
          <a href="#workflow">Automation Workflow</a>
          <a href="#capabilities">API Capabilities</a>
          <a href="#services">Runtime Services</a>
          <a href="#lifecycle">Status Lifecycle</a>
          <a href="#endpoints">Stable HAR Endpoints</a>
          <a href="#examples">Request And Response Examples</a>
          <a href="#smoke-test">PowerShell Smoke Test</a>
          <a href="#links">Clickable Test Links</a>
          <a href="#operations">Operational Notes</a>
          <a href="#oci">OCI Integration Notes</a>
        </nav>

        <main>
          <section id="overview" class="panel callout">
            <p class="section-label">Overview</p>
            <h2>What This API Provides</h2>
            <p>
              The backend exposes REST endpoints for upload, HAR processing status, HAR diagnostics,
              console log diagnostics, sanitization, and AI-assisted analysis. OCI automation should use
              the stable <code>/api/v1</code> HAR endpoints for summary, failed-request triage,
              backend-built AI context, and one-call insight generation.
            </p>
            <div class="pill-row">
              <span class="pill">HAR upload</span>
              <span class="pill">Processing status</span>
              <span class="pill">4xx/5xx triage</span>
              <span class="pill">AI insights</span>
              <span class="pill">Console logs</span>
              <span class="pill">Sanitization</span>
            </div>
          </section>

          <section id="workflow" class="panel">
            <p class="section-label">Recommended Integration Flow</p>
            <h2>HAR Automation Workflow</h2>
            <p class="note">
              This is the recommended flow for tools, scripts, or OCI automation that need to analyze a HAR without using the browser UI.
            </p>
            <div class="flow" aria-label="HAR automation workflow">
              <div class="flow-step"><span>1</span><strong>Upload chunks</strong><p>Send file chunks to <code>/api/upload/chunk</code>.</p></div>
              <div class="flow-step"><span>2</span><strong>Complete upload</strong><p>Call <code>/api/upload/complete</code> to assemble and queue the file.</p></div>
              <div class="flow-step"><span>3</span><strong>Poll status</strong><p>Wait for <code>status: ready</code> before reading diagnostics.</p></div>
              <div class="flow-step"><span>4</span><strong>Read evidence</strong><p>Fetch summary, failed requests, and AI context from <code>/api/v1</code>.</p></div>
              <div class="flow-step"><span>5</span><strong>Generate insight</strong><p>Call <code>POST /api/v1/har/{fileId}/insights</code>.</p></div>
            </div>
          </section>

          <section id="capabilities" class="grid three">
            <div class="panel capability">
              <h2>Diagnostic Scope</h2>
              <strong>Network evidence, not raw JSON reading</strong>
              <p>Summaries prioritize status buckets, 4xx/5xx requests, slow requests, domains, methods, and timing metrics.</p>
            </div>
            <div class="panel capability">
              <h2>AI-Assisted Analysis</h2>
              <strong>Context built by backend</strong>
              <p>Automation clients do not need to recreate frontend logic. The backend builds bounded diagnostic context from stored entries.</p>
            </div>
            <div class="panel capability">
              <h2>Fallback Behavior</h2>
              <strong>Useful output when OpenAI is unavailable</strong>
              <p>If AI fails or returns unusable output, the API returns conservative deterministic findings instead of failing the whole workflow.</p>
            </div>
          </section>

          <section id="services" class="grid">
        <div class="panel">
              <h2>Deployed VM Services</h2>
              <p>
                Testers should use the deployed VM endpoints below. The backend API is the integration surface
                for OpenAPI and OCI automation; the worker runs as a background service after upload completion.
              </p>
              <table class="table">
                <thead>
                  <tr><th>Service</th><th>Access</th><th>Purpose</th></tr>
                </thead>
                <tbody>
              <tr><td>Frontend</td><td><code>http://10.65.39.163:3000</code></td><td>Browser UI for upload, Analyzer, AI Insights, Request Flow, Compare, and Console Logs.</td></tr>
              <tr><td>Backend</td><td><code>http://10.65.39.163:4000</code></td><td>REST/OpenAPI surface used by UI and automation.</td></tr>
              <tr><td>Worker</td><td>VM background service</td><td>Parses uploaded files into MongoDB after upload completion.</td></tr>
                </tbody>
              </table>
            </div>

            <div id="lifecycle" class="panel">
              <h2>Status Lifecycle</h2>
              <div class="lifecycle">
                <div class="lifecycle-item">
                  <span class="badge warn">202 Accepted</span>
                  <div>File exists but is still processing. Poll status and retry the automation endpoint.</div>
                </div>
                <div class="lifecycle-item">
                  <span class="badge ok">200 OK</span>
                  <div>File is ready and the endpoint returned diagnostic data.</div>
                </div>
                <div class="lifecycle-item">
                  <span class="badge danger">404 Not Found</span>
                  <div>The <code>fileId</code> is unknown to the backend or has been removed by cleanup.</div>
                </div>
              </div>
            </div>
          </section>

          <section id="endpoints" class="panel">
            <p class="section-label">Stable Automation Surface</p>
            <h2>HAR v1 Endpoints</h2>
            <p class="note">These endpoints are the preferred integration surface after upload and processing are complete.</p>

            <div class="endpoint">
              <span class="method">GET</span>
              <div>
                <code>/api/v1/har/{fileId}/summary</code>
                <div class="note">Compact diagnostic summary: request count, error count, status buckets, top domains, methods, and timing metrics.</div>
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
                <div class="note">Backend-built AI context that prioritizes 5xx, then 4xx, then slow requests and keeps prompt size bounded.</div>
              </div>
            </div>
            <div class="endpoint">
              <span class="method">POST</span>
              <div>
                <code>/api/v1/har/{fileId}/insights</code>
                <div class="note">One-call insight generation for a processed HAR. Returns OpenAI output when available, otherwise deterministic fallback findings.</div>
              </div>
            </div>
          </section>

          <section id="examples" class="panel">
            <p class="section-label">Examples</p>
            <h2>Request And Response Shape</h2>
            <div class="sample-grid">
              <div>
                <h3>Poll status</h3>
                <pre><code>GET /api/har/file_1779708244860_pgj5w9e3m/status</code></pre>
                <pre><code>{
  "fileId": "file_1779708244860_pgj5w9e3m",
  "status": "ready",
  "totalEntries": 8
}</code></pre>
              </div>
              <div>
                <h3>Generate insight</h3>
                <pre><code>POST /api/v1/har/file_1779708244860_pgj5w9e3m/insights</code></pre>
                <pre><code>{
  "fileId": "file_...",
  "sourceType": "har",
  "result": {
    "overallHealth": "warning",
    "summary": "Diagnostic summary",
    "sections": []
  },
  "ai": {
    "source": "openai"
  }
}</code></pre>
              </div>
            </div>
            <p class="note">
              If OpenAI is unavailable, <code>ai.source</code> can be <code>deterministic_fallback</code>.
              That means the API returned rule-based diagnostic findings instead of failing the request.
            </p>
          </section>

          <section id="smoke-test" class="panel">
            <p class="section-label">Validation</p>
            <h2>PowerShell Smoke Test</h2>
            <p class="note">Replace the sample value with a file ID from a fresh upload that has reached <code>status: ready</code>.</p>
            <pre id="smokeCode"><code>$baseUrl = "http://10.65.39.163:4000"
$fileId = "file_1779708244860_pgj5w9e3m"

Invoke-RestMethod "$baseUrl/api/har/$fileId/status"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/summary"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/errors"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/insights/context"
Invoke-RestMethod "$baseUrl/api/v1/har/$fileId/insights" -Method Post</code></pre>
            <button class="copy-button" type="button" data-copy-target="smokeCode">Copy smoke test</button>
          </section>

          <section id="links" class="panel">
            <p class="section-label">Interactive Links</p>
            <h2>Clickable V1 Links</h2>
            <p class="note">Paste a processed HAR <code>fileId</code> to generate local test links.</p>
            <div class="toolbar">
              <input id="fileIdInput" value="file_1779708244860_pgj5w9e3m" aria-label="HAR file ID" />
              <div class="link-list">
                <a id="statusLink" href="#">status</a>
                <a id="summaryLink" href="#">summary</a>
                <a id="errorsLink" href="#">errors</a>
                <a id="contextLink" href="#">insights context</a>
              </div>
            </div>
          </section>

          <section id="operations" class="panel">
            <p class="section-label">Operational Readiness</p>
            <h2>Runtime And Data Handling Notes</h2>
            <table class="table">
              <thead>
                <tr><th>Area</th><th>Expectation</th><th>Why It Matters</th></tr>
              </thead>
              <tbody>
                <tr><td>Chunk size</td><td>Use 8 MB client-side chunks.</td><td>Keeps uploads below the server multipart limit.</td></tr>
                <tr><td>Worker</td><td>Keep the worker running with memory flags in deployed environments.</td><td>Uploads complete only after the worker parses files into MongoDB.</td></tr>
                <tr><td>Retention</td><td>Run cleanup in dry-run mode before deleting artifacts.</td><td>Large HAR files can consume disk quickly.</td></tr>
                <tr><td>AI dependency</td><td>Expect OpenAI output when available and fallback findings when unavailable.</td><td>Automation receives usable diagnostics even during AI outages.</td></tr>
              </tbody>
            </table>
          </section>

          <section id="oci" class="panel">
            <p class="section-label">OCI Integration</p>
            <h2>Integration Notes For OCI</h2>
            <ul>
              <li>Use <code>${specUrl}</code> as the OpenAPI import and discovery contract.</li>
              <li>Use <code>/api/v1</code> endpoints for stable automation responses.</li>
              <li>Use <code>POST /api/v1/har/{fileId}/insights</code> when AI output is required from an already processed HAR.</li>
              <li>Use <code>/api/ai/insights</code> directly only when the integration needs to supply its own context string.</li>
              <li>Confirm the deployment access model before exposing the API outside trusted internal networks.</li>
              <li>Validate expected file sizes, processing duration, queue depth, and disk retention values in the target OCI/CEL environment.</li>
            </ul>
            <p class="footer-note">
              This page is intentionally human-readable. Automation should import the machine-readable contract from
              <a href="${specUrl}"><code>${specUrl}</code></a>.
            </p>
          </section>
        </main>
      </div>
    </div>
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

      document.querySelectorAll('[data-copy-target]').forEach(function (button) {
        button.addEventListener('click', async function () {
          const target = document.getElementById(button.getAttribute('data-copy-target'));
          const text = target ? target.innerText : '';
          try {
            await navigator.clipboard.writeText(text);
            button.textContent = 'Copied';
            setTimeout(function () { button.textContent = 'Copy smoke test'; }, 1400);
          } catch {
            button.textContent = 'Copy unavailable';
            setTimeout(function () { button.textContent = 'Copy smoke test'; }, 1400);
          }
        });
      });
    </script>
  </body>
</html>`;
}
