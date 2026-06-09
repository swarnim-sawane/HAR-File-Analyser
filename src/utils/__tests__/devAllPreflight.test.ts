import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildDevEnvironment, parseDotEnvContent, validateLocalDevEnvironment } = require('../../../scripts/dev-all.cjs') as {
  buildDevEnvironment: (shellEnv: NodeJS.ProcessEnv, backendEnv: Record<string, string>) => NodeJS.ProcessEnv;
  parseDotEnvContent: (content: string) => Record<string, string>;
  validateLocalDevEnvironment: (env: NodeJS.ProcessEnv) => string[];
};

describe('dev-all preflight', () => {
  it('requires Oracle JSON credentials before starting local services', () => {
    expect(validateLocalDevEnvironment({ PERSISTENCE_BACKEND: 'oracle-json' })).toEqual([
      'ORACLE_DB_USER is required for Oracle JSON persistence.',
      'ORACLE_DB_PASSWORD is required for Oracle JSON persistence.',
      'ORACLE_DB_CONNECT_STRING is required for Oracle JSON persistence.',
    ]);
  });

  it('accepts complete Oracle JSON credentials', () => {
    expect(validateLocalDevEnvironment({
      PERSISTENCE_BACKEND: 'oracle-json',
      ORACLE_DB_USER: 'har_user',
      ORACLE_DB_PASSWORD: 'secret',
      ORACLE_DB_CONNECT_STRING: 'localhost/XEPDB1',
    })).toEqual([]);
  });

  it('parses backend .env values for local preflight', () => {
    expect(parseDotEnvContent(`
      # local Oracle DB
      ORACLE_DB_USER=HAR_APP
      ORACLE_DB_PASSWORD="HarLocal123"
      ORACLE_DB_CONNECT_STRING='localhost:1521/FREEPDB1'
    `)).toEqual({
      ORACLE_DB_USER: 'HAR_APP',
      ORACLE_DB_PASSWORD: 'HarLocal123',
      ORACLE_DB_CONNECT_STRING: 'localhost:1521/FREEPDB1',
    });
  });

  it('uses backend .env values while allowing shell overrides', () => {
    const env = buildDevEnvironment(
      {
        ORACLE_DB_PASSWORD: 'shell-secret',
      },
      {
        ORACLE_DB_USER: 'HAR_APP',
        ORACLE_DB_PASSWORD: 'file-secret',
        ORACLE_DB_CONNECT_STRING: 'localhost:1521/FREEPDB1',
      },
    );

    expect(env.ORACLE_DB_USER).toBe('HAR_APP');
    expect(env.ORACLE_DB_PASSWORD).toBe('shell-secret');
    expect(env.ORACLE_DB_CONNECT_STRING).toBe('localhost:1521/FREEPDB1');
    expect(validateLocalDevEnvironment(env)).toEqual([]);
  });
});
