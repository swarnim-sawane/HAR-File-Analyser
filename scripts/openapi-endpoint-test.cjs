/* eslint-disable no-console */
const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { performance } = require('perf_hooks');

const gzip = promisify(zlib.gzip);

const BASE_URL = process.env.OPENAPI_TEST_BASE_URL || 'http://localhost:4100';
const TEST_UPLOAD_DIR = process.env.OPENAPI_TEST_UPLOAD_DIR || process.env.UPLOAD_DIR || 'C:\\tmp\\har-openapi-test\\uploads';
const TEST_PROCESSED_DIR = process.env.OPENAPI_TEST_PROCESSED_DIR || process.env.PROCESSED_DIR || 'C:\\tmp\\har-openapi-test\\processed';
const TEST_PREFIX = `openapi_test_${Date.now()}`;
const UPLOAD_TIMEOUT_MS = 120000;

const results = [];
const warnings = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function record(name, ms, details = '') {
  results.push({ name, ms: Math.round(ms), details });
}

function warn(message) {
  warnings.push(message);
  console.warn(`WARN ${message}`);
}

async function request(method, route, options = {}) {
  const {
    expectedStatus = 200,
    body,
    form,
    headers = {},
    parseJson = true,
  } = options;
  const started = performance.now();
  const init = { method, headers: { ...headers } };

  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  if (form) {
    init.body = form;
  }

  const response = await fetch(`${BASE_URL}${route}`, init);
  const text = await response.text();
  const ms = performance.now() - started;
  let json = null;
  const contentType = response.headers.get('content-type') || '';
  if (parseJson && contentType.includes('application/json') && text) {
    json = JSON.parse(text);
  }

  assert(
    response.status === expectedStatus,
    `${method} ${route} expected ${expectedStatus}, got ${response.status}: ${text.slice(0, 500)}`,
  );

  return { response, text, json, ms };
}

function makeEntry(index, overrides = {}) {
  const status = overrides.status ?? 200;
  const method = overrides.method || 'GET';
  const url = overrides.url || `https://app.example.com/resource/${index}`;
  const time = overrides.time ?? 100;
  const mimeType = overrides.mimeType || 'application/json';
  const responseText = overrides.responseText;
  const requestText = overrides.requestText;
  const bodySize = overrides.bodySize ?? (responseText ? Buffer.byteLength(responseText) : 128);

  return {
    startedDateTime: new Date(Date.UTC(2026, 4, 26, 10, 0, index % 60)).toISOString(),
    time,
    request: {
      method,
      url,
      httpVersion: 'HTTP/2',
      headers: [{ name: 'accept', value: 'application/json' }],
      queryString: [],
      cookies: [],
      headersSize: 128,
      bodySize: requestText ? Buffer.byteLength(requestText) : 0,
      ...(requestText
        ? { postData: { mimeType: 'application/json', text: requestText } }
        : {}),
    },
    response: {
      status,
      statusText: status >= 500 ? 'Server Error' : status >= 400 ? 'Client Error' : status >= 300 ? 'Redirect' : 'OK',
      httpVersion: 'HTTP/2',
      headers: [{ name: 'content-type', value: mimeType }],
      cookies: [],
      content: {
        size: bodySize,
        mimeType,
        ...(responseText !== undefined ? { text: responseText } : {}),
      },
      redirectURL: status >= 300 && status < 400 ? 'https://app.example.com/redirected' : '',
      headersSize: 128,
      bodySize,
    },
    cache: {},
    timings: {
      blocked: 0,
      dns: 0,
      connect: 0,
      send: 1,
      wait: overrides.wait ?? Math.max(1, time - 5),
      receive: 4,
      ssl: 0,
    },
    serverIPAddress: overrides.serverIPAddress || '10.0.0.10',
    connection: String(index),
  };
}

function makeHar(entries) {
  return Buffer.from(JSON.stringify({
    log: {
      version: '1.2',
      creator: { name: 'OpenAPI endpoint test', version: '1.0' },
      entries,
    },
  }));
}

