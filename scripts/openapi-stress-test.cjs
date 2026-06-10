/* eslint-disable no-console */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { performance } = require('perf_hooks');

const BASE_URL = process.env.STRESS_BASE_URL || process.env.OPENAPI_TEST_BASE_URL || 'http://localhost:4200';
const WORK_DIR = process.env.STRESS_WORK_DIR || 'C:\\tmp\\har-openapi-stress';
const UPLOAD_DIR = process.env.STRESS_UPLOAD_DIR || process.env.UPLOAD_DIR || path.join(WORK_DIR, 'uploads');
const PROCESSED_DIR = process.env.STRESS_PROCESSED_DIR || process.env.PROCESSED_DIR || path.join(WORK_DIR, 'processed');
const GENERATED_DIR = path.join(WORK_DIR, 'generated');
const TEST_PREFIX = `stress_${Date.now()}_${process.pid}`;

const SIZE_MB = Number.parseInt(process.env.STRESS_SIZE_MB || '1024', 10);
const ENTRY_COUNT = Number.parseInt(process.env.STRESS_ENTRIES || '64', 10);
const CHUNK_MB = Number.parseInt(process.env.STRESS_CHUNK_MB || '8', 10);
const TIMEOUT_MS = Number.parseInt(process.env.STRESS_TIMEOUT_MS || '1800000', 10);
const KEEP_FILES = process.env.STRESS_KEEP_FILES === '1';
const PROFILE = process.env.STRESS_PROFILE || 'gb';
const STREAM_UPLOAD = process.env.STRESS_STREAM_UPLOAD === '1';

const ONE_MB = 1024 * 1024;
const TARGET_BYTES = SIZE_MB * ONE_MB;
const CHUNK_BYTES = CHUNK_MB * ONE_MB;
const HAR_STORAGE_TEXT_LIMIT_BYTES = 256 * 1024;
const LARGE_TEXT_BLOCK = 'x'.repeat(ONE_MB);
const LARGE_TEXT_BUFFER = Buffer.alloc(ONE_MB, 'x');

const timings = [];
const warnings = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function now() {
  return performance.now();
}

function elapsed(started) {
  return Math.round(performance.now() - started);
}

function record(name, started, details = '') {
  timings.push({ name, ms: elapsed(started), details });
}

function recordMs(name, ms, details = '') {
  timings.push({ name, ms: Math.round(ms), details });
}

function warn(message) {
  warnings.push(message);
  console.warn(`WARN ${message}`);
}

function mb(bytes) {
  return (bytes / ONE_MB).toFixed(1);
}

