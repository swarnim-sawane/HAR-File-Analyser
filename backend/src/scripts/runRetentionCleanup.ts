import path from 'path';
import dotenv from 'dotenv';
import { closeDatabases, connectDatabases, getPersistenceDb, getRedis } from '../config/database';
import {
  cleanupExpiredAnalysisData,
  parseRetentionCleanupConfig,
} from '../services/retentionCleanupService';

dotenv.config();

async function main() {
  const config = parseRetentionCleanupConfig({
    ...process.env,
    RETENTION_CLEANUP_ENABLED: 'true',
  });
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
  const processedDir = path.resolve(process.env.PROCESSED_DIR || path.join(process.cwd(), 'processed'));

  await connectDatabases();
  try {
    const result = await cleanupExpiredAnalysisData({
      db: getPersistenceDb(),
      redis: getRedis(),
      uploadDir,
      processedDir,
      maxAgeHours: config.maxAgeHours,
      dryRun: config.dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDatabases();
  }
}

main().catch((error) => {
  console.error('Retention cleanup failed:', error);
  process.exitCode = 1;
});
