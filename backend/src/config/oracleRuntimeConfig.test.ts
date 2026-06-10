import { describe, expect, it } from 'vitest';
import { buildPersistenceConfig, getPersistenceBackend, getPersistenceLabel } from './database';

describe('Oracle-only backend runtime configuration', () => {
  it('requires Oracle JSON persistence settings', () => {
    const config = buildPersistenceConfig({
      PERSISTENCE_BACKEND: 'oracle-json',
      ORACLE_DB_USER: 'HAR_APP',
      ORACLE_DB_PASSWORD: 'secret',
      ORACLE_DB_CONNECT_STRING: 'localhost:1521/FREEPDB1',
      ORACLE_JSON_TABLE: 'HAR_ANALYZER_DOCS',
    });

    expect(config).toEqual({
      backend: 'oracle-json',
      oracle: {
        user: 'HAR_APP',
        password: 'secret',
        connectString: 'localhost:1521/FREEPDB1',
        tableName: 'HAR_ANALYZER_DOCS',
        poolMin: undefined,
        poolMax: undefined,
      },
    });
  });

  it('rejects non-Oracle persistence backends on this branch', () => {
    expect(() =>
      buildPersistenceConfig({
        PERSISTENCE_BACKEND: 'non-oracle',
        ORACLE_DB_USER: 'HAR_APP',
        ORACLE_DB_PASSWORD: 'secret',
        ORACLE_DB_CONNECT_STRING: 'localhost:1521/FREEPDB1',
      }),
    ).toThrow('This branch is Oracle-only');
  });

  it('labels the active backend as Oracle JSON Database', () => {
    expect(getPersistenceBackend()).toBe('oracle-json');
    expect(getPersistenceLabel()).toBe('Oracle JSON Database');
  });
});
