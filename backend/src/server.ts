import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import { connectDatabases, closeDatabases, getPersistenceDb, getRuntimeCache, getEventBus } from './config/database';
import { configureOutboundProxy } from './config/outboundProxy';
import { buildAllowedOrigins } from './config/corsOrigins';
import { setSocketIOInstance } from './utils/socketHelper';
import { buildOpenApiDocument, renderOpenApiDocsHtml } from './openapiSpec';
import {
  cleanupExpiredAnalysisData,
  parseRetentionCleanupConfig,
} from './services/retentionCleanupService';

dotenv.config();
const outboundProxyUrl = configureOutboundProxy();
if (outboundProxyUrl) {
  console.log(`🌐 Outbound OCA proxy configured: ${new URL(outboundProxyUrl).host}`);
}

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGINS = buildAllowedOrigins();

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

function getOpenApiServerUrl(req: express.Request): string {
  const configuredUrl = process.env.OPENAPI_SERVER_URL || process.env.PUBLIC_API_URL;
  if (configuredUrl) return configuredUrl;

  const forwardedProto = req.get('x-forwarded-proto');
  const forwardedHost = req.get('x-forwarded-host');
  const proto = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host') || `localhost:${PORT}`;

  return `${proto}://${host}`;
}

// ✅ NEW: Helper to get file status from Oracle runtime cache
async function getFileStatusFromRuntimeCache(fileId: string) {
  try {
    const metadata = await getRuntimeCache().get(`file:${fileId}:metadata`);
    if (metadata) {
      return JSON.parse(metadata);
    }
  } catch (err) {
    console.error('Failed to get file status from Oracle runtime cache:', err);
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
    const status = await getFileStatusFromRuntimeCache(fileId);
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

      // Build context from Qdrant, or from stored Oracle JSON data when vectors are unavailable.
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

function dispatchSocketEnvelope(io: SocketIOServer, message: string): void {
  try {
    const {
      type,
      data,
      scope,
      room,
    } = JSON.parse(message) as {
      type: string;
      data: any;
      scope?: 'file' | 'global';
      room?: string;
    };

    console.log(`Runtime event received: ${type}`, data);

    if (scope === 'global') {
      io.emit(type, data);
      console.log(`Broadcasted ${type} to all clients`);
    } else if (scope === 'file' && room) {
      io.to(room).emit(type, data);
      console.log(`Emitted ${type} to room ${room}`);
    } else if (data?.fileId) {
      io.to(`file:${data.fileId}`).emit(type, data);
      console.log(`Emitted ${type} to room file:${data.fileId}`);
    } else {
      io.emit(type, data);
      console.log(`Broadcasted ${type} to all clients`);
    }
  } catch (err) {
    console.error('Failed to parse runtime event message:', err);
  }
}

function setupOracleRuntimeEventBridge(io: SocketIOServer): NodeJS.Timeout {
  const configuredInterval = Number.parseInt(process.env.ORACLE_EVENT_POLL_INTERVAL_MS || '250', 10);
  const pollIntervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0 ? configuredInterval : 250;
  let lastIndex = 0;
  let polling = false;

  const poll = async () => {
    if (polling) return;
    polling = true;

    try {
      const events = await getEventBus().poll('socket:events', lastIndex, 100);
      for (const event of events) {
        lastIndex = Math.max(lastIndex, event.index);
        dispatchSocketEnvelope(io, event.message);
      }
    } catch (error) {
      console.error('Failed to poll Oracle runtime events:', error);
    } finally {
      polling = false;
    }
  };

  void poll();
  const timer = setInterval(() => void poll(), pollIntervalMs);
  console.log('Subscribed to Oracle runtime socket:events stream');
  return timer;
}

function setupRetentionCleanup(): NodeJS.Timeout | null {
  const config = parseRetentionCleanupConfig(process.env);
  if (!config.enabled) {
    console.log('Retention cleanup disabled. Set RETENTION_CLEANUP_ENABLED=true to enable scheduled cleanup.');
    return null;
  }

  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
  const processedDir = path.resolve(process.env.PROCESSED_DIR || path.join(process.cwd(), 'processed'));

  const runCleanup = async () => {
    try {
      const result = await cleanupExpiredAnalysisData({
        db: getPersistenceDb(),
        runtimeCache: getRuntimeCache(),
        uploadDir,
        processedDir,
        maxAgeHours: config.maxAgeHours,
        dryRun: config.dryRun,
      });
      console.log('Retention cleanup complete:', result);
    } catch (error) {
      console.error('Retention cleanup failed:', error);
    }
  };

  console.log(
    `Retention cleanup enabled: maxAge=${config.maxAgeHours}h interval=${config.intervalMinutes}m dryRun=${config.dryRun}`,
  );
  void runCleanup();
  return setInterval(runCleanup, config.intervalMinutes * 60 * 1000);
}

async function startServer() {
  let runtimeEventBridgeTimer: NodeJS.Timeout | null = null;
  let retentionCleanupTimer: NodeJS.Timeout | null = null;

  try {
    console.log('🚀 Starting HAR Analyzer Backend...\n');

    // 1. Connect to databases FIRST
    await connectDatabases();
    console.log('');

    // 2. Set up Oracle runtime event bridge for worker events
    runtimeEventBridgeTimer = setupOracleRuntimeEventBridge(io);
    retentionCleanupTimer = setupRetentionCleanup();

    // 3. Import routes AFTER database connection
    const uploadRoutes = (await import('./routes/uploadRoutes')).default;
    const harRoutes = (await import('./routes/harRoutes')).default;
    const consoleLogRoutes = (await import('./routes/consoleLogRoutes')).default;
    const aiRoutes = (await import('./routes/aiRoutes')).default;
    const sanitizeRoutes = (await import('./routes/sanitizeRoutes')).default;
    const automationRoutes = (await import('./routes/automationRoutes')).default;
    const opsModule = await import('./routes/opsRoutes');
    const opsRoutes = opsModule.default;

    // 4. Health check endpoint
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          documentStore: 'oracle-json-connected',
          cache: 'connected',
          oracleJson: 'connected',
          qdrant: 'connected'
        }
      });
    });

    app.get('/ready', async (_req, res) => {
      try {
        const status = await opsModule.buildOpsStatus();
        res.status(status.status === 'error' ? 503 : 200).json(status);
      } catch (error) {
        res.status(503).json({
          status: 'error',
          color: 'red',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Readiness check failed',
        });
      }
    });

    app.get('/openapi.json', (req, res) => {
      res.json(buildOpenApiDocument(getOpenApiServerUrl(req)));
    });

    app.get('/api-docs', (_req, res) => {
      res.type('html').send(renderOpenApiDocsHtml('/openapi.json'));
    });

    // 5. Register routes
    app.use('/api/upload', uploadRoutes);
    app.use('/api/har', harRoutes);
    app.use('/api/console-log', consoleLogRoutes);
    app.use('/api/ai', aiRoutes);
    app.use('/api/sanitize', sanitizeRoutes);
    app.use('/api/v1', automationRoutes);
    app.use('/api/ops', opsRoutes);

    // 6. Start HTTP server
    server.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
      console.log(`📡 WebSocket server ready`);
      console.log(`🔔 Oracle runtime event bridge active`);
      console.log(`🌐 CORS enabled for:`);
      ALLOWED_ORIGINS.forEach(origin => {
        console.log(`   - ${origin}`);
      });
      console.log(`\n✨ Ready to accept requests!\n`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n⏳ Shutting down gracefully...');

      if (runtimeEventBridgeTimer) {
        clearInterval(runtimeEventBridgeTimer);
        console.log('Oracle runtime event bridge stopped');
      }

      if (retentionCleanupTimer) {
        clearInterval(retentionCleanupTimer);
        console.log('Retention cleanup timer stopped');
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
