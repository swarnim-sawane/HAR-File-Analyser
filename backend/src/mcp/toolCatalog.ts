export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
};

const workspaceId = {
  type: 'string',
  description: 'Workspace id returned by create_workspace.',
};

const evidenceId = {
  type: 'string',
  description: 'Evidence id returned by upload_evidence or list_evidence.',
};

export const SUPPORT_ANALYZER_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'create_workspace',
    description: 'Create a Support Analyzer diagnostic workspace backed by AI Diagnosis.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional SR, incident, or customer-facing title.' },
        cwd: { type: 'string', description: 'Optional Support Workbench workspace directory.' },
      },
    },
  },
  {
    name: 'upload_evidence',
    description: 'Upload support evidence such as HAR, logs, ZIP, PDF, DOCX, images, tables, configs, traces, dumps, or binaries. HAR/log files are also routed to deterministic visual analyzers when possible.',
    inputSchema: {
      type: 'object',
      required: ['workspaceId'],
      properties: {
        workspaceId,
        filePaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Developer/stdin mode only: absolute local file paths visible to the MCP server.',
        },
        files: {
          type: 'array',
          description: 'VCAP remote mode: inline files sent by the client.',
          items: {
            type: 'object',
            required: ['name', 'contentBase64'],
            properties: {
              name: { type: 'string', description: 'Original file name, including extension.' },
              contentBase64: { type: 'string', description: 'Base64-encoded file content.' },
              mediaType: { type: 'string', description: 'Optional MIME type from the client.' },
            },
          },
        },
      },
    },
  },
  {
    name: 'list_evidence',
    description: 'List files, reports, analyzer routing, and attachment ids in a diagnostic workspace.',
    inputSchema: {
      type: 'object',
      required: ['workspaceId'],
      properties: { workspaceId },
    },
  },
  {
    name: 'analyze_evidence',
    description: 'Return deterministic analyzer summaries for uploaded evidence, including HAR stats, log stats, and metadata-only fallback for unsupported files.',
    inputSchema: {
      type: 'object',
      required: ['workspaceId'],
      properties: {
        workspaceId,
        evidenceId,
      },
    },
  },
  {
    name: 'search_evidence',
    description: 'Search exact analyzer evidence. HAR files support status, method, domain, content type, and logs support text, severity, quick focus, and pagination.',
    inputSchema: {
      type: 'object',
      required: ['workspaceId', 'evidenceId'],
      properties: {
        workspaceId,
        evidenceId,
        query: { type: 'string' },
        status: { type: 'number' },
        method: { type: 'string' },
        domain: { type: 'string' },
        contentType: { type: 'string' },
        levels: { type: 'array', items: { type: 'string' } },
        quickFocus: { type: 'string' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'inspect_evidence',
    description: 'Fetch one exact request/log/detail row by analyzer index for citation-grade evidence.',
    inputSchema: {
      type: 'object',
      required: ['workspaceId', 'evidenceId'],
      properties: {
        workspaceId,
        evidenceId,
        index: { type: 'number', description: 'HAR request index or parsed log row index.' },
      },
    },
  },
  {
    name: 'ask_ai_diagnosis',
    description: 'Ask AI Diagnosis to reason over selected or all workspace evidence and return the final cited answer plus generated reports.',
    inputSchema: {
      type: 'object',
      required: ['workspaceId', 'prompt'],
      properties: {
        workspaceId,
        prompt: { type: 'string' },
        evidenceIds: { type: 'array', items: { type: 'string' } },
        waitForCompletionMs: { type: 'number' },
      },
    },
  },
  {
    name: 'generate_support_report',
    description: 'Generate a support-ready diagnosis report from uploaded evidence through AI Diagnosis.',
    inputSchema: {
      type: 'object',
      required: ['workspaceId'],
      properties: {
        workspaceId,
        evidenceId,
        prompt: { type: 'string' },
        waitForCompletionMs: { type: 'number' },
      },
    },
  },
  {
    name: 'open_in_workbench',
    description: 'Return a deep link to the Support Analyzer Workbench for visual inspection of the workspace, file, or selected finding.',
    inputSchema: {
      type: 'object',
      required: ['workspaceId'],
      properties: {
        workspaceId,
        evidenceId,
        mode: { type: 'string', enum: ['visual', 'ai'] },
      },
    },
  },
];
