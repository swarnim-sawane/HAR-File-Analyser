import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm' : 'npm';

const services = [
  {
    name: 'frontend',
    color: '\x1b[36m',
    cwd: rootDir,
    args: ['run', 'dev'],
  },
  {
    name: 'backend',
    color: '\x1b[35m',
    cwd: path.join(rootDir, 'backend'),
    args: ['run', 'dev'],
  },
  {
    name: 'worker',
    color: '\x1b[33m',
    cwd: path.join(rootDir, 'backend'),
    args: ['run', 'dev:worker'],
  },
];

const reset = '\x1b[0m';
const children = new Set();
let shuttingDown = false;

for (const service of services) {
  const command = isWindows ? `${npmCommand} ${service.args.join(' ')}` : npmCommand;
  const args = isWindows ? [] : service.args;
  const child = spawn(command, args, {
    cwd: service.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows,
    windowsHide: true,
  });

  children.add(child);
  prefixStream(child.stdout, service);
  prefixStream(child.stderr, service);

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 0}`;
    process.stderr.write(`${service.color}[${service.name}]${reset} stopped with ${reason}\n`);
    shutdown(code && code > 0 ? code : 1);
  });

  child.on('error', (error) => {
    children.delete(child);
    process.stderr.write(`${service.color}[${service.name}]${reset} failed to start: ${error.message}\n`);
    shutdown(1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  for (const child of children) {
    stopChildSync(child);
  }
});

function prefixStream(stream, service) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      process.stdout.write(`${service.color}[${service.name}]${reset} ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffer) {
      process.stdout.write(`${service.color}[${service.name}]${reset} ${buffer}\n`);
      buffer = '';
    }
  });
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    stopChild(child);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 500).unref();
}

function stopChild(child) {
  if (!child.pid) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  child.kill('SIGTERM');
}

function stopChildSync(child) {
  if (!child.pid) return;
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // Process already exited.
  }
}
