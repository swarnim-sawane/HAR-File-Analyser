import { mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteFileIfSafe,
  parseRetentionCleanupConfig,
} from './retentionCleanupService';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('retention cleanup service', () => {
  it('keeps cleanup disabled unless explicitly enabled', () => {
    const config = parseRetentionCleanupConfig({});

    expect(config.enabled).toBe(false);
    expect(config.maxAgeHours).toBe(168);
    expect(config.intervalMinutes).toBe(60);
    expect(config.dryRun).toBe(false);
  });

  it('parses enabled retention cleanup settings with safe minimums', () => {
    const config = parseRetentionCleanupConfig({
      RETENTION_CLEANUP_ENABLED: 'true',
      RETENTION_MAX_AGE_HOURS: '24',
      RETENTION_CLEANUP_INTERVAL_MINUTES: '30',
      RETENTION_CLEANUP_DRY_RUN: '1',
    });

    expect(config).toEqual({
      enabled: true,
      maxAgeHours: 24,
      intervalMinutes: 30,
      dryRun: true,
    });
  });

  it('deletes only files inside explicitly allowed directories', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'har-retention-'));
    const allowedDir = path.join(tempDir, 'processed');
    const outsideDir = path.join(tempDir, 'outside');
    const allowedFile = path.join(allowedDir, 'file_1_sample.har');
    const outsideFile = path.join(outsideDir, 'file_1_sample.har');

    await mkdir(allowedDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(allowedFile, '{}', { flag: 'w' });
    await writeFile(outsideFile, '{}', { flag: 'w' });

    await expect(deleteFileIfSafe(allowedFile, [allowedDir], false)).resolves.toBe(true);
    await expect(stat(allowedFile)).rejects.toThrow();

    await expect(deleteFileIfSafe(outsideFile, [allowedDir], false)).resolves.toBe(false);
    await expect(stat(outsideFile)).resolves.toBeDefined();
  });
});
