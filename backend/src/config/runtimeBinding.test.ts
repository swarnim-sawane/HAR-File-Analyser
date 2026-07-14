import { describe, expect, it } from 'vitest';
import { getRuntimeBinding } from './runtimeBinding';

describe('getRuntimeBinding', () => {
  it('uses 0.0.0.0:8080 for Hosted Deployment by default', () => {
    expect(getRuntimeBinding({ HOSTED_DEPLOYMENT: 'true' } as NodeJS.ProcessEnv))
      .toEqual({ host: '0.0.0.0', port: 8080 });
  });

  it('honors the port injected by the hosted platform', () => {
    expect(getRuntimeBinding({ HOSTED_DEPLOYMENT: 'true', PORT: '9090' } as NodeJS.ProcessEnv))
      .toEqual({ host: '0.0.0.0', port: 9090 });
  });

  it('keeps local API and worker defaults independent', () => {
    const env = { PORT: '4100' } as NodeJS.ProcessEnv;

    expect(getRuntimeBinding(env, 4000)).toEqual({ host: '0.0.0.0', port: 4100 });
    expect(getRuntimeBinding(env, 4001, 'WORKER_HEALTH_PORT'))
      .toEqual({ host: '0.0.0.0', port: 4001 });
  });

  it('honors explicit host and worker health port values', () => {
    const env = {
      HOST: '127.0.0.1',
      WORKER_HEALTH_PORT: '4201',
    } as NodeJS.ProcessEnv;

    expect(getRuntimeBinding(env, 4001, 'WORKER_HEALTH_PORT'))
      .toEqual({ host: '127.0.0.1', port: 4201 });
  });

  it('rejects invalid ports', () => {
    expect(() => getRuntimeBinding({ PORT: 'invalid' } as NodeJS.ProcessEnv))
      .toThrow('Invalid PORT');
  });
});
