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

  it('uses port 8080 for Hosted Deployment without declaring PORT', () => {
    expect(getRuntimeBinding({ HOSTED_DEPLOYMENT: 'true' }, 4000)).toEqual({
      host: '0.0.0.0',
      port: 8080,
    });
    expect(getRuntimeBinding({ HOSTED_DEPLOYMENT: 'true' }, 4001, 'WORKER_HEALTH_PORT'))
      .toEqual({ host: '0.0.0.0', port: 8080 });
  });

  it('honors a platform-provided PORT value', () => {
    expect(getRuntimeBinding({ HOSTED_DEPLOYMENT: 'true', PORT: '9090' }, 4000))
      .toEqual({ host: '0.0.0.0', port: 9090 });
  });
});
