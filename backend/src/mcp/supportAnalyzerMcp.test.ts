import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyEvidenceFile } from './fileClassifier';
import { SupportAnalyzerMcpClient } from './supportAnalyzerClient';
import { handleMcpJsonRpcMessage } from './stdioServer';
import { SUPPORT_ANALYZER_MCP_TOOLS } from './toolCatalog';

type FetchCall = {
  url: string;
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Support Analyzer MCP file classification', () => {
  it.each([
    ['capture.har', '{"log":{"entries":[]}}', 'har'],
    ['analysis.ocp', '{"log":{"entries":[]}}', 'har'],
    ['server.log', '2026-05-27 ERROR failed request', 'log'],
    ['incident.zip', 'PK\u0003\u0004', 'archive'],
    ['customer-notes.pdf', '%PDF-1.7', 'document'],
    ['customer-notes.docx', 'PK\u0003\u0004', 'document'],
    ['screenshot.png', '\u0089PNG', 'image'],
    ['payload.json', '{"hello":"world"}', 'structured'],
    ['table.csv', 'a,b\n1,2', 'table'],
    ['readme.txt', 'plain diagnostic notes', 'text'],
    ['installer.bin', '\u0000\u0001\u0002', 'binary'],
  ] as const)('classifies %s as %s', (fileName, sample, expectedKind) => {
    expect(classifyEvidenceFile(fileName, Buffer.from(sample)).analyzerKind).toBe(expectedKind);
  });
});

describe('Support Analyzer MCP tool catalog', () => {
  it('exposes broad support-evidence tools instead of HAR-only tools', () => {
    expect(SUPPORT_ANALYZER_MCP_TOOLS.map((tool) => tool.name)).toEqual([
      'create_workspace',
      'upload_evidence',
      'list_evidence',
      'analyze_evidence',
      'search_evidence',
      'inspect_evidence',
      'ask_ai_diagnosis',
      'generate_support_report',
      'open_in_workbench',
    ]);
    expect(SUPPORT_ANALYZER_MCP_TOOLS.find((tool) => tool.name === 'upload_evidence')?.description)
      .toMatch(/HAR, logs, ZIP, PDF, DOCX, images/i);
  });
});

