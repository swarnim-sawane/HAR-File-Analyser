import dotenv from 'dotenv';
import { Worker } from 'bullmq';
import { connectDatabases } from './config/database';
import { processHarFile } from './workers/harProcessor';
import { processConsoleLog } from './workers/logProcessor';
import { getRedis } from './config/database';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import { setSocketIOInstance } from './utils/socketHelper'; // ADDED

dotenv.config();

async function startWorker() {
  try {
    console.log('🔧 Starting HAR Analyzer Worker...\n');
    
    // Connect to databases
    await connectDatabases();
    
    // Create a minimal HTTP server for Socket.IO (workers can emit events)
    const httpServer = createServer();
    const io = new SocketIOServer(httpServer, {
      cors: {
        origin: ['http://localhost:3000', 'http://localhost:5173'],
        methods: ['GET', 'POST']
      }
    });
    
    // Start on a different port (just for emitting)
    httpServer.listen(4001, () => {
      console.log('📡 Worker Socket.IO ready on port 4001');
    });
    
    setSocketIOInstance(io); // Store instance for workers
    
    const connection = getRedis();
    
    // HAR file processing worker
    const harWorker = new Worker(
      'har-processing',
      async (job) => {
        console.log(`\n[Worker] Processing HAR file job ${job.id}`);
        
        try {
          await processHarFile(job.data);
          return { success: true, fileId: job.data.fileId };
        } catch (error) {
          console.error(`[Worker] Failed to process HAR file:`, error);
          throw error;
        }
      },
      {
        connection,
        concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2'),
        limiter: {
          max: 5,
          duration: 1000
        }
      }
    );
    
    // Console log processing worker
    const logWorker = new Worker(
      'log-processing',
      async (job) => {
        console.log(`\n[Worker] Processing console log job ${job.id}`);
        
        try {
          await processConsoleLog(job.data);
          return { success: true, fileId: job.data.fileId };
        } catch (error) {
          console.error(`[Worker] Failed to process console log:`, error);
          throw error;
        }
      },
      {
        connection,
        concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2'),
        limiter: {
          max: 5,
          duration: 1000
        }
      }
    );
    
    // Event handlers
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
    console.log(`📊 Concurrency: ${process.env.WORKER_CONCURRENCY || '2'}`);
    console.log('=================================\n');
    
  } catch (error) {
    console.error('❌ Failed to start worker:', error);
    process.exit(1);
  }
}

startWorker();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n⏳ SIGTERM received, stopping workers...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n⏳ SIGINT received, stopping workers...');
  process.exit(0);
});
