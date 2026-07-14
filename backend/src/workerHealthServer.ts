import http, { type Server } from 'http';
import { getRuntimeBinding } from './config/runtimeBinding';

export interface WorkerHealthState {
  isReady: () => boolean;
  isShuttingDown: () => boolean;
}

export interface WorkerHealthServerOptions {
  host?: string;
  port?: number;
}

export function startWorkerHealthServer(
  state: WorkerHealthState,
  options: WorkerHealthServerOptions = {},
): Server {
  const binding = getRuntimeBinding(process.env, 4001, 'WORKER_HEALTH_PORT');
  const host = options.host || binding.host;
  const port = options.port ?? binding.port;

  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');

    if (request.url === '/health') {
      const healthy = !state.isShuttingDown();
      response.statusCode = healthy ? 200 : 503;
      response.end(JSON.stringify({ status: healthy ? 'ok' : 'shutting_down' }));
      return;
    }

    if (request.url === '/ready') {
      const ready = state.isReady() && !state.isShuttingDown();
      response.statusCode = ready ? 200 : 503;
      response.end(JSON.stringify({ status: ready ? 'ready' : 'not_ready' }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, host, () => {
    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Worker health server listening on http://${host}:${boundPort}`);
  });

  return server;
}
