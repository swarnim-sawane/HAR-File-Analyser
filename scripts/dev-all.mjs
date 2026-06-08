import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'cmd.exe' : 'npm';
const backendDir = fileURLToPath(new URL('../backend/', import.meta.url));

function npmArgs(args) {
  return isWindows ? ['/d', '/s', '/c', 'npm', ...args] : args;
}

const processes = [
  {
    name: 'frontend',
    cwd: process.cwd(),
    args: ['run', 'dev'],
  },
  {
    name: 'backend',
    cwd: backendDir,
    args: ['run', 'dev'],
  },
  {
    name: 'worker',
    cwd: backendDir,
    args: ['run', 'dev:worker'],
  },
];

const children = new Set();
let shuttingDown = false;

function prefixOutput(name, stream, write) {
  let buffer = '';

  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.length > 0) {
        write(`[${name}] ${line}\n`);
      } else {
        write('\n');
      }
    }
  });

  stream.on('end', () => {
    if (buffer.length > 0) {
      write(`[${name}] ${buffer}\n`);
    }
  });
}

function stopAll(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    terminateChildTree(child);
  }

  setTimeout(() => {
    for (const child of children) {
      terminateChildTree(child, true);
    }
    process.exit(exitCode);
  }, 1500).unref();
}

function terminateChildTree(child, force = false) {
  if (child.killed) return;

  if (process.platform === 'win32') {
    const args = ['/pid', String(child.pid), '/t'];
    if (force) args.push('/f');
    spawn('taskkill', args, { stdio: 'ignore' });
    return;
  }

  child.kill(force ? 'SIGKILL' : 'SIGTERM');
}

for (const config of processes) {
  const child = spawn(npmCommand, npmArgs(config.args), {
    cwd: config.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  children.add(child);
  prefixOutput(config.name, child.stdout, (text) => process.stdout.write(text));
  prefixOutput(config.name, child.stderr, (text) => process.stderr.write(text));

  child.on('exit', (code, signal) => {
    children.delete(child);

    if (shuttingDown) return;

    if (code !== 0) {
      process.stderr.write(`[dev:all] ${config.name} exited with ${signal ?? `code ${code}`}. Stopping all processes.\n`);
      stopAll(code ?? 1);
    }
  });

  child.on('error', (error) => {
    process.stderr.write(`[dev:all] Failed to start ${config.name}: ${error.message}\n`);
    stopAll(1);
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