async function uploadBuffer({ fileId, fileName, fileType, buffer, chunkSize = 1024 * 1024, compressed }) {
  const totalChunks = Math.ceil(buffer.length / chunkSize);
  const uploadStarted = performance.now();

  for (let i = 0; i < totalChunks; i += 1) {
    const chunk = buffer.subarray(i * chunkSize, Math.min(buffer.length, (i + 1) * chunkSize));
    const form = new FormData();
    form.append('fileId', fileId);
    form.append('chunkIndex', String(i));
    form.append('totalChunks', String(totalChunks));
    form.append('chunk', new Blob([chunk]), `${fileName}.part${i}`);

    const result = await request('POST', '/api/upload/chunk', { form });
    assert(result.json.success === true, `chunk ${i} did not return success`);
    assert(result.json.receivedChunks >= 1, `chunk ${i} missing receivedChunks`);
  }

  const complete = await request('POST', '/api/upload/complete', {
    body: {
      fileId,
      totalChunks,
      fileName,
      fileType,
      ...(compressed ? { compressed } : {}),
    },
  });
  assert(complete.json.success === true, 'complete upload did not return success');
  assert(complete.json.fileId === fileId, 'complete upload returned wrong fileId');

  record(`upload ${fileName}`, performance.now() - uploadStarted, `${buffer.length} bytes, ${totalChunks} chunks`);
  return complete.json;
}

