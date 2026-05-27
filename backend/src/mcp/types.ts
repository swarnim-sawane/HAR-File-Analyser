export type EvidenceAnalyzerKind =
  | 'har'
  | 'log'
  | 'archive'
  | 'document'
  | 'image'
  | 'structured'
  | 'table'
  | 'text'
  | 'binary';

export type McpEvidenceClassification = {
  analyzerKind: EvidenceAnalyzerKind;
  displayKind: string;
  mediaType: string;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
};

export type McpEvidenceItem = {
  id: string;
  originalName: string;
  analyzerKind: EvidenceAnalyzerKind;
  displayKind: string;
  size: number;
  mediaType: string;
  createdAt: string;
  localPath?: string;
  supportAttachmentId?: string;
  visualFileId?: string;
  visualStatus?: 'metadata-only' | 'processing' | 'ready' | 'error';
  classificationReasons?: string[];
};

export type McpWorkspace = {
  workspaceId: string;
  supportSessionId: string;
  title?: string;
  supportCookie?: string;
  createdAt: string;
  evidence: McpEvidenceItem[];
};

export type CreateWorkspaceInput = {
  title?: string;
  cwd?: string;
};

export type UploadEvidenceInput = {
  workspaceId: string;
  filePaths?: string[];
  files?: Array<{
    name: string;
    contentBase64: string;
    mediaType?: string;
  }>;
};

export type EvidenceLookupInput = {
  workspaceId: string;
  evidenceId?: string;
};

export type SearchEvidenceInput = EvidenceLookupInput & {
  query?: string;
  status?: number;
  method?: string;
  domain?: string;
  contentType?: string;
  levels?: string[];
  quickFocus?: string;
  page?: number;
  limit?: number;
};

export type InspectEvidenceInput = EvidenceLookupInput & {
  index?: number;
};

export type AskAiDiagnosisInput = EvidenceLookupInput & {
  prompt: string;
  evidenceIds?: string[];
  waitForCompletionMs?: number;
};

export type OpenInWorkbenchInput = EvidenceLookupInput & {
  mode?: 'visual' | 'ai';
};

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type McpJsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

export type McpJsonRpcResponse =
  | {
      jsonrpc: '2.0';
      id: string | number | null;
      result: unknown;
    }
  | {
      jsonrpc: '2.0';
      id: string | number | null;
      error: {
        code: number;
        message: string;
        data?: unknown;
      };
    };
