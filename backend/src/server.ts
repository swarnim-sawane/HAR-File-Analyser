import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import { connectDatabases, closeDatabases, getRedis } from './config/database';
import { setSocketIOInstance } from './utils/socketHelper';

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;

const ALLOWED_ORIGINS: string[] = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4000',
  ...(process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : [])
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const io = new SocketIOServer(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.locals.io = io;
setSocketIOInstance(io);

// ✅ NEW: Helper to get file status from Redis
async function getFileStatusFromRedis(fileId: string) {
  try {
    const redis = getRedis();
    const metadata = await redis.get(`file:${fileId}:metadata`);
    if (metadata) {
      return JSON.parse(metadata);
    }
  } catch (err) {
    console.error('Failed to get file status from Redis:', err);
  }
  return null;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('✓ Client connected:', socket.id);

  // ✅ FIXED: When client subscribes, send current status if already processed
  socket.on('subscribe:file', async (fileId: string) => {
    socket.join(`file:${fileId}`);
    console.log(`✓ Client subscribed to file: ${fileId}`);

    // ✅ NEW: Immediately send current status if file is already ready
    const status = await getFileStatusFromRedis(fileId);
    if (status && status.status === 'ready') {
      console.log(`📤 Sending cached status to client for ${fileId}`);
      socket.emit('file:status', {
        fileId,
        status: status.status,
        totalEntries: status.totalEntries,
        stats: status.stats,
        fileName: status.fileName
      });
    }
  });

  socket.on('ai:query', async (data: { fileId: string; query: string; fileType?: string }) => {
    const { fileId, query, fileType } = data;
    console.log('✓ AI query received for file:', fileId, '| query:', query);

    const messageId = Date.now().toString();

    try {
      // Lazy import ensures database is initialized before these are used
      const { queryWithContext } = await import('./services/embeddingService');
      const { streamLLMResponse } = await import('./services/ollamaPool');

      // Build context from Qdrant (with MongoDB fallback)
      const context = await queryWithContext(fileId, query, (fileType as 'har' | 'log') || 'har');

      // Stream LLM response token-by-token via WebSocket
      for await (const token of streamLLMResponse(query, context)) {
        socket.emit('ai:stream', { fileId, chunk: token, messageId });
      }

      socket.emit('ai:complete', { fileId, messageId });
      console.log(`✅ AI query complete for file: ${fileId}`);

    } catch (error) {
      console.error('❌ AI query processing error:', error);
      socket.emit('ai:error', {
        fileId,
        error: (error as Error).message || 'Failed to process AI query. Is Ollama running?'
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('✓ Client disconnected:', socket.id);
  });
});

/**
 * Set up Redis subscriber using async/await
 */
/**
 * Set up Redis subscriber using old Redis client (v3.x)
 */
function setupRedisSubscriber(io: SocketIOServer) {
  const redis = getRedis();
  const subscriber = redis.duplicate();

  // ✅ OLD CLIENT: Use 'message' event listener
  subscriber.on('message', (channel: string, message: string) => {
    try {
      const { type, data } = JSON.parse(message);

      console.log(`📨 Redis event received: ${type}`, data);

      // Emit to specific file room
      if (data.fileId) {
        io.to(`file:${data.fileId}`).emit(type, data);
        console.log(`✅ Emitted ${type} to room file:${data.fileId}`);
      } else {
        // Broadcast to all clients if no fileId
        io.emit(type, data);
        console.log(`✅ Broadcasted ${type} to all clients`);
      }
    } catch (err) {
      console.error('❌ Failed to parse Redis message:', err);
    }
  });

  // ✅ OLD CLIENT: Subscribe without callback
  subscriber.subscribe('socket:events');
  console.log('✅ Subscribed to Redis socket:events channel');

  return subscriber;
}

async function startServer() {
  let redisSubscriber: any = null;

  try {
    console.log('🚀 Starting HAR Analyzer Backend...\n');

    // 1. Connect to databases FIRST
    await connectDatabases();
    console.log('');

    // 2. Set up Redis subscriber for worker events
    redisSubscriber = await setupRedisSubscriber(io);

    // 3. Import routes AFTER database connection
    const uploadRoutes = (await import('./routes/uploadRoutes')).default;
    const harRoutes = (await import('./routes/harRoutes')).default;
    const consoleLogRoutes = (await import('./routes/consoleLogRoutes')).default;
    const aiRoutes = (await import('./routes/aiRoutes')).default;

    // 4. Health check endpoint
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          mongodb: 'connected',
          redis: 'connected',
          qdrant: 'connected'
        }
      });
    });

    // 5. Register routes
    app.use('/api/upload', uploadRoutes);
    app.use('/api/har', harRoutes);
    app.use('/api/console-log', consoleLogRoutes);
    app.use('/api/ai', aiRoutes);

    // 6. Start HTTP server
    server.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
      console.log(`📡 WebSocket server ready`);
      console.log(`🔔 Redis pub/sub bridge active`);
      console.log(`🌐 CORS enabled for:`);
      ALLOWED_ORIGINS.forEach(origin => {
        console.log(`   - ${origin}`);
      });
      console.log(`\n✨ Ready to accept requests!\n`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n⏳ Shutting down gracefully...');

      if (redisSubscriber) {
        await redisSubscriber.unsubscribe('socket:events');
        await redisSubscriber.quit();
        console.log('✅ Redis subscriber closed');
      }

      server.close(async () => {
        await closeDatabases();
        console.log('✅ Server closed');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
