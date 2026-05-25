#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');
const npmCmd = 'npm';

const services = [
  { name: 'frontend', cwd: rootDir, args: ['run', 'dev'] },
  { name: 'backend', cwd: backendDir, args: ['run', 'dev'] },
  { name: 'worker', cwd: backendDir, args: ['run', 'dev:worker'] },
];

if (process.argv.includes('--dry-run')) {
  for (const service of services) {
    const { command, args } = getSpawnCommand(service);
    console.log(`${service.name}: ${command} ${args.join(' ')} (cwd: ${service.cwd})`);
  }
  process.exit(0);
}

const children = new Map();
let shuttingDown = false;

function prefixStream(stream, name, write) {
  const rl = readline.createInterface({ input: stream });
  rl.on('line', (line) => write(`[${name}] ${line}\n`));
}

function stopChild(child) {
  if (!child.pid || child.killed) return;

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  child.kill('SIGTERM');
}

function getSpawnCommand(service) {
  if (process.platform !== 'win32') {
    return { command: npmCmd, args: service.args };
  }

  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `${npmCmd} ${service.args.join(' ')}`],
  };
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\nStopping local development services...');
  for (const child of children.values()) {
    stopChild(child);
  }

  setTimeout(() => process.exit(exitCode), 500);
}

console.log('Starting local development services: frontend, backend, worker');
console.log('Press Ctrl+C to stop all services.\n');

for (const service of services) {
  const { command, args } = getSpawnCommand(service);
  const child = spawn(command, args, {
    cwd: service.cwd,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  children.set(service.name, child);
  prefixStream(child.stdout, service.name, (line) => process.stdout.write(line));
  prefixStream(child.stderr, service.name, (line) => process.stderr.write(line));

  child.on('exit', (code, signal) => {
    children.delete(service.name);
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`\n${service.name} exited with ${reason}. Stopping remaining services.`);
    shutdown(code || 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
