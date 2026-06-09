import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateLocalDevEnvironment } = require('../../../scripts/dev-all.cjs') as {
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
});
