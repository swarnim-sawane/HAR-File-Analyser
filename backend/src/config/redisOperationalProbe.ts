import crypto from 'crypto';
import type Redis from 'ioredis';

type RedisOperationalClient = Pick<Redis, 'ping' | 'set' | 'eval' | 'del'>;

const RELEASE_PROBE_KEY_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface RedisOperationalProbeResult {
  ping: string;
  lockAcquired: boolean;
  scriptExecuted: boolean;
}

export async function probeRedisOperationalCommands(
  redis: RedisOperationalClient,
): Promise<RedisOperationalProbeResult> {
  const token = crypto.randomUUID();
  const key = `upload:ops:command-probe:${crypto.randomUUID()}`;

  try {
    const ping = await redis.ping();
    const acquired = await redis.set(key, token, 'EX', 10, 'NX');
    if (acquired !== 'OK') {
      throw new Error('Redis command probe could not acquire its temporary lock.');
    }

    const released = await redis.eval(RELEASE_PROBE_KEY_SCRIPT, 1, key, token);
    if (released !== 1) {
      throw new Error('Redis command probe Lua script did not release its temporary lock.');
    }

    return {
      ping,
      lockAcquired: true,
      scriptExecuted: true,
    };
  } finally {
    await redis.del(key).catch(() => 0);
  }
}