async function pollReady(fileId, statusRoute) {
  const started = performance.now();
  let lastStatus = null;
  while (performance.now() - started < UPLOAD_TIMEOUT_MS) {
    const result = await request('GET', statusRoute, { expectedStatus: 200 });
    lastStatus = result.json.status;
    if (lastStatus === 'ready') {
      record(`process ${fileId}`, performance.now() - started, `${result.json.totalEntries} entries`);
      return result.json;
    }
    if (lastStatus === 'error') {
      throw new Error(`${fileId} entered error status: ${JSON.stringify(result.json)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`${fileId} did not become ready within ${UPLOAD_TIMEOUT_MS}ms; last status=${lastStatus}`);
}

async function cleanup() {
  for (const dir of [TEST_UPLOAD_DIR, TEST_PROCESSED_DIR]) {
    try {
      const files = await fs.readdir(dir);
      await Promise.all(files
        .filter((file) => file.startsWith(TEST_PREFIX) || file.startsWith(`sanitized_${TEST_PREFIX}`))
        .map((file) => fs.rm(path.join(dir, file), { force: true })));
    } catch {
      // Test directories are optional when this script is used only for contract checks.
    }
  }
}

function collectRefs(value, refs = []) {
  if (!value || typeof value !== 'object') return refs;
  if (typeof value.$ref === 'string') refs.push(value.$ref);
  for (const child of Object.values(value)) {
    collectRefs(child, refs);
  }
  return refs;
}

async function testContractEndpoints() {
  const health = await request('GET', '/health');
  assert(health.json.status === 'ok', 'health did not return ok');
  record('GET /health', health.ms);

  const spec = await request('GET', '/openapi.json');
  assert(spec.json.openapi === '3.0.3', 'OpenAPI version mismatch');
  assert(spec.json.paths['/api/v1/har/{fileId}/summary'], 'missing v1 summary path');
  assert(spec.json.paths['/api/upload/chunk'].post.requestBody.content['multipart/form-data'], 'missing multipart upload contract');

  const operationIds = [];
  for (const pathItem of Object.values(spec.json.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (operation.operationId) operationIds.push(operation.operationId);
      assert(operation.responses && Object.keys(operation.responses).length > 0, 'operation missing responses');
    }
  }
  assert(new Set(operationIds).size === operationIds.length, 'duplicate operationId in OpenAPI document');

  const schemaNames = new Set(Object.keys(spec.json.components.schemas));
  for (const ref of collectRefs(spec.json)) {
    if (ref.startsWith('#/components/schemas/')) {
      const name = ref.replace('#/components/schemas/', '');
      assert(schemaNames.has(name), `OpenAPI reference is missing schema: ${ref}`);
    }
  }
  record('GET /openapi.json', spec.ms, `${Object.keys(spec.json.paths).length} paths`);

  const docs = await request('GET', '/api-docs', { parseJson: false });
  assert(docs.text.includes('HAR File Analyzer API'), 'api-docs missing title');
  assert(docs.text.includes('/api/v1/har/{fileId}/summary'), 'api-docs missing v1 quick links');
  record('GET /api-docs', docs.ms);

  const aiStatus = await request('GET', '/api/ai/status');
  assert(typeof aiStatus.json.connected === 'boolean', 'AI status connected must be boolean');
  record('GET /api/ai/status', aiStatus.ms, `connected=${aiStatus.json.connected}`);

  const aiBadRequest = await request('POST', '/api/ai/insights', { body: {}, expectedStatus: 400 });
  assert(aiBadRequest.json.error, 'AI bad request did not return error');
  record('POST /api/ai/insights bad request', aiBadRequest.ms);
}

async function testNegativeCases() {
  const invalid = await request('GET', '/api/v1/har/..%2Fsecret/summary', { expectedStatus: 400 });
  assert(invalid.json.error === 'Invalid fileId', 'invalid v1 fileId did not return expected error');
  record('v1 invalid fileId', invalid.ms);

  const invalidInsights = await request('POST', '/api/v1/har/..%2Fsecret/insights', { expectedStatus: 400 });
  assert(invalidInsights.json.error === 'Invalid fileId', 'invalid v1 insights fileId did not return expected error');
  record('v1 insights invalid fileId', invalidInsights.ms);

  const notFound = await request('GET', `/api/v1/har/${TEST_PREFIX}_missing/summary`, { expectedStatus: 404 });
  assert(notFound.json.error === 'File not found', 'unknown fileId did not return 404 File not found');
  record('v1 unknown fileId', notFound.ms);

  const noFile = new FormData();
  noFile.append('fileId', `${TEST_PREFIX}_nofile`);
  noFile.append('chunkIndex', '0');
  noFile.append('totalChunks', '1');
  const noFileResponse = await request('POST', '/api/upload/chunk', { form: noFile, expectedStatus: 400 });
  assert(noFileResponse.json.error === 'No file uploaded', 'missing chunk did not return expected error');
  record('upload missing file', noFileResponse.ms);

  const badFileId = new FormData();
  badFileId.append('fileId', '../bad');
  badFileId.append('chunkIndex', '0');
  badFileId.append('totalChunks', '1');
  badFileId.append('chunk', new Blob([Buffer.from('bad')]), 'bad.har');
  const badFileIdResponse = await request('POST', '/api/upload/chunk', { form: badFileId, expectedStatus: 400 });
  assert(badFileIdResponse.json.error === 'Invalid fileId', 'bad upload fileId did not return expected error');
  record('upload invalid fileId', badFileIdResponse.ms);

  const missingChunks = await request('POST', '/api/upload/complete', {
    body: { fileId: `${TEST_PREFIX}_missing_chunks`, totalChunks: 1, fileName: 'missing.har', fileType: 'har' },
    expectedStatus: 400,
  });
  assert(missingChunks.json.error === 'Missing chunks', 'missing chunks did not return expected error');
  record('upload complete missing chunks', missingChunks.ms);

  const invalidCompleteFileId = await request('POST', '/api/upload/complete', {
    body: { fileId: '../bad', totalChunks: 1, fileName: 'bad.har', fileType: 'har' },
    expectedStatus: 400,
  });
  assert(invalidCompleteFileId.json.error === 'Invalid fileId', 'complete upload did not validate fileId');
  record('upload complete invalid fileId', invalidCompleteFileId.ms);

  const badTypeId = `${TEST_PREFIX}_bad_file_type`;
  const badTypeForm = new FormData();
  badTypeForm.append('fileId', badTypeId);
  badTypeForm.append('chunkIndex', '0');
  badTypeForm.append('totalChunks', '1');
  badTypeForm.append('chunk', new Blob([Buffer.from('bad file type')]), 'bad-type.bin');
  await request('POST', '/api/upload/chunk', { form: badTypeForm });
  const invalidFileType = await request('POST', '/api/upload/complete', {
    body: { fileId: badTypeId, totalChunks: 1, fileName: 'bad-type.bin', fileType: 'zip' },
    expectedStatus: 400,
  });
  assert(invalidFileType.json.error === 'Invalid fileType', 'complete upload did not validate fileType');
  record('upload complete invalid fileType', invalidFileType.ms);

  const tooLarge = new FormData();
  tooLarge.append('fileId', `${TEST_PREFIX}_too_large`);
  tooLarge.append('chunkIndex', '0');
  tooLarge.append('totalChunks', '1');
  tooLarge.append('chunk', new Blob([Buffer.alloc(13 * 1024 * 1024, 'x')]), 'large.part');
  const tooLargeResponse = await request('POST', '/api/upload/chunk', { form: tooLarge, expectedStatus: 413 });
  assert(tooLargeResponse.json.error === 'Upload chunk too large', 'oversized chunk did not return expected error');
  record('upload oversized chunk', tooLargeResponse.ms);
}

async function testHarWorkflow() {
  const fileId = `${TEST_PREFIX}_small_har`;
  const entries = [
    makeEntry(0, { status: 200, url: 'https://vb.example.com/app/home', time: 120 }),
    makeEntry(1, { status: 401, method: 'POST', url: 'https://idcs.example.com/oauth2/v1/token', time: 90 }),
    makeEntry(2, { status: 403, url: 'https://idcs.example.com/oauth2/v1/userinfo', time: 80 }),
    makeEntry(3, { status: 404, url: 'https://vb.example.com/app/missing.js', time: 30, mimeType: 'application/javascript' }),
    makeEntry(4, { status: 500, url: 'https://ords.example.com/ords/api/orders', time: 1800 }),
    makeEntry(5, { status: 302, url: 'https://vb.example.com/app/logout', time: 75 }),
    makeEntry(6, { status: 0, url: 'https://network.example.com/interrupted', time: 25 }),
    makeEntry(7, { status: 200, url: 'https://vb.example.com/app/slow', time: 2500 }),
  ];

  const upload = await uploadBuffer({
    fileId,
    fileName: 'small-auth.har',
    fileType: 'har',
    buffer: makeHar(entries),
    chunkSize: 2048,
  });
  assert(typeof upload.jobId === 'string' || typeof upload.jobId === 'number', 'upload response missing jobId');

  const status = await pollReady(fileId, `/api/har/${fileId}/status`);
  assert(status.totalEntries === entries.length, 'small HAR totalEntries mismatch');

  const summary = await request('GET', `/api/v1/har/${fileId}/summary`);
  assert(summary.json.summary.totalRequests === entries.length, 'v1 summary totalRequests mismatch');
  assert(summary.json.summary.errors === 4, 'v1 summary error count mismatch');
  assert(summary.json.summary.statusBuckets['4xx'] === 3, 'v1 summary 4xx bucket mismatch');
  assert(summary.json.summary.statusBuckets['5xx'] === 1, 'v1 summary 5xx bucket mismatch');
  record('v1 summary small HAR', summary.ms);

  const errors = await request('GET', `/api/v1/har/${fileId}/errors?limit=2&page=2`);
  assert(errors.json.entries.length === 2, 'paginated errors page 2 should have 2 entries');
  assert(errors.json.pagination.currentPage === 2, 'error pagination currentPage mismatch');
  assert(errors.json.pagination.totalEntries === 4, 'error pagination totalEntries mismatch');
  record('v1 errors pagination', errors.ms);

  const capped = await request('GET', `/api/v1/har/${fileId}/errors?limit=500`);
  assert(capped.json.pagination.limit === 100, 'v1 errors limit should cap at 100');
  record('v1 errors limit cap', capped.ms);

  const fallback = await request('GET', `/api/v1/har/${fileId}/errors?limit=-5&page=-4`);
  assert(fallback.json.pagination.currentPage === 1, 'negative page should fall back to 1');
  assert(fallback.json.pagination.limit === 25, 'negative limit should fall back to 25');
  record('v1 errors fallback pagination', fallback.ms);

  const context = await request('GET', `/api/v1/har/${fileId}/insights/context`);
  assert(context.json.context.includes('5XX SERVER ERRORS'), 'context missing 5xx section');
  assert(context.json.context.includes('4XX CLIENT ERRORS'), 'context missing 4xx section');
  assert(
    context.json.context.indexOf('5XX SERVER ERRORS') < context.json.context.indexOf('4XX CLIENT ERRORS'),
    'context did not prioritize 5xx before 4xx',
  );
  record('v1 insights context', context.ms, `${context.json.context.length} chars`);

  const entriesPage = await request('GET', `/api/har/${fileId}/entries?page=2&limit=3`);
  assert(entriesPage.json.entries.length === 3, 'HAR entries page 2 length mismatch');
  record('HAR entries pagination', entriesPage.ms);

  const entryZero = await request('GET', `/api/har/${fileId}/entries/0`);
  assert(entryZero.json.index === 0, 'HAR entry zero index mismatch');
  record('HAR entry details', entryZero.ms);

  const stats = await request('GET', `/api/har/${fileId}/stats`);
  assert(stats.json.errors === 4, 'HAR stats errors mismatch');
  record('HAR stats', stats.ms);

  const search = await request('GET', `/api/har/${fileId}/search?status=401`);
  assert(search.json.entries.length === 1, 'HAR search by status did not return one entry');
  record('HAR search status', search.ms);

  const scan = await request('GET', `/api/sanitize/${fileId}/scan`);
  assert(typeof scan.json.sensitiveCount === 'number', 'sanitize scan missing sensitiveCount');
  record('sanitize scan', scan.ms);

  const sanitize = await request('POST', `/api/sanitize/${fileId}`, {
    body: { mode: 'custom', scrubWords: ['idcs.example.com'] },
  });
  assert(sanitize.json.fileId === `sanitized_${fileId}`, 'sanitize returned unexpected fileId');
  record('sanitize custom', sanitize.ms);

  const sanitizedStatus = await pollReady(sanitize.json.fileId, `/api/har/${sanitize.json.fileId}/status`);
  assert(sanitizedStatus.totalEntries === entries.length, 'sanitized HAR totalEntries mismatch');

  return fileId;
}

async function testCompressedAndBareArrayUploads() {
  const gzipId = `${TEST_PREFIX}_gzip_har`;
  const gzipBuffer = await gzip(makeHar([
    makeEntry(0, { status: 200, url: 'https://app.example.com/home' }),
    makeEntry(1, { status: 502, url: 'https://ords.example.com/ords/gateway', time: 900 }),
  ]));
  await uploadBuffer({
    fileId: gzipId,
    fileName: 'compressed.har',
    fileType: 'har',
    buffer: gzipBuffer,
    compressed: 'gzip',
    chunkSize: 1024,
  });
  const gzipStatus = await pollReady(gzipId, `/api/har/${gzipId}/status`);
  assert(gzipStatus.totalEntries === 2, 'gzip HAR totalEntries mismatch');
  const gzipSummary = await request('GET', `/api/v1/har/${gzipId}/summary`);
  assert(gzipSummary.json.summary.statusBuckets['5xx'] === 1, 'gzip summary 5xx mismatch');
  record('gzip v1 summary', gzipSummary.ms);

  const arrayId = `${TEST_PREFIX}_bare_array`;
  const arrayBuffer = Buffer.from(JSON.stringify([
    makeEntry(0, { status: 200, url: 'https://array.example.com/ok' }),
    makeEntry(1, { status: 404, url: 'https://array.example.com/missing' }),
  ]));
  await uploadBuffer({
    fileId: arrayId,
    fileName: 'capture.oc',
    fileType: 'har',
    buffer: arrayBuffer,
    chunkSize: 1024,
  });
  const arrayStatus = await pollReady(arrayId, `/api/har/${arrayId}/status`);
  assert(arrayStatus.totalEntries === 2, 'bare-array HAR totalEntries mismatch');
  const arrayErrors = await request('GET', `/api/v1/har/${arrayId}/errors`);
  assert(arrayErrors.json.entries.length === 1, 'bare-array error count mismatch');
  record('bare-array v1 errors', arrayErrors.ms);
}

async function testLargeHarWorkflow() {
  const fileId = `${TEST_PREFIX}_large_har`;
  const largeBody = 'x'.repeat(400 * 1024);
  const entries = [];
  const count = 4500;
  let expectedErrors = 0;
  for (let i = 0; i < count; i += 1) {
    let status = 200;
    if (i % 97 === 0) status = 503;
    else if (i % 10 === 0) status = 404;
    if (status >= 400) expectedErrors += 1;
    entries.push(makeEntry(i, {
      status,
      method: i % 3 === 0 ? 'POST' : 'GET',
      url: `https://bulk${i % 7}.example.com/api/resource/${i % 100}`,
      time: (i % 250) + (status >= 500 ? 1000 : 20),
      responseText: i === 0 ? largeBody : undefined,
      bodySize: i === 0 ? Buffer.byteLength(largeBody) : 256,
    }));
  }

  const buffer = makeHar(entries);
  await uploadBuffer({
    fileId,
    fileName: 'large-performance.har',
    fileType: 'har',
    buffer,
    chunkSize: 512 * 1024,
  });
  const status = await pollReady(fileId, `/api/har/${fileId}/status`);
  assert(status.totalEntries === count, 'large HAR totalEntries mismatch');

  const summary = await request('GET', `/api/v1/har/${fileId}/summary`);
  assert(summary.json.summary.totalRequests === count, 'large summary totalRequests mismatch');
  assert(summary.json.summary.errors === expectedErrors, 'large summary errors mismatch');
  record('large v1 summary', summary.ms, `${count} entries`);

  const errors = await request('GET', `/api/v1/har/${fileId}/errors?limit=100&page=2`);
  assert(errors.json.entries.length === 100, 'large errors page should be full');
  assert(errors.json.pagination.totalEntries === expectedErrors, 'large error total mismatch');
  record('large v1 errors page', errors.ms);

  const context = await request('GET', `/api/v1/har/${fileId}/insights/context`);
  assert(context.json.context.length <= 12020, 'large insight context should be bounded');
  record('large v1 insight context', context.ms, `${context.json.context.length} chars`);

  const detail = await request('GET', `/api/har/${fileId}/entries/0`);
  assert(detail.json.storage?.truncatedFields?.includes('response.content.text'), 'large response text was not truncated for Mongo storage');
  assert(detail.json.response.content.text.length < largeBody.length, 'stored response text was not shortened');
  record('large entry truncation check', detail.ms);

  if (summary.ms > 2000) warn(`large summary took ${Math.round(summary.ms)}ms`);
  if (errors.ms > 2000) warn(`large errors page took ${Math.round(errors.ms)}ms`);
  if (context.ms > 3000) warn(`large insight context took ${Math.round(context.ms)}ms`);
}