describe('SupportAnalyzerMcpClient', () => {
  it('creates a workspace through Support Workbench and preserves the owner cookie', async () => {
    const calls: FetchCall[] = [];
    const client = new SupportAnalyzerMcpClient({
      harApiUrl: 'http://har.local',
      supportApiUrl: 'http://support.local',
      workbenchUiUrl: 'http://ui.local',
      fetch: fakeFetch(calls, {
        'POST http://support.local/api/session': {
          status: 201,
          headers: { 'set-cookie': 'support_workbench_client_id=owner-1; Path=/; HttpOnly' },
          body: {
            session: { id: 'support-session-1', cwd: '/work', status: 'idle' },
            snapshot: { sessionId: 'support-session-1', attachments: [], reports: { artifacts: [] } },
          },
        },
      }),
    });

    const workspace = await client.createWorkspace({ title: 'SR 123' });

    expect(workspace).toMatchObject({
      workspaceId: expect.stringMatching(/^mcp_ws_/),
      supportSessionId: 'support-session-1',
      title: 'SR 123',
    });
    expect(calls[0]).toMatchObject({
      url: 'http://support.local/api/session',
      method: 'POST',
    });
    expect(client.getWorkspace(workspace.workspaceId)?.supportCookie).toContain('support_workbench_client_id=owner-1');
  });

  it('uploads HAR evidence to Support Workbench and the visual analyzer backend', async () => {
    const dir = await makeTempDir();
    const harPath = path.join(dir, 'customer.har');
    await writeFile(harPath, '{"log":{"entries":[]}}');
    const calls: FetchCall[] = [];
    const client = new SupportAnalyzerMcpClient({
      harApiUrl: 'http://har.local',
      supportApiUrl: 'http://support.local',
      workbenchUiUrl: 'http://ui.local',
      fetch: fakeFetch(calls, {
        'POST http://support.local/api/session': {
          status: 201,
          headers: { 'set-cookie': 'support_workbench_client_id=owner-1; Path=/; HttpOnly' },
          body: {
            session: { id: 'support-session-1', cwd: '/work', status: 'idle' },
            snapshot: { sessionId: 'support-session-1', attachments: [], reports: { artifacts: [] } },
          },
        },
        'POST http://support.local/api/session/support-session-1/attachments': {
          status: 201,
          body: {
            attachments: [{ id: 'attachment-1', originalName: 'customer.har', size: 22 }],
            snapshot: { sessionId: 'support-session-1', attachments: [], reports: { artifacts: [] } },
          },
        },
        'POST http://har.local/api/upload/chunk': {
          status: 200,
          body: { success: true },
        },
        'POST http://har.local/api/upload/complete': {
          status: 200,
          body: {
            success: true,
            fileId: 'visual-file-1',
            jobId: 'job-1',
            fileName: 'customer.har',
            fileSize: 22,
            hash: 'hash-1',
            message: 'processing started',
          },
        },
      }),
    });
    const workspace = await client.createWorkspace({ title: 'SR 123' });

    const result = await client.uploadEvidence({
      workspaceId: workspace.workspaceId,
      filePaths: [harPath],
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      originalName: 'customer.har',
      analyzerKind: 'har',
      supportAttachmentId: 'attachment-1',
      visualFileId: 'visual-file-1',
      visualStatus: 'processing',
    });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST http://support.local/api/session',
      'POST http://support.local/api/session/support-session-1/attachments',
      'POST http://har.local/api/upload/chunk',
      'POST http://har.local/api/upload/complete',
    ]);
    expect(JSON.parse(String(calls.at(-1)?.body))).toMatchObject({
      fileName: 'customer.har',
      fileType: 'har',
    });
    expect(calls[1].headers?.cookie).toContain('support_workbench_client_id=owner-1');
  });

  it('uploads inline remote files and persists workspace state through the configured store', async () => {
    const calls: FetchCall[] = [];
    const persisted = new Map<string, unknown>();
    const workspaceStore = {
      async loadWorkspace(workspaceId: string) {
        return (persisted.get(workspaceId) ?? null) as never;
      },
      async saveWorkspace(workspace: unknown & { workspaceId: string }) {
        persisted.set(workspace.workspaceId, JSON.parse(JSON.stringify(workspace)));
      },
    };
    const fetchImpl = fakeFetch(calls, {
      'POST http://support.local/api/session': {
        status: 201,
        headers: { 'set-cookie': 'support_workbench_client_id=owner-1; Path=/; HttpOnly' },
        body: {
          session: { id: 'support-session-remote', cwd: '/work', status: 'idle' },
          snapshot: { sessionId: 'support-session-remote', attachments: [], reports: { artifacts: [] } },
        },
      },
      'POST http://support.local/api/session/support-session-remote/attachments': {
        status: 201,
        body: {
          attachments: [{ id: 'attachment-inline-1', originalName: 'remote.log', size: 35 }],
          snapshot: { sessionId: 'support-session-remote', attachments: [], reports: { artifacts: [] } },
        },
      },
      'POST http://har.local/api/upload/chunk': {
        status: 200,
        body: { success: true },
      },
      'POST http://har.local/api/upload/complete': {
        status: 200,
        body: {
          success: true,
          fileId: 'visual-log-1',
          jobId: 'job-log-1',
          fileName: 'remote.log',
          fileSize: 35,
          hash: 'hash-log-1',
          message: 'processing started',
        },
      },
      'GET http://support.local/api/session/support-session-remote': {
        status: 200,
        body: {
          snapshot: {
            sessionId: 'support-session-remote',
            status: 'idle',
            attachments: [{ id: 'attachment-inline-1', originalName: 'remote.log' }],
            reports: { artifacts: [] },
          },
        },
      },
    });
    const creator = new SupportAnalyzerMcpClient({
      harApiUrl: 'http://har.local',
      supportApiUrl: 'http://support.local',
      workbenchUiUrl: 'http://ui.local',
      fetch: fetchImpl,
      workspaceStore,
    });
    const workspace = await creator.createWorkspace({ title: 'Remote SR' });

    const uploaded = await creator.uploadEvidence({
      workspaceId: workspace.workspaceId,
      files: [{
        name: 'remote.log',
        contentBase64: Buffer.from('2026-05-27 ERROR remote upload failed').toString('base64'),
        mediaType: 'text/plain',
      }],
    });

    expect(uploaded.evidence[0]).toMatchObject({
      originalName: 'remote.log',
      analyzerKind: 'log',
      supportAttachmentId: 'attachment-inline-1',
      visualFileId: 'visual-log-1',
    });

    const reader = new SupportAnalyzerMcpClient({
      harApiUrl: 'http://har.local',
      supportApiUrl: 'http://support.local',
      workbenchUiUrl: 'http://ui.local',
      fetch: fetchImpl,
      workspaceStore,
    });

    await expect(reader.listEvidence({ workspaceId: workspace.workspaceId })).resolves.toMatchObject({
      workspace: {
        workspaceId: workspace.workspaceId,
        evidence: [expect.objectContaining({ originalName: 'remote.log' })],
      },
      supportSnapshot: {
        sessionId: 'support-session-remote',
      },
    });
  });

  it('searches and inspects visual evidence using deterministic analyzer APIs', async () => {
    const calls: FetchCall[] = [];
    const client = new SupportAnalyzerMcpClient({
      harApiUrl: 'http://har.local',
      supportApiUrl: 'http://support.local',
      workbenchUiUrl: 'http://ui.local',
      fetch: fakeFetch(calls, {
        'GET http://har.local/api/har/visual-file-1/search?status=500&page=1&limit=25': {
          status: 200,
          body: {
            entries: [{ request: { url: 'https://service.example/fail' }, response: { status: 500 } }],
            pagination: { totalEntries: 1 },
          },
        },
        'GET http://har.local/api/har/visual-file-1/entries/7': {
          status: 200,
          body: { request: { url: 'https://service.example/fail' }, response: { status: 500 } },
        },
      }),
    });
    client.seedWorkspace({
      workspaceId: 'mcp_ws_test',
      supportSessionId: 'support-session-1',
      title: 'SR 123',
      createdAt: '2026-05-27T00:00:00.000Z',
      evidence: [{
        id: 'evidence-1',
        originalName: 'customer.har',
        analyzerKind: 'har',
        displayKind: 'HAR',
        size: 22,
        mediaType: 'application/json',
        createdAt: '2026-05-27T00:00:00.000Z',
        visualFileId: 'visual-file-1',
        visualStatus: 'ready',
      }],
    });

    await expect(client.searchEvidence({
      workspaceId: 'mcp_ws_test',
      evidenceId: 'evidence-1',
      status: 500,
      limit: 25,
    })).resolves.toMatchObject({
      analyzerKind: 'har',
      results: [{ response: { status: 500 } }],
    });
    await expect(client.inspectEvidence({
      workspaceId: 'mcp_ws_test',
      evidenceId: 'evidence-1',
      index: 7,
    })).resolves.toMatchObject({
      analyzerKind: 'har',
      detail: { response: { status: 500 } },
    });
  });

  it('asks AI Diagnosis and returns the final assistant answer with reports', async () => {
    const calls: FetchCall[] = [];
    const client = new SupportAnalyzerMcpClient({
      harApiUrl: 'http://har.local',
      supportApiUrl: 'http://support.local',
      workbenchUiUrl: 'http://ui.local',
      fetch: fakeFetch(calls, {
        'POST http://support.local/api/session/support-session-1/prompt': {
          status: 202,
          body: { accepted: true },
        },
        'GET http://support.local/api/session/support-session-1': {
          status: 200,
          body: {
            snapshot: {
              sessionId: 'support-session-1',
              status: 'completed',
              messages: [
                { id: 'm1', role: 'user', content: 'Analyze' },
                { id: 'm2', role: 'assistant', content: 'Root cause is a repeated 500 on /fail.' },
              ],
              reports: {
                artifacts: [{ id: 'report-1', title: 'Support diagnosis', fileName: 'report.html' }],
              },
              attachments: [],
            },
          },
        },
      }),
    });
    client.seedWorkspace({
      workspaceId: 'mcp_ws_test',
      supportSessionId: 'support-session-1',
      supportCookie: 'support_workbench_client_id=owner-1',
      title: 'SR 123',
      createdAt: '2026-05-27T00:00:00.000Z',
      evidence: [{
        id: 'evidence-1',
        originalName: 'customer.har',
        analyzerKind: 'har',
        displayKind: 'HAR',
        size: 22,
        mediaType: 'application/json',
        createdAt: '2026-05-27T00:00:00.000Z',
        supportAttachmentId: 'attachment-1',
      }],
    });

    await expect(client.askAiDiagnosis({
      workspaceId: 'mcp_ws_test',
      prompt: 'Analyze the uploaded evidence',
      evidenceIds: ['evidence-1'],
      waitForCompletionMs: 25,
    })).resolves.toMatchObject({
      answer: 'Root cause is a repeated 500 on /fail.',
      reports: [{ id: 'report-1', title: 'Support diagnosis' }],
    });
    expect(JSON.parse(String(calls[0].body))).toMatchObject({
      prompt: 'Analyze the uploaded evidence',
      attachmentIds: ['attachment-1'],
    });
  });
});

