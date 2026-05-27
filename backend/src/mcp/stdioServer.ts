import readline from 'readline';
import { SupportAnalyzerMcpClient } from './supportAnalyzerClient';
import { SUPPORT_ANALYZER_MCP_TOOLS } from './toolCatalog';
import type { McpJsonRpcRequest, McpJsonRpcResponse } from './types';

type ToolClient = Pick<
  SupportAnalyzerMcpClient,
  | 'createWorkspace'
  | 'uploadEvidence'
  | 'listEvidence'
  | 'analyzeEvidence'
  | 'searchEvidence'
  | 'inspectEvidence'
  | 'askAiDiagnosis'
  | 'generateSupportReport'
  | 'openInWorkbench'
>;

const TOOL_METHODS: Record<string, keyof ToolClient> = {
  create_workspace: 'createWorkspace',
  upload_evidence: 'uploadEvidence',
  list_evidence: 'listEvidence',
  analyze_evidence: 'analyzeEvidence',
  search_evidence: 'searchEvidence',
  inspect_evidence: 'inspectEvidence',
  ask_ai_diagnosis: 'askAiDiagnosis',
  generate_support_report: 'generateSupportReport',
  open_in_workbench: 'openInWorkbench',
};

export async function handleMcpJsonRpcMessage(
  request: McpJsonRpcRequest,
  client: ToolClient
): Promise<McpJsonRpcResponse | null> {
  if (request.method === 'notifications/initialized') {
    return null;
  }

  if (request.method === 'initialize') {
    return result(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'support-analyzer-workbench',
        version: '0.1.0',
      },
    });
  }

  if (request.method === 'tools/list') {
    return result(request.id, {
      tools: SUPPORT_ANALYZER_MCP_TOOLS,
    });
  }

  if (request.method === 'tools/call') {
    return callTool(request, client);
  }

  return error(request.id, -32601, `Unsupported MCP method: ${request.method}`);
}

export function startStdioMcpServer(client = new SupportAnalyzerMcpClient()): void {
  const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  input.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    void (async () => {
      let response: McpJsonRpcResponse | null;
      try {
        const request = JSON.parse(trimmed) as McpJsonRpcRequest;
        response = await handleMcpJsonRpcMessage(request, client);
      } catch (parseOrHandleError) {
        response = error(null, -32700, parseOrHandleError instanceof Error ? parseOrHandleError.message : String(parseOrHandleError));
      }

      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    })().catch((unhandledError) => {
      process.stderr.write(`Support Analyzer MCP server error: ${unhandledError instanceof Error ? unhandledError.stack : String(unhandledError)}\n`);
    });
  });
}

async function callTool(request: McpJsonRpcRequest, client: ToolClient): Promise<McpJsonRpcResponse> {
  const params = request.params ?? {};
  const toolName = typeof params.name === 'string' ? params.name : '';
  const args = isRecord(params.arguments) ? params.arguments : {};
  const methodName = TOOL_METHODS[toolName];

  if (!methodName) {
    return error(request.id, -32602, `Unknown tool: ${toolName}`);
  }

  try {
    const handler = client[methodName] as (input: Record<string, unknown>) => Promise<unknown> | unknown;
    const output = await handler.call(client, args);
    return result(request.id, {
      content: [{
        type: 'text',
        text: JSON.stringify(output, null, 2),
      }],
    });
  } catch (toolError) {
    return result(request.id, {
      isError: true,
      content: [{
        type: 'text',
        text: toolError instanceof Error ? toolError.message : String(toolError),
      }],
    });
  }
}

function result(id: McpJsonRpcRequest['id'], value: unknown): McpJsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result: value,
  };
}

function error(id: McpJsonRpcRequest['id'], code: number, message: string, data?: unknown): McpJsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
