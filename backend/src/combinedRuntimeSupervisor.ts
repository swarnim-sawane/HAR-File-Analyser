import type { ChildProcess } from 'child_process';

export interface CombinedRuntimeChild extends Pick<
  ChildProcess,
  'exitCode' | 'signalCode' | 'kill' | 'once'
> {}

export type CombinedRuntimeChildName = 'api' | 'worker';
export type CombinedRuntimeChildFactory = (name: CombinedRuntimeChildName) => CombinedRuntimeChild;

export interface CombinedRuntimeSupervisorOptions {
  createChild: CombinedRuntimeChildFactory;
  exit: (code: number) => void;
  gracePeriodMs?: number;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

const DEFAULT_GRACE_PERIOD_MS = 30_000;

export class CombinedRuntimeSupervisor {
  private readonly children = new Map<CombinedRuntimeChildName, CombinedRuntimeChild>();
  private readonly remaining = new Set<CombinedRuntimeChildName>();
  private shuttingDown = false;
  private desiredExitCode = 0;
  private forceTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: CombinedRuntimeSupervisorOptions) {}

  start(): void {
    this.register('api');
    this.register('worker');
    this.options.log?.('Combined runtime started API and worker processes.');
  }

  shutdown(exitCode = 0, signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.shuttingDown) {
      this.desiredExitCode = Math.max(this.desiredExitCode, exitCode);
      return;
    }

    this.shuttingDown = true;
    this.desiredExitCode = exitCode;
    this.options.log?.(`Combined runtime shutting down with ${signal}.`);

    for (const [name, child] of this.children) {
      if (!this.remaining.has(name)) continue;
      try {
        child.kill(signal);
      } catch (error) {
        this.options.logError?.(`Failed to signal ${name}: ${String(error)}`);
      }
    }

    const gracePeriodMs = this.options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
    this.forceTimer = setTimeout(() => {
      for (const [name, child] of this.children) {
        if (!this.remaining.has(name)) continue;
        this.options.logError?.(`${name} exceeded the shutdown grace period; sending SIGKILL.`);
        try {
          child.kill('SIGKILL');
        } catch (error) {
          this.options.logError?.(`Failed to force-stop ${name}: ${String(error)}`);
        }
      }
    }, gracePeriodMs);
    this.forceTimer.unref();

    if (this.remaining.size === 0) this.finish();
  }

  private register(name: CombinedRuntimeChildName): void {
    const child = this.options.createChild(name);
    this.children.set(name, child);
    this.remaining.add(name);

    child.once('error', (error: Error) => {
      this.options.logError?.(`${name} failed to start: ${error.message}`);
      this.shutdown(1);
    });
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.remaining.delete(name);
      this.options.log?.(`${name} exited with code=${code ?? 'null'} signal=${signal ?? 'none'}.`);

      if (!this.shuttingDown) {
        const failureCode = code && code > 0 ? code : 1;
        this.options.logError?.(`${name} exited unexpectedly; terminating the combined runtime.`);
        this.shutdown(failureCode);
      }

      if (this.remaining.size === 0) this.finish();
    });
  }

  private finish(): void {
    if (this.forceTimer) clearTimeout(this.forceTimer);
    this.forceTimer = undefined;
    this.options.exit(this.desiredExitCode);
  }
}