async function testConsoleLogWorkflow() {
  const fileId = `${TEST_PREFIX}_console_log`;
  const logText = [
    '2026-05-26T10:00:00.000Z ERROR ORDS preflight failed: Access-Control-Allow-Origin header is missing from ORDS - preflight request response',
    '2026-05-26T10:00:01.000Z WARN Browser policy warning: autofocus processing was blocked',
    '2026-05-26T10:00:02.000Z INFO User navigated to application home',
  ].join('\n');

  await uploadBuffer({
    fileId,
    fileName: 'ords-console.log',
    fileType: 'log',
    buffer: Buffer.from(logText),
    chunkSize: 1024,
  });
  const status = await pollReady(fileId, `/api/console-log/${fileId}/status`);
  assert(status.totalEntries === 3, 'console log totalEntries mismatch');

  const entries = await request('GET', `/api/console-log/${fileId}/entries?levels=error&limit=10`);
  assert(entries.json.entries.length === 1, 'console log levels filter mismatch');
  assert(entries.json.facets.levelCounts.error === 1, 'console log facet error count mismatch');
  record('console entries levels filter', entries.ms);

  const detail = await request('GET', `/api/console-log/${fileId}/entries/0`);
  assert(detail.json.message.toLowerCase().includes('access-control-allow-origin'), 'console detail missing ORDS CORS evidence');
  record('console entry detail', detail.ms);

  const stats = await request('GET', `/api/console-log/${fileId}/stats`);
  assert(stats.json.totalEntries === 3 || stats.json.totalLogs === 3, 'console stats total mismatch');
  record('console stats', stats.ms);

  const search = await request('GET', `/api/console-log/${fileId}/search?level=error&search=ORDS`);
  assert(search.json.entries.length === 1, 'console search mismatch');
  record('console search', search.ms);
}

async function main() {
  console.log(`Testing OpenAPI endpoints at ${BASE_URL}`);
  await cleanup();

  try {
    await testContractEndpoints();
    await testNegativeCases();
    await testHarWorkflow();
    await testCompressedAndBareArrayUploads();
    await testLargeHarWorkflow();
    await testConsoleLogWorkflow();
  } finally {
    await cleanup();
  }

  console.log('\nEndpoint test timings:');
  for (const row of results) {
    console.log(`${String(row.ms).padStart(6)}ms  ${row.name}${row.details ? `  (${row.details})` : ''}`);
  }
  if (warnings.length) {
    console.log('\nWarnings:');
    for (const warning of warnings) console.log(`- ${warning}`);
  }
  console.log(`\nPASS ${results.length} endpoint checks completed.`);
}

main().catch((error) => {
  console.error('\nFAIL OpenAPI endpoint test failed:');
  console.error(error);
  process.exitCode = 1;
});
