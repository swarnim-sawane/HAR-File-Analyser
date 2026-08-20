import { describe, expect, it } from 'vitest';
import { parseSocketTransports, resolveSocketPath } from './websocketConfig';

describe('websocket hosted configuration', () => {
  it('uses the Hosted Application invoke prefix for Socket.IO', () => {
    expect(resolveSocketPath('/20251112/hostedApplications/example/actions/invoke/')).toBe(
      '/20251112/hostedApplications/example/actions/invoke/socket.io',
    );
    expect(resolveSocketPath('/')).toBe('/socket.io');
  });

  it('allows the hosted build to select polling only', () => {
    expect(parseSocketTransports('polling')).toEqual(['polling']);
    expect(parseSocketTransports('websocket,polling,websocket')).toEqual(['websocket', 'polling']);
    expect(parseSocketTransports('invalid')).toEqual(['websocket', 'polling']);
  });
});
