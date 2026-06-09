export type OpsStatusLevel = 'ok' | 'warning' | 'error' | 'unknown';
export type OpsStatusColor = 'green' | 'amber' | 'red' | 'slate';

export interface OpsCheck {
  id: string;
  label: string;
  status: OpsStatusLevel;
  color: OpsStatusColor;
  detail: string;
  latencyMs?: number;
  affectsOverall: boolean;
  data?: Record<string, unknown>;
}

export interface OpsStorageSnapshot {
  id: string;
  label: string;
  path: string;
  status: OpsStatusLevel;
  color: OpsStatusColor;
  detail: string;
  fileCount: number;
  sizeBytes: number;
  affectsOverall: boolean;
}

export interface OpsStatusResponse {
  status: OpsStatusLevel;
  color: OpsStatusColor;
  timestamp: string;
  uptimeSeconds: number;
  checks: OpsCheck[];
  storage: OpsStorageSnapshot[];
  runtime: {
    nodeVersion: string;
    platform: string;
    pid: number;
  };
}
