import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { File, FormData, fetch as undiciFetch } from 'undici';
import { classifyEvidenceFile } from './fileClassifier';
import type {
  AskAiDiagnosisInput,
  CreateWorkspaceInput,
  EvidenceAnalyzerKind,
  EvidenceLookupInput,
  FetchLike,
  InspectEvidenceInput,
  McpEvidenceItem,
  McpWorkspace,
  OpenInWorkbenchInput,
  SearchEvidenceInput,
  UploadEvidenceInput,
} from './types';

const DEFAULT_CHUNK_SIZE_BYTES = 3 * 1024 * 1024;
const DEFAULT_AI_WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

type ClientConfig = {
  harApiUrl?: string;
  supportApiUrl?: string;
  workbenchUiUrl?: string;
  fetch?: FetchLike;
  chunkSizeBytes?: number;
  workspaceStore?: McpWorkspaceStore;
};

export type McpWorkspaceStore = {
  loadWorkspace(workspaceId: string): Promise<McpWorkspace | null>;
  saveWorkspace(workspace: McpWorkspace): Promise<void>;
};

type SupportSnapshot = {
  sessionId: string;
  status?: string;
  messages?: Array<{ role: string; content: string }>;
  attachments?: Array<{ id: string; originalName?: string }>;
  reports?: {
    artifacts?: unknown[];
  };
};

export class SupportAnalyzerMcpClient {
  private readonly harApiUrl: string;
  private readonly supportApiUrl: string;
  private readonly workbenchUiUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly chunkSizeBytes: number;
  private readonly workspaceStore?: McpWorkspaceStore;
  private readonly workspaces = new Map<string, McpWorkspace>();

  constructor(config: ClientConfig = {}) {
    this.harApiUrl = stripTrailingSlash(
      config.harApiUrl
      || process.env.SUPPORT_ANALYZER_HAR_API_URL
      || process.env.SUPPORT_ANALYZER_API_URL
      || `http://localhost:${process.env.PORT || 4000}`
    );
    this.supportApiUrl = stripTrailingSlash(
      config.supportApiUrl || process.env.SUPPORT_WORKBENCH_API_URL || 'http://localhost:4317'
    );
    this.workbenchUiUrl = stripTrailingSlash(
      config.workbenchUiUrl || process.env.SUPPORT_ANALYZER_UI_URL || 'http://localhost:3000'
    );
    this.fetchImpl = config.fetch || (undiciFetch as unknown as FetchLike);
    this.chunkSizeBytes = config.chunkSizeBytes || DEFAULT_CHUNK_SIZE_BYTES;
    this.workspaceStore = config.workspaceStore;
  }

