import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import { connectDatabases, closeDatabases, getDatabase, getRedis } from './config/database';
import { configureOutboundProxy } from './config/outboundProxy';
import { buildAllowedOrigins, isOriginAllowed } from './config/corsOrigins';
import { setSocketIOInstance } from './utils/socketHelper';
import { buildOpenApiDocument, renderOpenApiDocsHtml } from './openapiSpec';
import {
  cleanupExpiredAnalysisData,
  parseRetentionCleanupConfig,
} from './services/retentionCleanupService';
import { getArtifactStore } from './services/artifactStore';
import { getRuntimeBinding } from './config/runtimeBinding';

dotenv.config();
const outboundProxyUrl = configureOutboundProxy();
if (outboundProxyUrl) {
  console.log(`Outbound AI proxy configured: ${new URL(outboundProxyUrl).host}`);
}

const app = express();
const server = http.createServer(app);
const { host: HOST, port: PORT } = getRuntimeBinding(process.env, 4000);
const ALLOWED_ORIGINS = buildAllowedOrigins();
let applicationReady = false;
let startupError: string | null = null;
let buildOpsStatus: (() => Promise<{ status: string; [key: string]: unknown }>) | undefined;
let redisSubscriber: any = null;
let retentionCleanupTimer: NodeJS.Timeout | null = null;

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin, ALLOWED_ORIGINS)) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT?.trim() || '10mb';
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin, ALLOWED_ORIGINS)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.locals.io = io;
setSocketIOInstance(io);

app.get('/health', (_req, res) => {
  res.status(startupError ? 503 : 200).json({
    status: startupError ? 'error' : 'ok',
    timestamp: new Date().toISOString(),
    ...(startupError ? { error: startupError } : {}),
  });
});

app.get('/ready', async (_req, res) => {
  if (!applicationReady || !buildOpsStatus) {
    return res.status(503).json({
      status: 'error',
      color: 'red',
      timestamp: new Date().toISOString(),
      error: startupError || 'Application initialization is still in progress.',
    });
  }

  try {
    const status = await buildOpsStatus();
    return res.status(status.status === 'error' ? 503 : 200).json(status);
  } catch (error) {
    return res.status(503).json({
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

function getOpenApiServerUrl(req: express.Request): string {
  const configuredUrl = process.env.OPENAPI_SERVER_URL || process.env.PUBLIC_API_URL;
  if (configuredUrl) return configuredUrl;

  const forwardedProto = req.get('x-forwarded-proto');
  const forwardedHost = req.get('x-forwarded-host');
  const proto = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host') || `localhost:${PORT}`;

  return `${proto}://${host}`;
}

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
async function setupRedisSubscriber(io: SocketIOServer) {
  const redis = getRedis();
  const subscriber = redis.duplicate();

  // ✅ OLD CLIENT: Use 'message' event listener
  subscriber.on('message', (_channel: string, message: string) => {
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

      console.log(`📨 Redis event received: ${type}`, data);

      if (scope === 'global') {
        io.emit(type, data);
        console.log(`✅ Broadcasted ${type} to all clients`);
      } else if (scope === 'file' && room) {
        io.to(room).emit(type, data);
        console.log(`✅ Emitted ${type} to room ${room}`);
      } else if (data?.fileId) {
        io.to(`file:${data.fileId}`).emit(type, data);
        console.log(`✅ Emitted ${type} to room file:${data.fileId}`);
      } else {
        io.emit(type, data);
        console.log(`✅ Broadcasted ${type} to all clients`);
      }
    } catch (err) {
      console.error('❌ Failed to parse Redis message:', err);
    }
  });
  subscriber.on('error', (error: Error) => {
    console.error('Redis subscriber error:', error);
  });

  // ✅ OLD CLIENT: Subscribe without callback
  await subscriber.connect();
  await subscriber.subscribe('socket:events');
  console.log('✅ Subscribed to Redis socket:events channel');

  return subscriber;
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
        database: getDatabase(),
        redis: getRedis(),
        artifactStore: getArtifactStore(),
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

async function initializeApplication() {
  try {
    console.log('🚀 Starting HAR Analyzer Backend...\n');

    // 1. Connect to databases FIRST
    await connectDatabases();
    await getArtifactStore().probe();
    console.log('');

    // 2. Set up Redis subscriber for worker events
    redisSubscriber = await setupRedisSubscriber(io);
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
    buildOpsStatus = opsModule.buildOpsStatus;

    // 5. Register routes
    app.use('/api/upload', uploadRoutes);
    app.use('/api/har', harRoutes);
    app.use('/api/console-log', consoleLogRoutes);
    app.use('/api/ai', aiRoutes);
    app.use('/api/sanitize', sanitizeRoutes);
    app.use('/api/v1', automationRoutes);
    app.use('/api/ops', opsRoutes);

    const staticDirectory = process.env.STATIC_DIR
      ? path.resolve(process.env.STATIC_DIR)
      : null;
    if (staticDirectory) {
      app.use(express.static(staticDirectory, { index: false }));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
        return res.sendFile(path.join(staticDirectory, 'index.html'));
      });
      console.log(`Serving frontend assets from ${staticDirectory}`);
    }

    startupError = null;
    applicationReady = true;
    console.log('Application dependencies initialized; readiness is now active.');

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    startupError = error instanceof Error ? error.message : 'Application initialization failed.';
    applicationReady = false;
  }
}

async function shutdown(): Promise<void> {
  if (!server.listening) return;
  applicationReady = false;
  console.log('\nShutting down gracefully...');

  if (redisSubscriber) {
    await redisSubscriber.unsubscribe('socket:events').catch(() => undefined);
    await redisSubscriber.quit().catch(() => undefined);
    console.log('Redis subscriber closed');
  }

  if (retentionCleanupTimer) {
    clearInterval(retentionCleanupTimer);
    console.log('Retention cleanup timer stopped');
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDatabases().catch(() => undefined);
  console.log('Server closed');
}

process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
  console.log('WebSocket server ready');
  console.log('CORS enabled for:');
  ALLOWED_ORIGINS.forEach((origin) => console.log(`   - ${origin}`));
  void initializeApplication();
});
