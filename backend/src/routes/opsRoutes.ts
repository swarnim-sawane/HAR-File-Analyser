import express, { Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { Queue } from 'bullmq';
import { getMongoDb, getRedis } from '../config/database';
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
import { getOpenAiConfig, getOpenAiConfigurationError } from '../config/openAiConfig';
import { getArtifactStore } from '../services/artifactStore';
import {
  getAiUsagePricing,
  getAiUsageSummary,
  isAiUsageTrackingEnabled,
  parseAiUsageSummaryQuery,
} from '../services/aiUsageService';

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

let harQueue: Queue | null = null;
let logQueue: Queue | null = null;

function queueFor(name: string): Queue {
  if (name === HAR_QUEUE_NAME) {
    if (!harQueue) harQueue = new Queue(HAR_QUEUE_NAME, { connection: getRedis() });
    return harQueue;
  }

  if (!logQueue) logQueue = new Queue(LOG_QUEUE_NAME, { connection: getRedis() });
  return logQueue;
}

function buildCheck(input: Omit<OpsCheck, 'color'>): OpsCheck {
  return {
    ...input,
    color: getOpsStatusColor(input.status),
  };
}

async function checkMongo(): Promise<OpsCheck> {
  const startedAt = Date.now();
  try {
    await getMongoDb().command({ ping: 1 });
    return buildCheck({
      id: 'mongodb',
      label: 'MongoDB',
      status: 'ok',
      detail: 'Connected and responding to ping.',
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: true,
    });
  } catch (error) {
    logError('ops.mongodb.error', { error });
    return buildCheck({
      id: 'mongodb',
      label: 'MongoDB',
      status: 'error',
      detail: error instanceof Error ? error.message : 'MongoDB ping failed.',
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: true,
    });
  }
}

async function checkRedis(): Promise<OpsCheck> {
  const startedAt = Date.now();
  try {
    const response = await getRedis().ping();
    return buildCheck({
      id: 'redis',
      label: 'Redis',
      status: response === 'PONG' ? 'ok' : 'warning',
      detail: response === 'PONG' ? 'Connected and responding to ping.' : `Unexpected ping response: ${response}`,
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: true,
    });
  } catch (error) {
    logError('ops.redis.error', { error });
    return buildCheck({
      id: 'redis',
      label: 'Redis',
      status: 'error',
      detail: error instanceof Error ? error.message : 'Redis ping failed.',
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

function checkAiConfiguration(): OpsCheck {
  const configurationError = getOpenAiConfigurationError();
  const config = configurationError ? null : getOpenAiConfig();
  const configured = Boolean(config);

  return buildCheck({
    id: 'openai',
    label: 'OpenAI API',
    status: configured ? 'ok' : 'warning',
    detail: configured
      ? `Configured with model ${config?.model}.`
      : configurationError || 'Optional AI is not configured.',
    affectsOverall: false,
    data: {
      baseUrlConfigured: Boolean(config?.baseUrl),
      apiKeyConfigured: Boolean(config?.apiKey),
      modelConfigured: Boolean(config?.model),
      usageTrackingEnabled: isAiUsageTrackingEnabled(),
      costRatesConfigured: Boolean(getAiUsagePricing()),
    },
  });
}

async function checkArtifactStore(): Promise<OpsCheck> {
  const startedAt = Date.now();
  const store = getArtifactStore();
  try {
    await store.probe();
    return buildCheck({
      id: 'artifactStore',
      label: store.kind === 'oci-object-storage' ? 'OCI Object Storage' : 'Local artifact storage',
      status: 'ok',
      detail: `${store.kind} artifact store is available.`,
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: true,
      data: { kind: store.kind },
    });
  } catch (error) {
    logError('ops.artifact_store.error', { kind: store.kind, error });
    return buildCheck({
      id: 'artifactStore',
      label: store.kind === 'oci-object-storage' ? 'OCI Object Storage' : 'Local artifact storage',
      status: 'error',
      detail: error instanceof Error ? error.message : 'Artifact store probe failed.',
      latencyMs: measureDurationMs(startedAt),
      affectsOverall: true,
      data: { kind: store.kind },
    });
  }
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
  const [mongo, redis, harQueueStatus, logQueueStatus, artifactStore, uploadsStorage] = await Promise.all([
    checkMongo(),
    checkRedis(),
    checkQueue('harQueue', 'HAR queue', HAR_QUEUE_NAME),
    checkQueue('logQueue', 'Console log queue', LOG_QUEUE_NAME),
    checkArtifactStore(),
    getStorageSnapshot('uploads', 'Upload directory', uploadDir),
  ]);

  const checks = [
    mongo,
    redis,
    harQueueStatus,
    logQueueStatus,
    artifactStore,
    checkAiConfiguration(),
  ];
  const storage = [uploadsStorage];
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

router.get('/ai-usage', async (req: Request, res: Response) => {
  const parsedQuery = parseAiUsageSummaryQuery(req.query as Record<string, unknown>);
  if (!parsedQuery.value) {
    return res.status(400).json({ error: parsedQuery.error || 'Invalid AI usage query.' });
  }

  try {
    const summary = await getAiUsageSummary(parsedQuery.value);
    return res.json(summary);
  } catch (error) {
    logError('ops.ai_usage.error', { error });
    return res.status(500).json({ error: 'Failed to build AI usage summary.' });
  }
});

export default router;
