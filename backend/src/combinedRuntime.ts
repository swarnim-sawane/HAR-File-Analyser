import { spawn } from 'child_process';
import path from 'path';
import {
  CombinedRuntimeSupervisor,
  type CombinedRuntimeChildName,
} from './combinedRuntimeSupervisor';

const workerHealthHost = '127.0.0.1';
const workerHealthPort = '8081';
const workerReadyUrl = `http://${workerHealthHost}:${workerHealthPort}/ready`;

function createChild(name: CombinedRuntimeChildName) {
  const entrypoint = path.join(__dirname, name === 'api' ? 'server.js' : 'worker.js');
  const roleEnvironment = name === 'api'
    ? {
      COMBINED_RUNTIME_ROLE: 'api',
      FAIL_FAST_ON_STARTUP_ERROR: 'true',
      INTERNAL_WORKER_READY_URL: workerReadyUrl,
    }
    : {
      COMBINED_RUNTIME_ROLE: 'worker',
      INTERNAL_WORKER_HEALTH_HOST: workerHealthHost,
      INTERNAL_WORKER_HEALTH_PORT: workerHealthPort,
    };

  return spawn(process.execPath, [entrypoint], {
    env: { ...process.env, ...roleEnvironment },
    stdio: 'inherit',
    windowsHide: true,
  });
}

const supervisor = new CombinedRuntimeSupervisor({
  createChild,
  exit: (code) => process.exit(code),
  log: (message) => console.log(`[combined] ${message}`),
  logError: (message) => console.error(`[combined] ${message}`),
});

process.once('SIGTERM', () => supervisor.shutdown(0, 'SIGTERM'));
process.once('SIGINT', () => supervisor.shutdown(0, 'SIGINT'));

supervisor.start();
