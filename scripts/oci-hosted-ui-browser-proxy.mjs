import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserProxyError,
  buildHostedUiBase,
  buildHostedUiTarget,
  filterBrowserRequestHeaders,
  filterHostedResponseHeaders,
  isTrustedLocalRequest,
  readBoundedBody,
  validateMethod,
} from './oci-hosted-ui-browser-proxy-core.mjs';
import { signOciRequest } from '../deploy/hosted/ui-proxy-core.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(scriptDir, '..', 'backend', 'package.json'));
const { SessionAuthDetailProvider } = require('oci-common');

const HOST = '127.0.0.1';
const PORT = Number(process.env.HAR_OCI_DEMO_PORT || 3120);
const REGION = process.env.HAR_OCI_REGION || 'us-phoenix-1';
const PROFILE = process.env.HAR_OCI_PROFILE || 'BOAT2';
const CONFIG_FILE = process.env.HAR_OCI_CONFIG_FILE
  || path.join(process.env.USERPROFILE || '', '.oci', 'config');
const UI_APPLICATION_OCID = process.env.HAR_OCI_UI_APPLICATION_OCID
  || 'ocid1.generativeaihostedapplicationiam.oc1.phx.amaaaaaaxlowriqagyy74xzlrenop6b7zrcu44c3oa6u5ojf25kdjr3zerga';
const MAX_BODY_BYTES = Number(process.env.HAR_OCI_DEMO_MAX_BODY_BYTES || 64 * 1024 * 1024);
const REQUEST_TIMEOUT_MS = Number(process.env.HAR_OCI_DEMO_TIMEOUT_MS || 1_800_000);

const hostedUiBase = buildHostedUiBase({ region: REGION, applicationOcid: UI_APPLICATION_OCID });
const provider = new SessionAuthDetailProvider(CONFIG_FILE, PROFILE);

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
};

const safeErrorMessage = (error) => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return message
    .replace(/Bearer\s+[^\s,]+/gi, 'Bearer [REDACTED]')
    .replace(/Signature\s+[^\r\n]+/gi, 'Signature [REDACTED]')
    .slice(0, 500);
};

const server = createServer(async (request, response) => {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('OCI request timed out')), REQUEST_TIMEOUT_MS);
  timeout.unref();

  try {
    const method = validateMethod(request.method);
    if (!isTrustedLocalRequest({
      method,
      origin: request.headers.origin,
      host: request.headers.host,
      secFetchSite: request.headers['sec-fetch-site'],
    })) {
      throw new BrowserProxyError(403, 'Cross-site mutation requests are not allowed');
    }

    if (request.url === '/__proxy/health') {
      clearTimeout(timeout);
      sendJson(response, 200, {
        status: 'ok',
        role: 'localhost-oci-signed-browser-bridge',
        profile: PROFILE,
        region: REGION,
        targetApplicationOcid: UI_APPLICATION_OCID,
      });
      return;
    }

    const target = buildHostedUiTarget(hostedUiBase, request.url);
    const body = await readBoundedBody(request, MAX_BODY_BYTES);
    const headers = filterBrowserRequestHeaders(request.headers);
    await signOciRequest({ provider, method, target, headers, body });

    const upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: controller.signal,
    });

    const responseHeaders = filterHostedResponseHeaders(upstream.headers);
    responseHeaders['x-content-type-options'] = 'nosniff';
    response.writeHead(upstream.status, responseHeaders);

    console.log(JSON.stringify({
      event: 'oci_hosted_ui_proxy',
      method,
      path: new URL(request.url || '/', 'http://localhost').pathname,
      status: upstream.status,
      latencyMs: Date.now() - startedAt,
      opcRequestId: upstream.headers.get('opc-request-id') || undefined,
    }));

    if (method === 'HEAD' || !upstream.body) {
      clearTimeout(timeout);
      response.end();
      return;
    }

    Readable.fromWeb(upstream.body)
      .once('error', (error) => {
        console.error('OCI response stream failed:', safeErrorMessage(error));
        response.destroy();
      })
      .once('end', () => clearTimeout(timeout))
      .pipe(response);
  } catch (error) {
    clearTimeout(timeout);
    const statusCode = error instanceof BrowserProxyError ? error.statusCode : 502;
    console.error('OCI browser proxy request failed:', safeErrorMessage(error));
    if (!response.headersSent) {
      sendJson(response, statusCode, {
        error: statusCode === 502
          ? 'The signed OCI request failed. Re-authenticate the configured OCI CLI session and retry.'
          : error.message,
      });
    } else {
      response.destroy();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`HAR Analyzer OCI demo bridge: http://${HOST}:${PORT}`);
  console.log(`OCI profile: ${PROFILE}`);
  console.log(`OCI UI application: ${UI_APPLICATION_OCID}`);
  console.log('The bridge listens on localhost only and never sends OCI credentials to the browser.');
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
