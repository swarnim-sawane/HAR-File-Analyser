import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const backendDir = join(rootDir, 'backend');
const tmpDir = join(rootDir, '.tmp-smoke');
const uploadDir = join(tmpDir, 'uploads');
const processedDir = join(tmpDir, 'processed');
const frontendUrl = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:4173';
const backendUrl = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:4100';
const keepProcesses = process.env.SMOKE_KEEP_PROCESSES === '1';
const smokeId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const events = {
  upload: [],
  processing: [],
  status: [],
};

const children = [];

function prefixOutput(stream, label) {
  stream.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line) process.stdout.write(`[${label}] ${line}\n`);
    }
  });
}

function spawnNode(label, args, options) {
  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });

  prefixOutput(child.stdout, label);
  prefixOutput(child.stderr, `${label}:err`);

  child.on('exit', (code, signal) => {
    if (code !== 0 && !keepProcesses) {
      process.stderr.write(`[${label}] exited with code=${code} signal=${signal}\n`);
    }
  });

  children.push(child);
  return child;
}

async function waitFor(assertion, description, timeoutMs = 45000, intervalMs = 500) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await delay(intervalMs);
    }
  }

  throw new Error(`${description} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return { response, json, text };
}

async function verifyFrontend() {
  const { response, text } = await fetchJson(`${frontendUrl}/`);
  assert.equal(response.status, 200, 'frontend should respond on /');
  assert.match(text, /<div id="root">/i, 'frontend HTML should contain the root mount');
}

async function uploadFixture(socket, fixturePath, fileName, fileType) {
  const fileId = `smoke_${fileType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const body = await readFile(fixturePath);

  socket.emit('subscribe:file', fileId);

  const form = new FormData();
  form.set('chunk', new Blob([body]), fileName);
  form.set('fileId', fileId);
  form.set('chunkIndex', '0');
  form.set('totalChunks', '1');

  const chunkResult = await fetchJson(`${backendUrl}/api/upload/chunk`, {
    method: 'POST',
    body: form,
    headers: {
      'X-Session-Id': `smoke-session-${fileType}`,
    },
  });
  assert.equal(chunkResult.response.status, 200, `${fileType} chunk upload should succeed`);

  const completeResult = await fetchJson(`${backendUrl}/api/upload/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': `smoke-session-${fileType}`,
    },
    body: JSON.stringify({
      fileId,
      totalChunks: 1,
      fileName,
      fileType,
    }),
  });
  assert.equal(completeResult.response.status, 200, `${fileType} completion should succeed`);

  const statusRoute = fileType === 'har' ? 'har' : 'console-log';

  const finalStatus = await waitFor(async () => {
    const result = await fetchJson(`${backendUrl}/api/${statusRoute}/${fileId}/status`);
    assert.equal(result.response.status, 200, `${fileType} status endpoint should respond`);
    assert.ok(result.json?.status, `${fileType} status payload should contain status`);
    assert.notEqual(result.json.status, 'error', `${fileType} processing should not error`);
    assert.equal(result.json.status, 'ready', `${fileType} should reach ready status`);
    return result.json;
  }, `${fileType} ready status`);

  await waitFor(() => {
    assert.ok(
      events.upload.some((entry) => entry.fileId === fileId && entry.progress === 100),
      `${fileType} upload progress event should be observed`
    );
  }, `${fileType} upload progress event`);

  await waitFor(() => {
    assert.ok(
      events.processing.some((entry) => entry.fileId === fileId && entry.progress >= 80),
      `${fileType} processing progress event should be observed`
    );
  }, `${fileType} processing progress event`);

  await waitFor(() => {
    assert.ok(
      events.status.some((entry) => entry.fileId === fileId && entry.status === 'ready'),
      `${fileType} ready websocket status should be observed`
    );
  }, `${fileType} websocket ready event`);

  if (fileType === 'har') {
    const harPayload = await fetchJson(`${backendUrl}/api/har/${fileId}`);
    assert.equal(harPayload.response.status, 200, 'HAR payload should be retrievable');
    assert.equal(harPayload.json?.log?.entries?.length, 1, 'HAR payload should contain one entry');

    const harStats = await fetchJson(`${backendUrl}/api/har/${fileId}/stats`);
    assert.equal(harStats.response.status, 200, 'HAR stats should be retrievable');
    assert.equal(harStats.json?.totalRequests, 1, 'HAR stats should reflect one request');
  } else {
    const logEntries = await fetchJson(`${backendUrl}/api/console-log/${fileId}/entries?page=1&limit=10`);
    assert.equal(logEntries.response.status, 200, 'console log entries should be retrievable');
    assert.equal(logEntries.json?.entries?.length, 3, 'console log entries should contain three rows');

    const logStats = await fetchJson(`${backendUrl}/api/console-log/${fileId}/stats`);
    assert.equal(logStats.response.status, 200, 'console log stats should be retrievable');
    assert.equal(logStats.json?.totalLogs, 3, 'console log stats should reflect three lines');
  }

  return finalStatus;
}

async function main() {
  if (!existsSync(join(rootDir, 'dist', 'index.html'))) {
    throw new Error('Frontend build output is missing. Run `npm run build` first.');
  }
  if (!existsSync(join(backendDir, 'dist', 'server.js'))) {
    throw new Error('Backend build output is missing. Run `npm run build --prefix backend` first.');
  }

  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(uploadDir, { recursive: true });
  await mkdir(processedDir, { recursive: true });

  const frontend = spawnNode('frontend', ['scripts/serve-dist.mjs'], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '4173',
      STATIC_DIR: 'dist',
    },
  });

  const sharedBackendEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: '4100',
    CORS_ORIGIN: frontendUrl,
    UPLOAD_DIR: uploadDir,
    PROCESSED_DIR: processedDir,
    HAR_QUEUE_NAME: `har-processing-smoke-${smokeId}`,
    LOG_QUEUE_NAME: `log-processing-smoke-${smokeId}`,
    WORKER_CONCURRENCY: '1',
  };

  const backend = spawnNode('backend', ['dist/server.js'], {
    cwd: backendDir,
    env: sharedBackendEnv,
  });

  const workerOne = spawnNode('worker-1', ['dist/worker.js'], {
    cwd: backendDir,
    env: sharedBackendEnv,
  });

  const workerTwo = spawnNode('worker-2', ['dist/worker.js'], {
    cwd: backendDir,
    env: sharedBackendEnv,
  });

  await waitFor(async () => {
    const { response, json } = await fetchJson(`${backendUrl}/health`);
    assert.equal(response.status, 200, 'backend health endpoint should respond');
    assert.equal(json?.status, 'ok', 'backend health payload should be ok');
  }, 'backend health check', 60000);

  await waitFor(async () => {
    assert.equal(frontend.exitCode, null, 'frontend process should remain alive');
    assert.equal(backend.exitCode, null, 'backend process should remain alive');
    assert.equal(workerOne.exitCode, null, 'worker-1 should remain alive');
    assert.equal(workerTwo.exitCode, null, 'worker-2 should remain alive');
  }, 'spawned processes staying alive', 5000, 250);

  await verifyFrontend();

  const socket = io(backendUrl, {
    transports: ['websocket'],
    reconnection: false,
  });

  socket.on('upload:progress', (data) => events.upload.push(data));
  socket.on('processing:progress', (data) => events.processing.push(data));
  socket.on('file:status', (data) => events.status.push(data));

  await waitFor(() => {
    assert.equal(socket.connected, true, 'socket should connect to backend');
  }, 'socket connection');

  const aiStatus = await fetchJson(`${backendUrl}/api/ai/status`);
  assert.equal(aiStatus.response.status, 200, 'AI status endpoint should respond');
  assert.equal(typeof aiStatus.json?.connected, 'boolean', 'AI status should expose a boolean connected flag');

  const harStatus = await uploadFixture(
    socket,
    join(rootDir, 'scripts', 'fixtures', 'smoke.har'),
    'smoke.har',
    'har'
  );
  assert.equal(harStatus.status, 'ready', 'HAR smoke upload should complete');

  const logStatus = await uploadFixture(
    socket,
    join(rootDir, 'scripts', 'fixtures', 'smoke.log'),
    'smoke.log',
    'log'
  );
  assert.equal(logStatus.status, 'ready', 'console log smoke upload should complete');

  socket.disconnect();

  console.log('\nStable smoke test passed.');
  console.log('- Frontend static server booted without external tooling');
  console.log('- Backend booted and health check passed');
  console.log('- Two worker processes stayed alive together');
  console.log('- HAR and console-log upload/status/progress flows completed successfully');
  console.log('- AI status endpoint degraded gracefully');
}

try {
  await main();
} catch (error) {
  console.error('\nStable smoke test failed.');
  console.error(error instanceof Error ? error.message : error);
  console.error('Tip: ensure MongoDB, Redis, and Qdrant are running, for example via `docker compose -f backend/docker-compose.yml up -d`.');
  process.exitCode = 1;
} finally {
  if (!keepProcesses) {
    for (const child of children) {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }
    }
    await delay(1000);
  }
}
