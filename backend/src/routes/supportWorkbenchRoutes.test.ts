// @vitest-environment node

import express from 'express';
import { createServer, type IncomingMessage, type Server } from 'http';
import { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { File, FormData, fetch } from 'undici';
import supportWorkbenchRoutes from './supportWorkbenchRoutes';

type CapturedRequest = {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: Buffer;
};

const servers: Server[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map(closeServer));
});

describe('supportWorkbenchRoutes', () => {
  it('proxies session creation and relays the owner cookie', async () => {
    let captured: CapturedRequest | null = null;
    const supportServer = await listen(createServer(async (req, res) => {
      captured = await captureRequest(req);
      res.statusCode = 201;
      res.setHeader('content-type', 'application/json');
      res.setHeader('set-cookie', 'support_workbench_client_id=owner-1; Path=/; HttpOnly');
      res.end(JSON.stringify({
        session: {
          id: 'support-session-1',
          cwd: 'C:/repo',
          status: 'idle',
        },
        snapshot: {
          sessionId: 'support-session-1',
        },
      }));
    }));
    const appServer = await listen(createHarProxyServer());
    vi.stubEnv('SUPPORT_WORKBENCH_API_URL', serverUrl(supportServer));

    const response = await fetch(`${serverUrl(appServer)}/api/support-workbench/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'support_workbench_client_id=owner-1',
      },
      body: JSON.stringify({ sessionId: 'support-session-1' }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('support_workbench_client_id=owner-1');
    expect(await response.json()).toMatchObject({
      session: {
        id: 'support-session-1',
      },
    });
    expect(captured).toMatchObject({
      method: 'POST',
      url: '/api/session',
    });
    expect(captured?.headers.cookie).toBe('support_workbench_client_id=owner-1');
    expect(JSON.parse(captured?.body.toString('utf8') ?? '{}')).toEqual({
      sessionId: 'support-session-1',
    });
  });

  it('proxies uploaded files as support workbench attachments', async () => {
    let captured: CapturedRequest | null = null;
    const supportServer = await listen(createServer(async (req, res) => {
      captured = await captureRequest(req);
      res.statusCode = 201;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        accepted: true,
        attachments: [{ id: 'attachment-1', originalName: 'mock.har' }],
        snapshot: {
          sessionId: 'support-session-1',
        },
      }));
    }));
    const appServer = await listen(createHarProxyServer());
    vi.stubEnv('SUPPORT_WORKBENCH_API_URL', serverUrl(supportServer));

    const formData = new FormData();
    formData.append('files', new File(['{"log":{"entries":[]}}'], 'mock.har', {
      type: 'application/json',
    }));

    const response = await fetch(
      `${serverUrl(appServer)}/api/support-workbench/session/support-session-1/attachments`,
      {
        method: 'POST',
        headers: {
          cookie: 'support_workbench_client_id=owner-1',
        },
        body: formData,
      }
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      accepted: true,
      attachments: [{ id: 'attachment-1' }],
    });
    expect(captured).toMatchObject({
      method: 'POST',
      url: '/api/session/support-session-1/attachments',
    });
    expect(captured?.headers.cookie).toBe('support_workbench_client_id=owner-1');
    expect(captured?.headers['content-type']).toContain('multipart/form-data');
    const multipartBody = captured?.body.toString('utf8') ?? '';
    expect(multipartBody).toContain('name="files"');
    expect(multipartBody).toContain('filename="mock.har"');
    expect(multipartBody).toContain('{"log":{"entries":[]}}');
  });
});

function createHarProxyServer(): Server {
  const app = express();
  app.use(express.json());
  app.use('/api/support-workbench', supportWorkbenchRoutes);
  return createServer(app);
}

function listen(server: Server): Promise<Server> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function serverUrl(server: Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function captureRequest(req: IncomingMessage): Promise<CapturedRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('error', reject);
    req.on('end', () => {
      resolve({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
    });
  });
}
