import { describe, expect, it, vi } from 'vitest';
import { probeRedisOperationalCommands } from './redisOperationalProbe';

describe('probeRedisOperationalCommands', () => {
  it('verifies ordinary lock and Lua commands, not only PING', async () => {
    const redis = {
      ping: vi.fn(async () => 'PONG'),
      set: vi.fn(async () => 'OK'),
      eval: vi.fn(async () => 1),
      del: vi.fn(async () => 0),
    };

    await expect(probeRedisOperationalCommands(redis as never)).resolves.toEqual({
      ping: 'PONG',
      lockAcquired: true,
      scriptExecuted: true,
    });
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^upload:ops:command-probe:/),
      expect.any(String),
      'EX',
      10,
      'NX',
    );
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('fails readiness when Redis is stuck in subscriber mode', async () => {
    const redis = {
      ping: vi.fn(async () => 'PONG'),
      set: vi.fn(async () => {
        throw new Error("ERR only SUBSCRIBE commands are allowed in this context");
      }),
      eval: vi.fn(),
      del: vi.fn(async () => 0),
    };

    await expect(probeRedisOperationalCommands(redis as never)).rejects.toThrow(/SUBSCRIBE/);
    expect(redis.eval).not.toHaveBeenCalled();
  });
});