function write(stream, value) {
  return new Promise((resolve, reject) => {
    if (stream.write(value)) return resolve();
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
}

async function request(method, route, options = {}) {
  const { expectedStatus = 200, body, form, parseJson = true } = options;
  const started = now();
  const init = { method, headers: {} };

  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (form) init.body = form;

  const response = await fetch(`${BASE_URL}${route}`, init);
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const json = parseJson && text && contentType.includes('application/json') ? JSON.parse(text) : null;

  assert(
    response.status === expectedStatus,
    `${method} ${route} expected ${expectedStatus}, got ${response.status}: ${text.slice(0, 600)}`,
  );

  return { response, text, json, ms: elapsed(started) };
}

function entryPrefix(index, status, bodyBytes) {
  const method = index % 3 === 0 ? 'POST' : 'GET';
  const domain = status >= 500 ? 'ords-stress.example.com' : status >= 400 ? 'idcs-stress.example.com' : `bulk${index % 11}.example.com`;
  const url = `https://${domain}/stress/resource/${index % 500}`;
  const time = status >= 500 ? 1800 + (index % 300) : status >= 400 ? 240 + (index % 120) : 60 + (index % 90);
  return [
    '{',
    `"startedDateTime":"${new Date(Date.UTC(2026, 4, 26, 12, 0, index % 60)).toISOString()}",`,
    `"time":${time},`,
    `"request":{"method":"${method}","url":"${url}","httpVersion":"HTTP/2","headers":[],"queryString":[],"cookies":[],"headersSize":128,"bodySize":0},`,
    `"response":{"status":${status},"statusText":"${status >= 500 ? 'Server Error' : status >= 400 ? 'Client Error' : 'OK'}","httpVersion":"HTTP/2","headers":[{"name":"content-type","value":"application/json"}],"cookies":[],"content":{"size":${bodyBytes},"mimeType":"application/json","text":"`,
  ].join('');
}

function statusForEntry(index) {
  return index % 97 === 0 ? 503 : index % 10 === 0 ? 404 : 200;
}

function getBodyBytesPerEntry() {
  assert(ENTRY_COUNT > 0, 'STRESS_ENTRIES must be greater than 0');

  let bodyBytesPerEntry = Math.max(0, Math.floor((TARGET_BYTES - computeGeneratedHarSize(0)) / ENTRY_COUNT));

  for (let pass = 0; pass < 4; pass += 1) {
    const generatedSize = computeGeneratedHarSize(bodyBytesPerEntry);
    const nonBodyBytes = generatedSize - bodyBytesPerEntry * ENTRY_COUNT;
    bodyBytesPerEntry = Math.max(0, Math.floor((TARGET_BYTES - nonBodyBytes) / ENTRY_COUNT));
  }

  return bodyBytesPerEntry;
}

function computeGeneratedHarSize(bodyBytesPerEntry) {
  let total = Buffer.byteLength('{"log":{"version":"1.2","creator":{"name":"OpenAPI stress generator","version":"1.0"},"entries":[');

  for (let index = 0; index < ENTRY_COUNT; index += 1) {
    if (index > 0) total += 1;
    const status = statusForEntry(index);
    total += Buffer.byteLength(entryPrefix(index, status, bodyBytesPerEntry));
    total += bodyBytesPerEntry;
    total += Buffer.byteLength(entrySuffix(index, bodyBytesPerEntry));
  }

  total += Buffer.byteLength(']}}');
  return total;
}

function entrySuffix(index, bodyBytes) {
  return [
    '"},',
    '"redirectURL":"",',
    '"headersSize":128,',
    `"bodySize":${bodyBytes}},`,
    '"cache":{},',
    `"timings":{"blocked":0,"dns":0,"connect":0,"send":1,"wait":${100 + (index % 500)},"receive":4,"ssl":0},`,
    '"serverIPAddress":"10.0.0.10",',
    `"connection":"${index}"`,
    '}',
  ].join('');
}

async function generateStressHar(filePath) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const started = now();
  const stream = fs.createWriteStream(filePath, { flags: 'w' });
  stream.setMaxListeners(0);

  await write(stream, '{"log":{"version":"1.2","creator":{"name":"OpenAPI stress generator","version":"1.0"},"entries":[');

  const bodyBytesPerEntry = getBodyBytesPerEntry();

  for (let index = 0; index < ENTRY_COUNT; index += 1) {
    if (index > 0) await write(stream, ',');
    const status = statusForEntry(index);
    await write(stream, entryPrefix(index, status, bodyBytesPerEntry));

    let remaining = bodyBytesPerEntry;
    while (remaining > 0) {
      const size = Math.min(remaining, ONE_MB);
      await write(stream, size === ONE_MB ? LARGE_TEXT_BLOCK : 'x'.repeat(size));
      remaining -= size;
    }

    await write(stream, entrySuffix(index, bodyBytesPerEntry));
  }

  await write(stream, ']}}');
  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on('error', reject);
  });

  const stats = await fsp.stat(filePath);
  record(`generate ${path.basename(filePath)}`, started, `${mb(stats.size)} MB, ${ENTRY_COUNT} entries`);
  return stats.size;
}

function* appendToChunkBuffer(state, data) {
  let cursor = 0;
  while (cursor < data.length) {
    const take = Math.min(CHUNK_BYTES - state.offset, data.length - cursor);
    data.copy(state.current, state.offset, cursor, cursor + take);
    state.offset += take;
    cursor += take;

    if (state.offset === CHUNK_BYTES) {
      yield state.current;
      state.current = Buffer.allocUnsafe(CHUNK_BYTES);
      state.offset = 0;
    }
  }
}

function* generateStressHarChunkBuffers() {
  const state = {
    current: Buffer.allocUnsafe(CHUNK_BYTES),
    offset: 0,
  };
  const bodyBytesPerEntry = getBodyBytesPerEntry();

  const appendString = function* appendString(value) {
    yield* appendToChunkBuffer(state, Buffer.from(value));
  };

  yield* appendString('{"log":{"version":"1.2","creator":{"name":"OpenAPI stress generator","version":"1.0"},"entries":[');

  for (let index = 0; index < ENTRY_COUNT; index += 1) {
    if (index > 0) yield* appendString(',');
    const status = statusForEntry(index);
    yield* appendString(entryPrefix(index, status, bodyBytesPerEntry));

    let remaining = bodyBytesPerEntry;
    while (remaining > 0) {
      if (remaining >= ONE_MB) {
        yield* appendToChunkBuffer(state, LARGE_TEXT_BUFFER);
        remaining -= ONE_MB;
      } else {
        yield* appendToChunkBuffer(state, Buffer.alloc(remaining, 'x'));
        remaining = 0;
      }
    }

    yield* appendString(entrySuffix(index, bodyBytesPerEntry));
  }

  yield* appendString(']}}');

  if (state.offset > 0) {
    yield state.current.subarray(0, state.offset);
  }
}

