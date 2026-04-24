import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '3000');
const staticRoot = resolve(process.cwd(), process.env.STATIC_DIR || 'dist');
const indexPath = join(staticRoot, 'index.html');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendFile(res, filePath) {
  const extension = extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  if (!req.url || !['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  try {
    const requestPath = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const candidatePath = normalize(join(staticRoot, relativePath));

    if (!candidatePath.startsWith(staticRoot)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    try {
      await access(candidatePath);
      const fileStats = await stat(candidatePath);
      if (fileStats.isFile()) {
        if (req.method === 'HEAD') {
          res.writeHead(200);
          res.end();
          return;
        }
        sendFile(res, candidatePath);
        return;
      }
    } catch {
      // Fall through to SPA fallback below.
    }

    if (req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return;
    }

    sendFile(res, indexPath);
  } catch (error) {
    console.error('Static server error:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

server.listen(port, host, () => {
  console.log(`Static frontend server listening on http://${host}:${port}`);
  console.log(`Serving files from ${staticRoot}`);
});
