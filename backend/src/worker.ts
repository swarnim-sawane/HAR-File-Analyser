import dotenv from 'dotenv';
import { closeDatabases, connectDatabases, getOracleQueue } from './config/database';
import { HAR_QUEUE_NAME, LOG_QUEUE_NAME } from './config/queueNames';
import { processHarFile } from './workers/harProcessor';
import { processConsoleLog } from './workers/logProcessor';
import { logError, logInfo, measureDurationMs } from './config/observability';
import { OracleQueueWorker } from './runtime/oracleRuntime';

dotenv.config();

let harWorker: OracleQueueWorker | null = null;
let logWorker: OracleQueueWorker | null = null;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n⏳ ${signal} received, stopping workers...`);

  await Promise.allSettled([
    harWorker?.close(),
    logWorker?.close(),
  ]);

  await closeDatabases().catch((error) => {
    console.error('❌ Failed to close worker database connections:', error);
  });

  process.exit(0);
}

async function startWorker() {
  try {
    console.log('🔧 Starting HAR Analyzer Worker...\n');

    await connectDatabases();
    const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);
    const pollIntervalMs = parseInt(process.env.ORACLE_QUEUE_POLL_INTERVAL_MS || '500', 10);
    logInfo('worker.starting', { concurrency });

    harWorker = new OracleQueueWorker(
      getOracleQueue(HAR_QUEUE_NAME),
      async (job) => {
        const startedAt = Date.now();
        console.log(`\n[Worker] Processing HAR file job ${job.id}`);
        logInfo('worker.job.started', {
          queue: HAR_QUEUE_NAME,
          jobId: job.id,
          fileId: job.data.fileId,
          fileType: job.data.fileType,
          fileSize: job.data.fileSize,
        });

        try {
          await processHarFile(job.data);
          logInfo('worker.job.completed', {
            queue: HAR_QUEUE_NAME,
            jobId: job.id,
            fileId: job.data.fileId,
            durationMs: measureDurationMs(startedAt),
          });
          return { success: true, fileId: job.data.fileId };
        } catch (error) {
          console.error('[Worker] Failed to process HAR file:', error);
          logError('worker.job.failed', {
            queue: HAR_QUEUE_NAME,
            jobId: job.id,
            fileId: job.data.fileId,
            error,
            durationMs: measureDurationMs(startedAt),
          });
          throw error;
        }
      },
      { concurrency, pollIntervalMs }
    );

    logWorker = new OracleQueueWorker(
      getOracleQueue(LOG_QUEUE_NAME),
      async (job) => {
        const startedAt = Date.now();
        console.log(`\n[Worker] Processing console log job ${job.id}`);
        logInfo('worker.job.started', {
          queue: LOG_QUEUE_NAME,
          jobId: job.id,
          fileId: job.data.fileId,
          fileType: job.data.fileType,
          fileSize: job.data.fileSize,
        });

        try {
          await processConsoleLog(job.data);
          logInfo('worker.job.completed', {
            queue: LOG_QUEUE_NAME,
            jobId: job.id,
            fileId: job.data.fileId,
            durationMs: measureDurationMs(startedAt),
          });
          return { success: true, fileId: job.data.fileId };
        } catch (error) {
          console.error('[Worker] Failed to process console log:', error);
          logError('worker.job.failed', {
            queue: LOG_QUEUE_NAME,
            jobId: job.id,
            fileId: job.data.fileId,
            error,
            durationMs: measureDurationMs(startedAt),
          });
          throw error;
        }
      },
      { concurrency, pollIntervalMs }
    );

    harWorker.start();
    logWorker.start();

    harWorker.on('completed', (job) => {
      console.log(`✅ [Worker] HAR job ${job.id} completed`);
    });

    harWorker.on('failed', (job, err) => {
      console.error(`❌ [Worker] HAR job ${job?.id} failed:`, err.message);
    });

    logWorker.on('completed', (job) => {
      console.log(`✅ [Worker] Log job ${job.id} completed`);
    });

    logWorker.on('failed', (job, err) => {
      console.error(`❌ [Worker] Log job ${job?.id} failed:`, err.message);
    });

    console.log('\n=================================');
    console.log('👷 Workers started successfully');
    console.log(`📊 Concurrency per process: ${concurrency}`);
    console.log('📡 WebSocket delivery: Oracle runtime event bridge via backend');
    console.log('=================================\n');
    logInfo('worker.started', { concurrency });
  } catch (error) {
    console.error('❌ Failed to start worker:', error);
    logError('worker.start.failed', { error });
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

startWorker();
