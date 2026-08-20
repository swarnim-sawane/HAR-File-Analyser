const BASE_URL = process.env.HAR_OCI_DEMO_URL || 'http://127.0.0.1:3120';

const readJson = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const request = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} returned ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
};

const fileId = `oci_director_demo_${Date.now()}`;
const har = {
  log: {
    version: '1.2',
    creator: { name: 'HAR Analyzer OCI director demo', version: '1.0' },
    pages: [],
    entries: [
      {
        startedDateTime: new Date().toISOString(),
        time: 82,
        request: {
          method: 'GET',
          url: 'https://service.example.invalid/api/orders',
          httpVersion: 'HTTP/1.1',
          headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: 0,
        },
        response: {
          status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1',
          headers: [], cookies: [], content: { size: 128, mimeType: 'application/json', text: '{}' },
          redirectURL: '', headersSize: -1, bodySize: 128,
        },
        cache: {},
        timings: { send: 2, wait: 75, receive: 5 },
      },
      {
        startedDateTime: new Date(Date.now() + 100).toISOString(),
        time: 1240,
        request: {
          method: 'POST',
          url: 'https://service.example.invalid/api/orders/submit',
          httpVersion: 'HTTP/1.1',
          headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: 32,
        },
        response: {
          status: 500, statusText: 'Internal Server Error', httpVersion: 'HTTP/1.1',
          headers: [], cookies: [], content: { size: 64, mimeType: 'application/json', text: '{}' },
          redirectURL: '', headersSize: -1, bodySize: 64,
        },
        cache: {},
        timings: { send: 4, wait: 1220, receive: 16 },
      },
    ],
  },
};

const form = new FormData();
form.append('fileId', fileId);
form.append('chunkIndex', '0');
form.append('totalChunks', '1');
form.append('chunk', new Blob([JSON.stringify(har)], { type: 'application/json' }), 'oci-director-demo.har');

await request('/api/upload/chunk', { method: 'POST', body: form });
await request('/api/upload/complete', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fileId, totalChunks: 1, fileName: 'oci-director-demo.har', fileType: 'har' }),
});

let finalStatus;
for (let attempt = 1; attempt <= 30; attempt += 1) {
  finalStatus = await request(`/api/har/${fileId}/status`);
  if (['ready', 'completed', 'failed', 'error'].includes(finalStatus?.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

if (!['ready', 'completed'].includes(finalStatus?.status)) {
  throw new Error(`OCI demo processing did not complete successfully: ${JSON.stringify(finalStatus)}`);
}

console.log(JSON.stringify({
  status: 'passed',
  fileId,
  browserUrl: `${BASE_URL}/?fileId=${encodeURIComponent(fileId)}`,
  processingStatus: finalStatus.status,
}, null, 2));
