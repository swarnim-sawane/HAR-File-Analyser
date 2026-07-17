import { promises as fs } from 'fs';
import path from 'path';
import type Redis from 'ioredis';
import type { ArtifactStore } from './artifactStore';
import type { PostgresStore } from '../persistence/postgresStore';

export interface RetentionCleanupConfig {
  enabled: boolean;
  maxAgeHours: number;
  intervalMinutes: number;
  dryRun: boolean;
}

interface RetentionFileDoc {
  fileId: string;
  fileName?: string;
  filePath?: string;
  artifactKey?: string;
}

export interface RetentionCleanupOptions {
  database: PostgresStore;
  redis: Redis;
  artifactStore?: ArtifactStore;
  uploadDir: string;
  processedDir: string;
  maxAgeHours: number;
  dryRun?: boolean;
  now?: Date;
}

export interface RetentionCleanupResult {
  cutoff: string;
  dryRun: boolean;
  harFiles: number;
  harEntries: number;
  consoleLogFiles: number;
  consoleLogEntries: number;
  redisKeys: number;
  filesDeleted: number;
  staleUploadChunks: number;
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

export function parseRetentionCleanupConfig(env: Record<string, string | undefined>): RetentionCleanupConfig {
  return {
    enabled: parseBoolean(env.RETENTION_CLEANUP_ENABLED),
    maxAgeHours: parsePositiveInteger(env.RETENTION_MAX_AGE_HOURS, 168),
    intervalMinutes: parsePositiveInteger(env.RETENTION_CLEANUP_INTERVAL_MINUTES, 60),
    dryRun: parseBoolean(env.RETENTION_CLEANUP_DRY_RUN),
  };
}

function isInsideDirectory(candidatePath: string, allowedDirectory: string): boolean {
  const candidate = path.resolve(candidatePath);
  const allowed = path.resolve(allowedDirectory);
  return candidate === allowed || candidate.startsWith(`${allowed}${path.sep}`);
}

export async function deleteFileIfSafe(
  filePath: string | undefined,
  allowedDirectories: string[],
  dryRun: boolean,
): Promise<boolean> {
  if (!filePath) return false;
  if (!allowedDirectories.some((directory) => isInsideDirectory(filePath, directory))) return false;

  try {
    await fs.access(filePath);
  } catch {
    return false;
  }

  if (!dryRun) {
    await fs.rm(filePath, { force: true });
  }
  return true;
}

function candidateProcessedPaths(doc: RetentionFileDoc, processedDir: string): string[] {
  const candidates = new Set<string>();
  if (doc.filePath) candidates.add(doc.filePath);
  if (doc.fileName) candidates.add(path.join(processedDir, `${doc.fileId}_${path.basename(doc.fileName)}`));
  return Array.from(candidates);
}

async function deleteRedisKeys(redis: Redis, fileIds: string[], dryRun: boolean): Promise<number> {
  let count = 0;

  for (const fileId of fileIds) {
    const keys = [
      `file:${fileId}:metadata`,
      `stats:${fileId}`,
      `log_stats:${fileId}`,
      `upload:${fileId}:chunks`,
      `upload:${fileId}:progress`,
    ];
    count += keys.length;
    if (!dryRun) await redis.del(...keys);
  }

  return count;
}

async function cleanupStaleUploadChunks(uploadDir: string, cutoff: Date, dryRun: boolean): Promise<number> {
  let deleted = 0;

  let entries: string[];
  try {
    entries = await fs.readdir(uploadDir);
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (!/_chunk_\d+$/.test(entry)) continue;

    const filePath = path.join(uploadDir, entry);
    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats || stats.mtime >= cutoff) continue;

    if (await deleteFileIfSafe(filePath, [uploadDir], dryRun)) {
      deleted += 1;
    }
  }

  return deleted;
}

async function cleanupStaleArtifactChunks(
  artifactStore: ArtifactStore | undefined,
  cutoff: Date,
  dryRun: boolean,
): Promise<number> {
  if (!artifactStore) return 0;
  let deleted = 0;

  for await (const artifact of artifactStore.list('tmp')) {
    if (!artifact.lastModified || artifact.lastModified >= cutoff) continue;
    if (!dryRun) await artifactStore.delete(artifact.key);
    deleted += 1;
  }

  return deleted;
}

export async function cleanupExpiredAnalysisData(
  options: RetentionCleanupOptions,
): Promise<RetentionCleanupResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.maxAgeHours * 60 * 60 * 1000);
  const dryRun = options.dryRun === true;
  const allowedFileDirs = [options.processedDir, options.uploadDir];

  const [harFiles, consoleLogFiles] = await Promise.all([
    options.database.findExpiredFiles('har', cutoff),
    options.database.findExpiredFiles('console', cutoff),
  ]);

  const harFileIds = harFiles.map((file) => file.fileId);
  const consoleLogFileIds = consoleLogFiles.map((file) => file.fileId);
  const allFileIds = [...harFileIds, ...consoleLogFileIds];

  let filesDeleted = 0;
  for (const doc of [...harFiles, ...consoleLogFiles]) {
    if (doc.artifactKey && options.artifactStore) {
      if (dryRun || await options.artifactStore.delete(doc.artifactKey)) filesDeleted += 1;
    }
    for (const candidate of candidateProcessedPaths(doc, options.processedDir)) {
      if (await deleteFileIfSafe(candidate, allowedFileDirs, dryRun)) {
        filesDeleted += 1;
      }
    }
  }

  const staleUploadChunks = (
    await cleanupStaleUploadChunks(options.uploadDir, cutoff, dryRun)
  ) + (
    await cleanupStaleArtifactChunks(options.artifactStore, cutoff, dryRun)
  );
  const redisKeys = await deleteRedisKeys(options.redis, allFileIds, dryRun);

  let harEntries: number;
  let consoleLogEntries: number;
  if (dryRun) {
    const [harCount, consoleCount] = await Promise.all([
      harFileIds.length
        ? options.database.query<{ count: string }>('SELECT COUNT(*)::bigint AS count FROM har_entries WHERE file_id = ANY($1::text[])', [harFileIds])
        : Promise.resolve({ rows: [{ count: '0' }] }),
      consoleLogFileIds.length
        ? options.database.query<{ count: string }>('SELECT COUNT(*)::bigint AS count FROM console_logs WHERE file_id = ANY($1::text[])', [consoleLogFileIds])
        : Promise.resolve({ rows: [{ count: '0' }] }),
    ]);
    harEntries = Number(harCount.rows[0]?.count ?? 0);
    consoleLogEntries = Number(consoleCount.rows[0]?.count ?? 0);
  } else {
    const [harDeleted, consoleDeleted] = await Promise.all([
      options.database.deleteFiles('har', harFileIds),
      options.database.deleteFiles('console', consoleLogFileIds),
    ]);
    harEntries = harDeleted.entries;
    consoleLogEntries = consoleDeleted.entries;
  }

  return {
    cutoff: cutoff.toISOString(),
    dryRun,
    harFiles: harFiles.length,
    harEntries,
    consoleLogFiles: consoleLogFiles.length,
    consoleLogEntries,
    redisKeys,
    filesDeleted,
    staleUploadChunks,
  };
}
