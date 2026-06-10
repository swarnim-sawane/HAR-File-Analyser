import { promises as fs } from 'fs';
import path from 'path';
import type { OracleJsonDatabase } from '../persistence/oracleJsonStore';
import type { OracleCacheStore } from '../runtime/oracleRuntime';

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
}

export interface RetentionCleanupOptions {
  db: OracleJsonDatabase;
  runtimeCache: OracleCacheStore;
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
  runtimeKeys: number;
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

async function deleteRuntimeKeys(runtimeCache: OracleCacheStore, fileIds: string[], dryRun: boolean): Promise<number> {
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
    if (!dryRun) await runtimeCache.del(...keys);
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

export async function cleanupExpiredAnalysisData(
  options: RetentionCleanupOptions,
): Promise<RetentionCleanupResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.maxAgeHours * 60 * 60 * 1000);
  const dryRun = options.dryRun === true;
  const allowedFileDirs = [options.processedDir, options.uploadDir];

  const harFiles = await options.db
    .collection<RetentionFileDoc>('har_files')
    .find({ uploadedAt: { $lt: cutoff } })
    .project({ fileId: 1, fileName: 1, filePath: 1 })
    .toArray() as RetentionFileDoc[];
  const consoleLogFiles = await options.db
    .collection<RetentionFileDoc>('console_log_files')
    .find({ uploadedAt: { $lt: cutoff } })
    .project({ fileId: 1, fileName: 1, filePath: 1 })
    .toArray() as RetentionFileDoc[];

  const harFileIds = harFiles.map((file) => file.fileId);
  const consoleLogFileIds = consoleLogFiles.map((file) => file.fileId);
  const allFileIds = [...harFileIds, ...consoleLogFileIds];

  let filesDeleted = 0;
  for (const doc of [...harFiles, ...consoleLogFiles]) {
    for (const candidate of candidateProcessedPaths(doc, options.processedDir)) {
      if (await deleteFileIfSafe(candidate, allowedFileDirs, dryRun)) {
        filesDeleted += 1;
      }
    }
  }

  const staleUploadChunks = await cleanupStaleUploadChunks(options.uploadDir, cutoff, dryRun);
  const runtimeKeys = await deleteRuntimeKeys(options.runtimeCache, allFileIds, dryRun);

  let harEntries = 0;
  let consoleLogEntries = 0;
  if (!dryRun) {
    const [harEntryResult, consoleEntryResult] = await Promise.all([
      harFileIds.length
        ? options.db.collection('har_entries').deleteMany({ fileId: { $in: harFileIds } })
        : Promise.resolve({ deletedCount: 0 }),
      consoleLogFileIds.length
        ? options.db.collection('console_logs').deleteMany({ fileId: { $in: consoleLogFileIds } })
        : Promise.resolve({ deletedCount: 0 }),
    ]);
    harEntries = harEntryResult.deletedCount ?? 0;
    consoleLogEntries = consoleEntryResult.deletedCount ?? 0;

    await Promise.all([
      harFileIds.length
        ? options.db.collection('har_files').deleteMany({ fileId: { $in: harFileIds } })
        : Promise.resolve({ deletedCount: 0 }),
      consoleLogFileIds.length
        ? options.db.collection('console_log_files').deleteMany({ fileId: { $in: consoleLogFileIds } })
        : Promise.resolve({ deletedCount: 0 }),
    ]);
  } else {
    harEntries = await (harFileIds.length
      ? options.db.collection('har_entries').countDocuments({ fileId: { $in: harFileIds } })
      : Promise.resolve(0));
    consoleLogEntries = await (consoleLogFileIds.length
      ? options.db.collection('console_logs').countDocuments({ fileId: { $in: consoleLogFileIds } })
      : Promise.resolve(0));
  }

  return {
    cutoff: cutoff.toISOString(),
    dryRun,
    harFiles: harFiles.length,
    harEntries,
    consoleLogFiles: consoleLogFiles.length,
    consoleLogEntries,
    runtimeKeys,
    filesDeleted,
    staleUploadChunks,
  };
}