async function uploadGeneratedHar(fileId, fileName) {
  const bodyBytesPerEntry = getBodyBytesPerEntry();
  const totalSize = computeGeneratedHarSize(bodyBytesPerEntry);
  const totalChunks = Math.ceil(totalSize / CHUNK_BYTES);
  const started = now();
  let index = 0;
  let uploadedBytes = 0;

  for (const chunk of generateStressHarChunkBuffers()) {
    const form = new FormData();
    form.append('fileId', fileId);
    form.append('chunkIndex', String(index));
    form.append('totalChunks', String(totalChunks));
    form.append('chunk', new Blob([chunk]), `${fileName}.part${index}`);

    const result = await request('POST', '/api/upload/chunk', { form });
    assert(result.json.success === true, `generated chunk ${index} failed`);

    index += 1;
    uploadedBytes += chunk.length;
    if (index % 25 === 0 || index === totalChunks) {
      console.log(`Stream-generated and uploaded ${index}/${totalChunks} chunks (${mb(uploadedBytes)} MB)`);
    }
  }

  assert(index === totalChunks, `generated ${index} chunks but expected ${totalChunks}`);

  const complete = await request('POST', '/api/upload/complete', {
    body: {
      fileId,
      totalChunks,
      fileName,
      fileType: 'har',
    },
  });
  assert(complete.json.success === true, 'complete upload failed');
  record(`stream-generate+upload ${fileName}`, started, `${mb(totalSize)} MB, ${totalChunks} chunks`);
  return totalSize;
}

async function uploadFile(filePath, fileId, fileName) {
  const stat = await fsp.stat(filePath);
  const totalChunks = Math.ceil(stat.size / CHUNK_BYTES);
  const handle = await fsp.open(filePath, 'r');
  const started = now();

  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const size = Math.min(CHUNK_BYTES, stat.size - index * CHUNK_BYTES);
      const buffer = Buffer.allocUnsafe(size);
      await handle.read(buffer, 0, size, index * CHUNK_BYTES);

      const form = new FormData();
      form.append('fileId', fileId);
      form.append('chunkIndex', String(index));
      form.append('totalChunks', String(totalChunks));
      form.append('chunk', new Blob([buffer]), `${fileName}.part${index}`);

      const result = await request('POST', '/api/upload/chunk', { form });
      assert(result.json.success === true, `chunk ${index} failed`);

      if ((index + 1) % 25 === 0 || index + 1 === totalChunks) {
        console.log(`Uploaded ${index + 1}/${totalChunks} chunks (${mb(Math.min(stat.size, (index + 1) * CHUNK_BYTES))} MB)`);
      }
    }
  } finally {
    await handle.close();
  }

  const complete = await request('POST', '/api/upload/complete', {
    body: {
      fileId,
      totalChunks,
      fileName,
      fileType: 'har',
    },
  });
  assert(complete.json.success === true, 'complete upload failed');
  record(`upload ${fileName}`, started, `${mb(stat.size)} MB, ${totalChunks} chunks`);
}