describe('Support Analyzer MCP JSON-RPC handler', () => {
  it('responds to initialize and exposes tool capabilities', async () => {
    await expect(handleMcpJsonRpcMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }, {} as never)).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        capabilities: { tools: {} },
        serverInfo: { name: 'support-analyzer-workbench' },
      },
    });
  });

  it('lists and invokes registered tools', async () => {
    const client = {
      createWorkspace: vi.fn().mockResolvedValue({ workspaceId: 'mcp_ws_1', supportSessionId: 'support-1' }),
    };

    await expect(handleMcpJsonRpcMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, client as never)).resolves.toMatchObject({
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'create_workspace' }),
          expect.objectContaining({ name: 'upload_evidence' }),
        ]),
      },
    });

    const response = await handleMcpJsonRpcMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'create_workspace',
        arguments: { title: 'SR 123' },
      },
    }, client as never);

    expect(client.createWorkspace).toHaveBeenCalledWith({ title: 'SR 123' });
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: {
        content: [{
          type: 'text',
          text: expect.stringContaining('mcp_ws_1'),
        }],
      },
    });
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'support-analyzer-mcp-'));
  tempDirs.push(dir);
  return dir;
}

function fakeFetch(
  calls: FetchCall[],
  responses: Record<string, { status: number; body: unknown; headers?: Record<string, string> }>
) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const key = `${method} ${url}`;
    calls.push({
      url,
      method,
      body: init?.body,
      headers: init?.headers as Record<string, string> | undefined,
    });
    const match = responses[key];
    if (!match) {
      throw new Error(`Unexpected fetch call: ${key}`);
    }

    return {
      ok: match.status >= 200 && match.status < 300,
      status: match.status,
      headers: {
        get(name: string) {
          return match.headers?.[name.toLowerCase()] ?? match.headers?.[name] ?? null;
        },
      },
      async json() {
        return match.body;
      },
      async text() {
        return typeof match.body === 'string' ? match.body : JSON.stringify(match.body);
      },
    } as Response;
  });
}
