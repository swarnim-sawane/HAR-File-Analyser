import { describe, expect, it } from 'vitest';
import { buildBullMqConnectionOptions } from './bullmqConfig';

describe('buildBullMqConnectionOptions', () => {
  it('preserves the supplied connection and disables only the optional version check', () => {
    const connection = { host: '127.0.0.1', port: 6379 };

    expect(buildBullMqConnectionOptions(connection, {})).toEqual({
      connection,
      skipVersionCheck: true,
    });
  });

  it('uses an explicit queue prefix for Redis ACL key namespaces', () => {
    const connection = { host: '127.0.0.1', port: 6379 };

    expect(buildBullMqConnectionOptions(connection, {
      BULLMQ_PREFIX: '  ocid1.generativeaihostedapplicationiam.example  ',
    })).toEqual({
      connection,
      skipVersionCheck: true,
      prefix: 'ocid1.generativeaihostedapplicationiam.example',
    });
  });
});
