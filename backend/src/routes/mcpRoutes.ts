import express, { NextFunction, Request, Response } from 'express';
import { getRedis } from '../config/database';
import { handleMcpJsonRpcMessage } from '../mcp/stdioServer';
import { SupportAnalyzerMcpClient, type McpWorkspaceStore } from '../mcp/supportAnalyzerClient';
import { SUPPORT_ANALYZER_MCP_TOOLS } from '../mcp/toolCatalog';
import type { McpJsonRpcRequest, McpJsonRpcResponse, McpWorkspace } from '../mcp/types';

const router = express.Router();
const WORKSPACE_KEY_PREFIX = 'support-analyzer:mcp:workspace:';
const WORKSPACE_TTL_SECONDS = Number.parseInt(process.env.MCP_WORKSPACE_TTL_SECONDS || '86400', 10);

const workspaceStore: McpWorkspaceStore = {
  async loadWorkspace(workspaceId: string) {
    const raw = await getRedis().get(`${WORKSPACE_KEY_PREFIX}${workspaceId}`);
    return raw ? JSON.parse(raw) as McpWorkspace : null;
  },
  async saveWorkspace(workspace: McpWorkspace) {
    await getRedis().setex(
      `${WORKSPACE_KEY_PREFIX}${workspace.workspaceId}`,
      Number.isFinite(WORKSPACE_TTL_SECONDS) ? WORKSPACE_TTL_SECONDS : 86400,
      JSON.stringify(workspace)
    );
  },
};

const remoteMcpClient = new SupportAnalyzerMcpClient({
  workspaceStore,
});

router.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'support-analyzer-workbench',
    transport: 'http-json-rpc',
    endpoint: '/mcp',
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: SUPPORT_ANALYZER_MCP_TOOLS.map((tool) => tool.name),
    },
    usage: {
      method: 'POST',
      contentType: 'application/json',
      example: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      },
    },
  });
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = req.body as McpJsonRpcRequest | McpJsonRpcRequest[];

    if (Array.isArray(payload)) {
      const responses = (await Promise.all(payload.map((request) => handleMcpJsonRpcMessage(request, remoteMcpClient))))
        .filter((response): response is McpJsonRpcResponse => response !== null);

      if (responses.length === 0) {
        res.status(204).send();
        return;
      }

      res.json(responses);
      return;
    }

    const response = await handleMcpJsonRpcMessage(payload, remoteMcpClient);
    if (!response) {
      res.status(204).send();
      return;
    }

    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
