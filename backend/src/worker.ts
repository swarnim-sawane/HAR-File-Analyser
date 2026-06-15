import dotenv from 'dotenv';
import { Worker } from 'bullmq';
import { closeDatabases, connectDatabases, getRedis } from './config/database';
import { HAR_QUEUE_NAME, LOG_QUEUE_NAME, VIDEO_QUEUE_NAME } from './config/queueNames';
import { processHarFile } from './workers/harProcessor';
import { processConsoleLog } from './workers/logProcessor';
import { analyzeVideoEvidence, markVideoEvidenceJobFailed, processVideoFile } from './workers/videoProcessor';

dotenv.config();

let harWorker: Worker | null = null;
let logWorker: Worker | null = null;
let videoWorker: Worker | null = null;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n⏳ ${signal} received, stopping workers...`);

  await Promise.allSettled([
    harWorker?.close(),
    logWorker?.close(),
    videoWorker?.close(),
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
    const connection = getRedis();
    const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);

    harWorker = new Worker(
      HAR_QUEUE_NAME,
      async (job) => {
        console.log(`\n[Worker] Processing HAR file job ${job.id}`);

        try {
          await processHarFile(job.data);
          return { success: true, fileId: job.data.fileId };
        } catch (error) {
          console.error('[Worker] Failed to process HAR file:', error);
          throw error;
        }
      },
      {
        connection,
        concurrency,
        limiter: {
          max: 5,
          duration: 1000,
        },
      }
    );

    logWorker = new Worker(
      LOG_QUEUE_NAME,
      async (job) => {
        console.log(`\n[Worker] Processing console log job ${job.id}`);

        try {
          await processConsoleLog(job.data);
          return { success: true, fileId: job.data.fileId };
        } catch (error) {
          console.error('[Worker] Failed to process console log:', error);
          throw error;
        }
      },
      {
        connection,
        concurrency,
        limiter: {
          max: 5,
          duration: 1000,
        },
      }
    );

    videoWorker = new Worker(
      VIDEO_QUEUE_NAME,
      async (job) => {
        console.log(`\n[Worker] Processing video evidence job ${job.id}`);

        try {
          if (job.name === 'analyze_video_evidence') {
            await analyzeVideoEvidence(job.data);
          } else {
            await processVideoFile(job.data);
          }
          return { success: true, fileId: job.data.fileId };
        } catch (error) {
          console.error('[Worker] Failed to process video evidence:', error);
          throw error;
        }
      },
      {
        connection,
        concurrency: Math.max(1, Math.min(concurrency, 2)),
        lockDuration: parseInt(process.env.VIDEO_WORKER_LOCK_DURATION_MS || '900000', 10),
        stalledInterval: parseInt(process.env.VIDEO_WORKER_STALLED_INTERVAL_MS || '60000', 10),
        limiter: {
          max: 2,
          duration: 1000,
        },
      }
    );

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

    videoWorker.on('completed', (job) => {
      console.log(`[Worker] Video evidence job ${job.id} completed`);
    });

    videoWorker.on('failed', (job, err) => {
      console.error(`[Worker] Video evidence job ${job?.id} failed:`, err.message);
      if (!job?.data?.fileId) return;

      void markVideoEvidenceJobFailed(job.data, err.message, job.name)
        .catch((updateError) => {
          console.error(`[Worker] Failed to mark video job ${job.id} as failed:`, updateError);
        });
    });

    console.log('\n=================================');
    console.log('👷 Workers started successfully');
    console.log(`📊 Concurrency per process: ${concurrency}`);
    console.log('📡 WebSocket delivery: Redis pub/sub via backend');
    console.log('=================================\n');
  } catch (error) {
    console.error('❌ Failed to start worker:', error);
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
