import { describe, expect, it } from 'vitest';
import { getRuntimeBinding } from './runtimeBinding';

describe('getRuntimeBinding', () => {
  it('uses local API and worker defaults on all interfaces', () => {
    expect(getRuntimeBinding({}, 4000)).toEqual({ host: '0.0.0.0', port: 4000 });
    expect(getRuntimeBinding({}, 4001, 'WORKER_HEALTH_PORT')).toEqual({
      host: '0.0.0.0',
      port: 4001,
    });
  });

  it('does not reuse the local API port for the worker health server', () => {
    expect(getRuntimeBinding({ PORT: '4000' }, 4001, 'WORKER_HEALTH_PORT')).toEqual({
      host: '0.0.0.0',
      port: 4001,
    });
    expect(getRuntimeBinding(
      { PORT: '4000', WORKER_HEALTH_PORT: '4101' },
      4001,
      'WORKER_HEALTH_PORT',
    )).toEqual({ host: '0.0.0.0', port: 4101 });
  });

  it('uses port 8080 for Hosted Deployment without declaring PORT', () => {
    expect(getRuntimeBinding({ HOSTED_DEPLOYMENT: 'true' }, 4000)).toEqual({
      host: '0.0.0.0',
      port: 8080,
    });
    expect(getRuntimeBinding({ HOSTED_DEPLOYMENT: 'true' }, 4001, 'WORKER_HEALTH_PORT'))
      .toEqual({ host: '0.0.0.0', port: 8080 });
  });

  it('rejects bindings that violate the Hosted Deployment contract', () => {
    expect(() => getRuntimeBinding({ HOSTED_DEPLOYMENT: 'true', PORT: '9090' }, 4000))
      .toThrow(/port 8080/);
    expect(() => getRuntimeBinding(
      { HOSTED_DEPLOYMENT: 'true', HOST: '127.0.0.1' },
      4001,
      'WORKER_HEALTH_PORT',
    )).toThrow(/HOST=0.0.0.0/);
  });
});
