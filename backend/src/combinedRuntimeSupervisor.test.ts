import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
  CombinedRuntimeSupervisor,
  type CombinedRuntimeChild,
  type CombinedRuntimeChildName,
} from './combinedRuntimeSupervisor';

class FakeChild extends EventEmitter implements CombinedRuntimeChild {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn((_signal?: number | NodeJS.Signals) => true);
}

function harness() {
  const children = new Map<CombinedRuntimeChildName, FakeChild>();
  const exit = vi.fn();
  const supervisor = new CombinedRuntimeSupervisor({
    createChild: (name) => {
      const child = new FakeChild();
      children.set(name, child);
      return child;
    },
    exit,
    gracePeriodMs: 100,
  });
  supervisor.start();
  return { children, exit, supervisor };
}

describe('CombinedRuntimeSupervisor', () => {
  it('starts both critical processes and forwards graceful shutdown', () => {
    const { children, exit, supervisor } = harness();
    supervisor.shutdown(0, 'SIGTERM');

    expect(children.get('api')?.kill).toHaveBeenCalledWith('SIGTERM');
    expect(children.get('worker')?.kill).toHaveBeenCalledWith('SIGTERM');

    children.get('api')?.emit('exit', 0, null);
    children.get('worker')?.emit('exit', 0, null);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('terminates the sibling and exits non-zero when a child exits unexpectedly', () => {
    const { children, exit } = harness();
    children.get('worker')?.emit('exit', 0, null);

    expect(children.get('api')?.kill).toHaveBeenCalledWith('SIGTERM');
    children.get('api')?.emit('exit', 0, null);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('preserves an unexpected non-zero child exit code', () => {
    const { children, exit } = harness();
    children.get('api')?.emit('exit', 7, null);
    children.get('worker')?.emit('exit', 0, null);
    expect(exit).toHaveBeenCalledWith(7);
  });
});