  async createWorkspace(input: CreateWorkspaceInput = {}): Promise<McpWorkspace> {
    const response = await this.requestJson<{ session: { id: string }; snapshot?: SupportSnapshot }>(
      `${this.supportApiUrl}/api/session`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: input.cwd,
        }),
      }
    );
    const workspace: McpWorkspace = {
      workspaceId: `mcp_ws_${Date.now()}_${randomUUID().slice(0, 8)}`,
      supportSessionId: response.body.session.id,
      supportCookie: extractSetCookie(response.headers),
      title: input.title,
      createdAt: new Date().toISOString(),
      evidence: [],
    };
    this.workspaces.set(workspace.workspaceId, workspace);
    await this.saveWorkspace(workspace);
    return workspace;
  }

  seedWorkspace(workspace: McpWorkspace): void {
    this.workspaces.set(workspace.workspaceId, workspace);
  }

  getWorkspace(workspaceId: string): McpWorkspace | undefined {
    return this.workspaces.get(workspaceId);
  }

  async uploadEvidence(input: UploadEvidenceInput): Promise<{ workspace: McpWorkspace; evidence: McpEvidenceItem[] }> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const filePaths = Array.isArray(input.filePaths) ? input.filePaths : [];
    const inlineFiles = Array.isArray(input.files) ? input.files : [];

    if (filePaths.length === 0 && inlineFiles.length === 0) {
      throw new Error('upload_evidence requires filePaths or files');
    }

    const preparedFromPaths = await Promise.all(filePaths.map(async (filePath) => {
      const fileBuffer = await fs.readFile(filePath);
      const stats = await fs.stat(filePath);
      const originalName = path.basename(filePath);
      const classification = classifyEvidenceFile(originalName, fileBuffer.subarray(0, 4096));
      return {
        filePath,
        fileBuffer,
        originalName,
        size: stats.size,
        classification,
      };
    }));
    const preparedFromInline = inlineFiles.map((file) => {
      if (!file || typeof file.name !== 'string' || !file.name.trim()) {
        throw new Error('Each inline file requires a name');
      }
      if (typeof file.contentBase64 !== 'string' || !file.contentBase64.trim()) {
        throw new Error(`Inline file ${file.name} requires contentBase64`);
      }

      const fileBuffer = Buffer.from(file.contentBase64, 'base64');
      const classification = classifyEvidenceFile(file.name, fileBuffer.subarray(0, 4096));
      return {
        fileBuffer,
        originalName: file.name,
        size: fileBuffer.length,
        classification: {
          ...classification,
          mediaType: file.mediaType || classification.mediaType,
        },
      };
    });
    const prepared = [...preparedFromPaths, ...preparedFromInline];

    const formData = new FormData();
    for (const item of prepared) {
      formData.append('files', new File([new Uint8Array(item.fileBuffer)], item.originalName, {
        type: item.classification.mediaType,
      }));
    }

    const supportResponse = await this.requestJson<{
      attachments?: Array<{ id: string; originalName?: string; size?: number }>;
      snapshot?: SupportSnapshot;
    }>(
      `${this.supportApiUrl}/api/session/${encodeURIComponent(workspace.supportSessionId)}/attachments`,
      {
        method: 'POST',
        headers: workspace.supportCookie ? { cookie: workspace.supportCookie } : undefined,
        body: formData as unknown as RequestInit['body'],
      }
    );
    const supportAttachments = supportResponse.body.attachments ?? [];
    const evidence: McpEvidenceItem[] = [];

    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index];
      const supportAttachment = supportAttachments[index];
      const createdAt = new Date().toISOString();
      const possibleFilePath = (item as { filePath?: unknown }).filePath;
      const localPath = typeof possibleFilePath === 'string' ? possibleFilePath : undefined;
      const evidenceItem: McpEvidenceItem = {
        id: `evidence_${randomUUID()}`,
        originalName: item.originalName,
        analyzerKind: item.classification.analyzerKind,
        displayKind: item.classification.displayKind,
        size: item.size,
        mediaType: item.classification.mediaType,
        localPath,
        supportAttachmentId: supportAttachment?.id,
        visualStatus: 'metadata-only',
        classificationReasons: item.classification.reasons,
        createdAt,
      };

      if (item.classification.analyzerKind === 'har' || item.classification.analyzerKind === 'log') {
        const visualUpload = await this.uploadToVisualAnalyzer(
          item.fileBuffer,
          item.originalName,
          item.classification.analyzerKind
        );
        evidenceItem.visualFileId = visualUpload.fileId;
        evidenceItem.visualStatus = 'processing';
      }

      workspace.evidence.push(evidenceItem);
      evidence.push(evidenceItem);
    }

    await this.saveWorkspace(workspace);
    return { workspace, evidence };
  }

  async listEvidence(input: EvidenceLookupInput): Promise<{ workspace: McpWorkspace; supportSnapshot: SupportSnapshot | null }> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const supportSnapshot = await this.getSupportSnapshot(workspace, false);
    return { workspace, supportSnapshot };
  }

  async analyzeEvidence(input: EvidenceLookupInput): Promise<{ workspaceId: string; summaries: unknown[] }> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const evidence = this.resolveEvidence(workspace, input.evidenceId);
    const summaries = await Promise.all(evidence.map(async (item) => {
      if (!item.visualFileId || (item.analyzerKind !== 'har' && item.analyzerKind !== 'log')) {
        return {
          evidenceId: item.id,
          fileName: item.originalName,
          analyzerKind: item.analyzerKind,
          visualStatus: item.visualStatus,
          note: 'Metadata-only evidence. Use ask_ai_diagnosis for deeper reasoning.',
        };
      }

      const basePath = item.analyzerKind === 'har' ? 'har' : 'console-log';
      const [status, stats] = await Promise.all([
        this.optionalJson(`${this.harApiUrl}/api/${basePath}/${encodeURIComponent(item.visualFileId)}/status`),
        this.optionalJson(`${this.harApiUrl}/api/${basePath}/${encodeURIComponent(item.visualFileId)}/stats`),
      ]);

      if (status && typeof status === 'object' && (status as { status?: string }).status === 'completed') {
        item.visualStatus = 'ready';
      }

      return {
        evidenceId: item.id,
        fileName: item.originalName,
        analyzerKind: item.analyzerKind,
        visualFileId: item.visualFileId,
        status,
        stats,
      };
    }));

    await this.saveWorkspace(workspace);
    return { workspaceId: workspace.workspaceId, summaries };
  }

  async searchEvidence(input: SearchEvidenceInput): Promise<{ evidenceId: string; analyzerKind: EvidenceAnalyzerKind; results: unknown[]; pagination?: unknown }> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const evidence = this.requireSingleEvidence(workspace, input.evidenceId);
    if (!evidence.visualFileId || (evidence.analyzerKind !== 'har' && evidence.analyzerKind !== 'log')) {
      throw new Error(`Evidence ${evidence.id} is not searchable through a deterministic visual analyzer`);
    }

    const response = evidence.analyzerKind === 'har'
      ? await this.requestJson<{ entries?: unknown[]; pagination?: unknown }>(
        `${this.harApiUrl}/api/har/${encodeURIComponent(evidence.visualFileId)}/search?${buildHarSearchParams(input)}`
      )
      : await this.requestJson<{ entries?: unknown[]; pagination?: unknown }>(
        `${this.harApiUrl}/api/console-log/${encodeURIComponent(evidence.visualFileId)}/entries?${buildLogSearchParams(input)}`
      );

    return {
      evidenceId: evidence.id,
      analyzerKind: evidence.analyzerKind,
      results: response.body.entries ?? [],
      pagination: response.body.pagination,
    };
  }

  async inspectEvidence(input: InspectEvidenceInput): Promise<{ evidenceId: string; analyzerKind: EvidenceAnalyzerKind; detail: unknown }> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const evidence = this.requireSingleEvidence(workspace, input.evidenceId);
    if (!evidence.visualFileId || (evidence.analyzerKind !== 'har' && evidence.analyzerKind !== 'log')) {
      return {
        evidenceId: evidence.id,
        analyzerKind: evidence.analyzerKind,
        detail: evidence,
      };
    }

    const index = Number.isFinite(input.index) ? Number(input.index) : 0;
    const basePath = evidence.analyzerKind === 'har' ? 'har' : 'console-log';
    const detail = await this.requestJson<unknown>(
      `${this.harApiUrl}/api/${basePath}/${encodeURIComponent(evidence.visualFileId)}/entries/${index}`
    );

    return {
      evidenceId: evidence.id,
      analyzerKind: evidence.analyzerKind,
      detail: detail.body,
    };
  }

  async askAiDiagnosis(input: AskAiDiagnosisInput): Promise<{ answer: string; reports: unknown[]; snapshot: SupportSnapshot | null }> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const evidence = input.evidenceIds?.length
      ? input.evidenceIds.map((id) => this.requireSingleEvidence(workspace, id))
      : workspace.evidence;
    const attachmentIds = evidence
      .map((item) => item.supportAttachmentId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    await this.requestJson(
      `${this.supportApiUrl}/api/session/${encodeURIComponent(workspace.supportSessionId)}/prompt`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(workspace.supportCookie ? { cookie: workspace.supportCookie } : {}),
        },
        body: JSON.stringify({
          prompt: input.prompt,
          attachmentIds,
        }),
      }
    );

    const snapshot = await this.waitForSupportCompletion(workspace, input.waitForCompletionMs ?? DEFAULT_AI_WAIT_MS);
    const answer = latestAssistantAnswer(snapshot);
    return {
      answer,
      reports: snapshot?.reports?.artifacts ?? [],
      snapshot,
    };
  }

  async generateSupportReport(input: AskAiDiagnosisInput): Promise<{ answer: string; reports: unknown[]; snapshot: SupportSnapshot | null }> {
    return this.askAiDiagnosis({
      ...input,
      prompt: input.prompt || [
        'Generate a support-ready diagnostic report from the selected evidence.',
        'Include root cause hypothesis, confidence, exact evidence, customer impact, recommended actions, and next data to request.',
      ].join(' '),
    });
  }

  async openInWorkbench(input: OpenInWorkbenchInput): Promise<{ url: string; workspaceId: string; supportSessionId: string; evidenceId?: string }> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const evidence = input.evidenceId ? this.requireSingleEvidence(workspace, input.evidenceId) : undefined;
    const url = new URL(this.workbenchUiUrl);
    if (input.mode === 'ai') {
      url.searchParams.set('sessionId', workspace.supportSessionId);
      url.searchParams.set('embedded', '1');
    } else if (evidence?.visualFileId) {
      url.searchParams.set('fileId', evidence.visualFileId);
    }
    url.searchParams.set('workspaceId', workspace.workspaceId);
    if (evidence) {
      url.searchParams.set('evidenceId', evidence.id);
    }
    return {
      url: url.toString(),
      workspaceId: workspace.workspaceId,
      supportSessionId: workspace.supportSessionId,
      evidenceId: evidence?.id,
    };
  }

  private async uploadToVisualAnalyzer(fileBuffer: Buffer, fileName: string, analyzerKind: 'har' | 'log'): Promise<{ fileId: string }> {
    const fileId = `mcp_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const totalChunks = Math.max(1, Math.ceil(fileBuffer.length / this.chunkSizeBytes));

    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * this.chunkSizeBytes;
      const end = Math.min(start + this.chunkSizeBytes, fileBuffer.length);
      const chunk = fileBuffer.subarray(start, end);
      const formData = new FormData();
      formData.append('chunk', new File([new Uint8Array(chunk)], `${fileName}.chunk-${index}`));
      formData.append('fileId', fileId);
      formData.append('chunkIndex', String(index));
      formData.append('totalChunks', String(totalChunks));
      await this.requestJson(`${this.harApiUrl}/api/upload/chunk`, {
        method: 'POST',
        body: formData as unknown as RequestInit['body'],
      });
    }

    const complete = await this.requestJson<{ fileId: string }>(`${this.harApiUrl}/api/upload/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileId,
        totalChunks,
        fileName,
        fileType: analyzerKind,
      }),
    });
    return { fileId: complete.body.fileId || fileId };
  }

  private async requireWorkspace(workspaceId: string): Promise<McpWorkspace> {
    let workspace = this.workspaces.get(workspaceId);
    if (!workspace && this.workspaceStore) {
      workspace = await this.workspaceStore.loadWorkspace(workspaceId) ?? undefined;
      if (workspace) {
        this.workspaces.set(workspace.workspaceId, workspace);
      }
    }
    if (!workspace) {
      throw new Error(`Unknown workspaceId: ${workspaceId}`);
    }
    return workspace;
  }

  private async saveWorkspace(workspace: McpWorkspace): Promise<void> {
    this.workspaces.set(workspace.workspaceId, workspace);
    await this.workspaceStore?.saveWorkspace(workspace);
  }

  private resolveEvidence(workspace: McpWorkspace, evidenceId?: string): McpEvidenceItem[] {
    return evidenceId ? [this.requireSingleEvidence(workspace, evidenceId)] : workspace.evidence;
  }

  private requireSingleEvidence(workspace: McpWorkspace, evidenceId?: string): McpEvidenceItem {
    if (!evidenceId && workspace.evidence.length === 1) {
      return workspace.evidence[0];
    }
    const evidence = workspace.evidence.find((item) => item.id === evidenceId);
    if (!evidence) {
      throw new Error(`Unknown evidenceId: ${evidenceId || '(missing)'}`);
    }
    return evidence;
  }

  private async waitForSupportCompletion(workspace: McpWorkspace, waitForCompletionMs: number): Promise<SupportSnapshot | null> {
    const deadline = Date.now() + Math.max(0, waitForCompletionMs);
    let lastSnapshot: SupportSnapshot | null = null;
    do {
      lastSnapshot = await this.getSupportSnapshot(workspace, true);
      if (!lastSnapshot || !['running', 'awaiting_approval'].includes(String(lastSnapshot.status))) {
        return lastSnapshot;
      }
      await delay(POLL_INTERVAL_MS);
    } while (Date.now() < deadline);
    return lastSnapshot;
  }

  private async getSupportSnapshot(workspace: McpWorkspace, required: boolean): Promise<SupportSnapshot | null> {
    try {
      const response = await this.requestJson<{ snapshot: SupportSnapshot }>(
        `${this.supportApiUrl}/api/session/${encodeURIComponent(workspace.supportSessionId)}`,
        {
          headers: workspace.supportCookie ? { cookie: workspace.supportCookie } : undefined,
        }
      );
      return response.body.snapshot;
    } catch (error) {
      if (required) throw error;
      return null;
    }
  }

  private async optionalJson(url: string): Promise<unknown | null> {
    try {
      const response = await this.requestJson<unknown>(url);
      return response.body;
    } catch {
      return null;
    }
  }

  private async requestJson<T>(url: string, init?: RequestInit): Promise<{ body: T; headers: Headers }> {
    const response = await this.fetchImpl(url, init);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Request failed ${response.status} ${url}: ${text}`);
    }
    const body = text ? JSON.parse(text) as T : {} as T;
    return { body, headers: response.headers };
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function extractSetCookie(headers: Headers): string | undefined {
  return headers.get('set-cookie') ?? undefined;
}

function buildHarSearchParams(input: SearchEvidenceInput): string {
  const params = new URLSearchParams();
  if (input.method) params.set('method', input.method);
  if (typeof input.status === 'number') params.set('status', String(input.status));
  if (input.domain) params.set('domain', input.domain);
  if (input.contentType) params.set('contentType', input.contentType);
  params.set('page', String(input.page ?? 1));
  params.set('limit', String(input.limit ?? 25));
  return params.toString();
}

function buildLogSearchParams(input: SearchEvidenceInput): string {
  const params = new URLSearchParams();
  if (input.query) params.set('search', input.query);
  if (input.levels?.length) params.set('levels', input.levels.join(','));
  if (input.quickFocus) params.set('quickFocus', input.quickFocus);
  params.set('page', String(input.page ?? 1));
  params.set('limit', String(input.limit ?? 25));
  return params.toString();
}

function latestAssistantAnswer(snapshot: SupportSnapshot | null): string {
  const messages = snapshot?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && message.content.trim()) {
      return message.content;
    }
  }
  return '';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
