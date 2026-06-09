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

function firstEnv(env, keys) {
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function validateLocalDevEnvironment(env = process.env) {
  const errors = [];
  const backend = String(env.PERSISTENCE_BACKEND || env.DATABASE_BACKEND || 'oracle-json')
    .trim()
    .toLowerCase();

  if (backend !== 'oracle-json' && backend !== 'oracle') {
    errors.push('Only Oracle JSON persistence is supported. Set PERSISTENCE_BACKEND=oracle-json.');
    return errors;
  }

  if (!firstEnv(env, ['ORACLE_DB_USER', 'ORACLE_USER'])) {
    errors.push('ORACLE_DB_USER is required for Oracle JSON persistence.');
  }
  if (!firstEnv(env, ['ORACLE_DB_PASSWORD', 'ORACLE_PASSWORD'])) {
    errors.push('ORACLE_DB_PASSWORD is required for Oracle JSON persistence.');
  }
  if (!firstEnv(env, ['ORACLE_DB_CONNECT_STRING', 'ORACLE_CONNECT_STRING'])) {
    errors.push('ORACLE_DB_CONNECT_STRING is required for Oracle JSON persistence.');
  }

  return errors;
}

function printDryRun() {
  for (const service of services) {
    const { command, args } = getSpawnCommand(service);
    console.log(`${service.name}: ${command} ${args.join(' ')} (cwd: ${service.cwd})`);
  }
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

function main() {
  if (process.argv.includes('--dry-run') || process.env.npm_config_dry_run === 'true') {
    printDryRun();
    process.exit(0);
  }

  const preflightErrors = validateLocalDevEnvironment(process.env);
  if (preflightErrors.length > 0) {
    console.error('Cannot start local development services:');
    for (const error of preflightErrors) {
      console.error(`- ${error}`);
    }
    console.error('\nAdd these values to backend/.env or the current shell before running npm run dev:all.');
    process.exit(1);
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
}

if (require.main === module) {
  main();
}

module.exports = {
  validateLocalDevEnvironment,
};