async function pollReady(fileId) {
  const started = now();
  let lastStatus = null;

  while (elapsed(started) < TIMEOUT_MS) {
    const status = await request('GET', `/api/har/${fileId}/status`);
    lastStatus = status.json.status;
    if (lastStatus === 'ready') {
      record(`process ${fileId}`, started, `${status.json.totalEntries} entries`);
      return status.json;
    }
    if (lastStatus === 'error') {
      throw new Error(`${fileId} failed processing: ${JSON.stringify(status.json)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`${fileId} did not become ready within ${TIMEOUT_MS}ms; last status=${lastStatus}`);
}

async function exerciseEndpoints(fileId, expectedEntries) {
  const summary = await request('GET', `/api/v1/har/${fileId}/summary`);
  assert(summary.json.summary.totalRequests === expectedEntries, 'summary totalRequests mismatch');
  recordMs('v1 summary', summary.ms);
  if (summary.ms > 2000) warn(`v1 summary took ${summary.ms}ms`);

  const errors = await request('GET', `/api/v1/har/${fileId}/errors?limit=100&page=1`);
  assert(errors.json.pagination.totalEntries > 0, 'expected at least one generated error');
  assert(errors.json.entries.length <= 100, 'errors endpoint did not respect limit');
  recordMs('v1 errors page', errors.ms, `${errors.json.pagination.totalEntries} errors`);
  if (errors.ms > 2000) warn(`v1 errors page took ${errors.ms}ms`);

  const context = await request('GET', `/api/v1/har/${fileId}/insights/context`);
  assert(context.json.context.includes('HAR SUMMARY'), 'context missing summary');
  assert(context.json.context.length <= 12020, 'context is not bounded');
  recordMs('v1 insight context', context.ms, `${context.json.context.length} chars`);
  if (context.ms > 5000) warn(`v1 insight context took ${context.ms}ms`);

  const entries = await request('GET', `/api/har/${fileId}/entries?page=1&limit=25`);
  assert(entries.json.entries.length === Math.min(25, expectedEntries), 'entries pagination mismatch');
  recordMs('HAR entries page', entries.ms);

  const detail = await request('GET', `/api/har/${fileId}/entries/0`);
  assert(detail.json.index === 0, 'entry detail index mismatch');
  if (getBodyBytesPerEntry() > HAR_STORAGE_TEXT_LIMIT_BYTES) {
    assert(detail.json.storage?.truncatedFields?.includes('response.content.text'), 'large response body was not truncated before Oracle storage');
    recordMs('HAR entry detail truncation', detail.ms);
  } else {
    assert(!detail.json.storage?.truncatedFields?.includes('response.content.text'), 'small response body was unexpectedly truncated');
    recordMs('HAR entry detail no-truncation', detail.ms);
  }
}

async function cleanup(fileId) {
  if (!KEEP_FILES) {
    for (const dir of [UPLOAD_DIR, PROCESSED_DIR, GENERATED_DIR]) {
      try {
        const files = await fsp.readdir(dir);
        await Promise.all(files
          .filter((file) => file.includes(fileId) || file.startsWith(TEST_PREFIX))
          .map((file) => fsp.rm(path.join(dir, file), { force: true })));
      } catch {
        // Directory may not exist on failed early runs.
      }
    }
  }
}

async function main() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(PROCESSED_DIR, { recursive: true });
  await fsp.mkdir(GENERATED_DIR, { recursive: true });

  assert(CHUNK_BYTES <= 10 * ONE_MB, 'STRESS_CHUNK_MB must stay at or below 10 MB to remain under server multipart limit');

  const fileId = `${TEST_PREFIX}_${PROFILE}_${SIZE_MB}mb_${ENTRY_COUNT}entries`;
  const fileName = `${PROFILE}-${SIZE_MB}mb-${ENTRY_COUNT}entries.har`;
  const filePath = path.join(GENERATED_DIR, `${fileId}_${fileName}`);

  console.log(`Stress testing ${BASE_URL}`);
  console.log(`Profile=${PROFILE}, target=${SIZE_MB} MB, entries=${ENTRY_COUNT}, chunk=${CHUNK_MB} MB`);

  await cleanup(fileId);

  try {
    let generatedSize;
    if (STREAM_UPLOAD) {
      generatedSize = await uploadGeneratedHar(fileId, fileName);
    } else {
      generatedSize = await generateStressHar(filePath);
      await uploadFile(filePath, fileId, fileName);
    }
    const status = await pollReady(fileId);
    assert(status.totalEntries === ENTRY_COUNT, `expected ${ENTRY_COUNT} entries, got ${status.totalEntries}`);
    await exerciseEndpoints(fileId, ENTRY_COUNT);

    console.log('\nStress timings:');
    for (const timing of timings) {
      console.log(`${String(timing.ms).padStart(8)}ms  ${timing.name}${timing.details ? `  (${timing.details})` : ''}`);
    }
    if (warnings.length) {
      console.log('\nWarnings:');
      for (const item of warnings) console.log(`- ${item}`);
    }
    console.log(`\nPASS stress profile ${PROFILE}: ${mb(generatedSize)} MB, ${ENTRY_COUNT} entries.`);
  } finally {
    await cleanup(fileId);
  }
}

main().catch((error) => {
  console.error('\nFAIL OpenAPI stress test failed:');
  console.error(error);
  process.exitCode = 1;
});
