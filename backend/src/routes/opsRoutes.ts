import express, { Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { getOracleQueue, getPersistenceDb, getQdrant, getRuntimeCache } from '../config/database';
import type { OracleQueueAdapter } from '../runtime/oracleRuntime';
import {
  deriveOverallStatus,
  getOpsStatusColor,
  logError,
  logWarn,
  measureDurationMs,
  type OpsStatusColor,
  type OpsStatusLevel,
} from '../config/observability';
import { HAR_QUEUE_NAME, LOG_QUEUE_NAME } from '../config/queueNames';

const router = express.Router();

interface OpsCheck {
  id: string;
  label: string;
  status: OpsStatusLevel;
  color: OpsStatusColor;
  detail: string;
  latencyMs?: number;
  affectsOverall: boolean;
  data?: Record<string, unknown>;
}

interface StorageSnapshot {
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

let harQueue: OracleQueueAdapter | null = null;
let logQueue: OracleQueueAdapter | null = null;

function queueFor(name: string): OracleQueueAdapter {
  if (name === HAR_QUEUE_NAME) {
    if (!harQueue) harQueue = getOracleQueue(HAR_QUEUE_NAME);
    return harQueue;
  }

  if (!logQueue) logQueue = getOracleQueue(LOG_QUEUE_NAME);
  return logQueue;
}

function buildCheck(input: Omit<OpsCheck, 'color'>): OpsCheck {
  return {
    ...input,
    color: getOpsStatusColor(input.status),
  };
}

async function checkOracleJson(): Promise<OpsCheck> {
  const startedAt = Date.now();
  try {
    await getPersistenceDb().command({ ping: 1 });
    return buildCheck({
      id: 'oracleJson',
      label: 'Oracle JSON Database',
      status: 'ok',
      detail: 'Connected and responding to ping.',
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: true,
    });
  } catch (error) {
    logError('ops.oracle_json.error', { error });
    return buildCheck({
      id: 'oracleJson',
      label: 'Oracle JSON Database',
      status: 'error',
      detail: error instanceof Error ? error.message : 'Oracle JSON Database ping failed.',
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: true,
    });
  }
}

async function checkOracleRuntime(): Promise<OpsCheck> {
  const startedAt = Date.now();
  try {
    const response = await getRuntimeCache().ping();
    return buildCheck({
      id: 'oracleRuntime',
      label: 'Oracle Runtime',
      status: response === 'PONG' ? 'ok' : 'warning',
      detail: response === 'PONG' ? 'Connected and responding to ping.' : `Unexpected ping response: ${response}`,
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: true,
    });
  } catch (error) {
    logError('ops.oracle_runtime.error', { error });
    return buildCheck({
      id: 'oracleRuntime',
      label: 'Oracle Runtime',
      status: 'error',
      detail: error instanceof Error ? error.message : 'Oracle runtime ping failed.',
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: true,
    });
  }
}

async function checkQueue(id: string, label: string, queueName: string): Promise<OpsCheck> {
  const startedAt = Date.now();
  try {
    const counts = await queueFor(queueName).getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
    const failed = counts.failed ?? 0;
    const waiting = counts.waiting ?? 0;
    const delayed = counts.delayed ?? 0;
    const status: OpsStatusLevel = failed > 0 || waiting + delayed > 100 ? 'warning' : 'ok';
    const detail =
      failed > 0
        ? `${failed} failed job${failed === 1 ? '' : 's'} need review.`
        : waiting + delayed > 100
          ? `${waiting + delayed} queued/delayed jobs are waiting.`
          : 'Queue is within normal operating range.';

    return buildCheck({
      id,
      label,
      status,
      detail,
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: true,
      data: counts,
    });
  } catch (error) {
    logError('ops.queue.error', { queueName, error });
    return buildCheck({
      id,
      label,
      status: 'error',
      detail: error instanceof Error ? error.message : 'Queue status check failed.',
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: true,
    });
  }
}

async function checkQdrant(): Promise<OpsCheck> {
  const startedAt = Date.now();
  try {
    const collections = await getQdrant().getCollections();
    return buildCheck({
      id: 'qdrant',
      label: 'Qdrant',
      status: 'ok',
      detail: `${collections.collections.length} collection${collections.collections.length === 1 ? '' : 's'} available.`,
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: false,
      data: { collections: collections.collections.map((collection) => collection.name) },
    });
  } catch (error) {
    return buildCheck({
      id: 'qdrant',
      label: 'Qdrant',
      status: 'unknown',
      detail: 'Optional embedding store is not connected or not configured.',
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: false,
    });
  }
}

function checkAiConfiguration(): OpsCheck {
  const hasBaseUrl = Boolean(process.env.OCA_BASE_URL);
  const hasToken = Boolean(process.env.OCA_TOKEN);
  const hasModel = Boolean(process.env.OCA_MODEL);
  const configured = hasBaseUrl && hasToken;

  return buildCheck({
    id: 'oca',
    label: 'Oracle Code Assist',
    status: configured ? 'ok' : 'warning',
    detail: configured
      ? `Configured${hasModel ? ` with model ${process.env.OCA_MODEL}` : ''}.`
      : 'Optional AI is missing OCA_BASE_URL or OCA_TOKEN.',
    affectsOverall: false,
    data: {
      baseUrlConfigured: hasBaseUrl,
      tokenConfigured: hasToken,
      modelConfigured: hasModel,
    },
  });
}

async function getDirectorySize(dirPath: string, maxEntries = 5000): Promise<{ fileCount: number; sizeBytes: number; truncated: boolean }> {
  let fileCount = 0;
  let sizeBytes = 0;
  let truncated = false;

  async function visit(currentPath: string): Promise<void> {
    if (fileCount >= maxEntries) {
      truncated = true;
      return;
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (fileCount >= maxEntries) {
        truncated = true;
        return;
      }

      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const stat = await fs.stat(entryPath);
      fileCount += 1;
      sizeBytes += stat.size;
    }
  }

  await visit(dirPath);
  return { fileCount, sizeBytes, truncated };
}

async function getStorageSnapshot(id: string, label: string, dirPath: string): Promise<StorageSnapshot> {
  const resolvedPath = path.resolve(dirPath);
  const warningBytes = Number.parseInt(process.env.OBSERVABILITY_STORAGE_WARN_BYTES || String(5 * 1024 * 1024 * 1024), 10);

  try {
    await fs.mkdir(resolvedPath, { recursive: true });
    const snapshot = await getDirectorySize(resolvedPath);
    const isLarge = snapshot.sizeBytes >= warningBytes;
    const status: OpsStatusLevel = isLarge ? 'warning' : 'ok';

    return {
      id,
      label,
      path: resolvedPath,
      status,
      color: getOpsStatusColor(status),
      detail: snapshot.truncated
        ? `Directory scan capped at ${snapshot.fileCount} files.`
        : isLarge
          ? 'Directory size is above the configured warning threshold.'
          : 'Directory size is within the configured threshold.',
      fileCount: snapshot.fileCount,
      sizeBytes: snapshot.sizeBytes,
      affectsOverall: false,
    };
  } catch (error) {
    logWarn('ops.storage.warning', { id, path: resolvedPath, error });
    return {
      id,
      label,
      path: resolvedPath,
      status: 'warning',
      color: getOpsStatusColor('warning'),
      detail: error instanceof Error ? error.message : 'Could not inspect directory.',
      fileCount: 0,
      sizeBytes: 0,
      affectsOverall: false,
    };
  }
}

export async function buildOpsStatus() {
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  const processedDir = process.env.PROCESSED_DIR || path.join(process.cwd(), 'processed');

  const [oracleJson, oracleRuntime, harQueueStatus, logQueueStatus, qdrant, uploadsStorage, processedStorage] = await Promise.all([
    checkOracleJson(),
    checkOracleRuntime(),
    checkQueue('harQueue', 'HAR queue', HAR_QUEUE_NAME),
    checkQueue('logQueue', 'Console log queue', LOG_QUEUE_NAME),
    checkQdrant(),
    getStorageSnapshot('uploads', 'Upload directory', uploadDir),
    getStorageSnapshot('processed', 'Processed directory', processedDir),
  ]);

  const checks = [
    oracleJson,
    oracleRuntime,
    harQueueStatus,
    logQueueStatus,
    qdrant,
    checkAiConfiguration(),
  ];
  const storage = [uploadsStorage, processedStorage];
  const overallStatus = deriveOverallStatus([...checks, ...storage]);

  return {
    status: overallStatus,
    color: getOpsStatusColor(overallStatus),
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks,
    storage,
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
    },
  };
}

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await buildOpsStatus();
    res.status(status.status === 'error' ? 503 : 200).json(status);
  } catch (error) {
    logError('ops.status.unhandled_error', { error });
    res.status(500).json({
      status: 'error',
      color: getOpsStatusColor('error'),
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Failed to build operations status.',
    });
  }
});

export default router;
