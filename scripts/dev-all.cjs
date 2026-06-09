#!/usr/bin/env node

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');
const backendEnvPath = path.join(backendDir, '.env');
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

function stripEnvQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseDotEnvContent(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const equalsIndex = normalized.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    const value = normalized.slice(equalsIndex + 1);
    values[key] = stripEnvQuotes(value);
  }

  return values;
}

function loadBackendEnv(filePath = backendEnvPath) {
  try {
    return parseDotEnvContent(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

function buildDevEnvironment(shellEnv = process.env, backendEnv = loadBackendEnv()) {
  return {
    ...backendEnv,
    ...shellEnv,
  };
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

  const childEnv = buildDevEnvironment(process.env);
  const preflightErrors = validateLocalDevEnvironment(childEnv);
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
      env: { ...childEnv, FORCE_COLOR: '1' },
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
  buildDevEnvironment,
  parseDotEnvContent,
  validateLocalDevEnvironment,
};
