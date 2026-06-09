import { describe, expect, it } from 'vitest';
import { buildPersistenceConfig } from './database';

describe('buildPersistenceConfig', () => {
  it('requires Oracle JSON credentials by default', () => {
    expect(() => buildPersistenceConfig({})).toThrow(/oracle json persistence requires/i);
  });

  it('builds Oracle JSON persistence config from Oracle env values', () => {
    expect(buildPersistenceConfig({
      PERSISTENCE_BACKEND: 'oracle-json',
      ORACLE_DB_USER: 'har_user',
      ORACLE_DB_PASSWORD: 'secret',
      ORACLE_DB_CONNECT_STRING: 'adb.example.oraclecloud.com/harpdb',
      ORACLE_JSON_TABLE: 'HAR_DOCS',
      ORACLE_DB_POOL_MIN: '2',
      ORACLE_DB_POOL_MAX: '8',
    })).toEqual({
      backend: 'oracle-json',
      oracle: {
        user: 'har_user',
        password: 'secret',
        connectString: 'adb.example.oraclecloud.com/harpdb',
        tableName: 'HAR_DOCS',
        poolMin: 2,
        poolMax: 8,
      },
    });
  });

  it('rejects non-Oracle persistence backends on this branch', () => {
    expect(() =>
      buildPersistenceConfig({
        PERSISTENCE_BACKEND: 'mongodb',
      }),
    ).toThrow(/oracle-only/i);
  });

  it('fails clearly when Oracle JSON mode is selected without required credentials', () => {
    expect(() =>
      buildPersistenceConfig({
        PERSISTENCE_BACKEND: 'oracle-json',
        ORACLE_DB_USER: 'har_user',
      }),
    ).toThrow(/oracle json persistence requires/i);
  });
});
