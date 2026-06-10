import { describe, expect, it } from 'vitest';
import {
  applyOracleProjection,
  buildOracleWhereClause,
  extractOracleIndexedColumns,
  OracleJsonDatabase,
} from './oracleJsonStore';

describe('oracleJsonStore SQL translation', () => {
  it('translates nested HAR filters into indexed Oracle predicates with binds', () => {
    const where = buildOracleWhereClause('har_entries', {
      fileId: 'file-1',
      'response.status': { $gte: 400, $lt: 500 },
      'request.url': { $regex: 'example\\.com', $options: 'i' },
    });

    expect(where.sql).toContain('COLLECTION_NAME = :b1');
    expect(where.sql).toContain('FILE_ID = :b2');
    expect(where.sql).toContain('RESPONSE_STATUS >= :b3');
    expect(where.sql).toContain('RESPONSE_STATUS < :b4');
    expect(where.sql).toContain('LOWER(REQUEST_URL) LIKE :b5');
    expect(where.sql).not.toContain('example.com');
    expect(where.binds).toEqual({
      b1: 'har_entries',
      b2: 'file-1',
      b3: 400,
      b4: 500,
      b5: '%example.com%',
    });
  });

  it('translates console quick-focus style filters for issue tags and severity OR clauses', () => {
    const where = buildOracleWhereClause('console_logs', {
      $and: [
        { fileId: 'log-1' },
        { issueTags: 'http-5xx' },
        {
          $or: [
            { level: 'error' },
            { inferredSeverity: 'error' },
          ],
        },
      ],
    });

    expect(where.sql).toContain('COLLECTION_NAME = :b1');
    expect(where.sql).toContain('FILE_ID = :b2');
    expect(where.sql).toContain('ISSUE_TAGS_TEXT LIKE :b3');
    expect(where.sql).toContain('(LEVEL_VALUE = :b4 OR INFERRED_SEVERITY = :b5)');
    expect(where.binds).toEqual({
      b1: 'console_logs',
      b2: 'log-1',
      b3: '%|http-5xx|%',
      b4: 'error',
      b5: 'error',
    });
  });

  it('rejects unsupported filter operators instead of building unsafe SQL', () => {
    expect(() =>
      buildOracleWhereClause('har_entries', {
        fileId: { $ne: 'file-1' },
      }),
    ).toThrow(/unsupported oracle json filter operator/i);
  });

  it('rejects unsafe JSON field paths instead of interpolating them into SQL', () => {
    expect(() =>
      buildOracleWhereClause('har_entries', {
        'request.url) FROM dual; DROP TABLE HAR_ANALYZER_DOCS; --': 'bad',
      }),
    ).toThrow(/unsupported oracle json field path/i);
  });

  it('rejects unsafe Oracle table identifiers', () => {
    expect(() =>
      new OracleJsonDatabase({} as any, 'HAR_DOCS; DROP TABLE USERS', {}),
    ).toThrow(/invalid oracle identifier/i);
  });

  it('retries transient Oracle DDL locks during schema initialization', async () => {
    let lockedOnce = false;
    const executeCalls: string[] = [];
    const connection = {
      execute: async (sql: string) => {
        executeCalls.push(sql);
        if (!lockedOnce && /CREATE INDEX/i.test(sql)) {
          lockedOnce = true;
          throw new Error('ORA-00054: resource busy and acquire with NOWAIT specified or timeout expired');
        }
        return {};
      },
      commit: async () => {},
      close: async () => {},
    };
    const pool = {
      getConnection: async () => connection,
      close: async () => {},
    };
    const database = new OracleJsonDatabase(pool as any, 'HAR_DOCS', {});

    await expect(database.initializeSchema()).resolves.toBeUndefined();
    expect(lockedOnce).toBe(true);
    expect(executeCalls.filter((sql) => /CREATE INDEX/i.test(sql)).length).toBeGreaterThan(8);
  });
});

describe('oracleJsonStore document handling', () => {
  it('extracts indexed columns from HAR entry documents', () => {
    expect(extractOracleIndexedColumns('har_entries', {
      fileId: 'file-1',
      index: 7,
      request: {
        method: 'GET',
        url: 'https://example.com/app.js',
      },
      response: {
        status: 404,
        content: {
          mimeType: 'application/javascript',
        },
      },
      time: 91.2,
      createdAt: new Date('2026-06-09T10:00:00.000Z'),
    })).toMatchObject({
      docId: 'file-1:7',
      fileId: 'file-1',
      entryIndex: 7,
      requestMethod: 'GET',
      requestUrl: 'https://example.com/app.js',
      responseStatus: 404,
      contentType: 'application/javascript',
      timeMs: 91.2,
    });
  });

  it('extracts searchable tag columns from console log documents', () => {
    expect(extractOracleIndexedColumns('console_logs', {
      fileId: 'log-1',
      index: 3,
      level: 'error',
      source: 'oracle.adf.model.log.Jpx',
      timestamp: '2026-05-09T17:20:53.443Z',
      issueTags: ['exception', 'server'],
      parseWarnings: ['Unrecognized context block'],
    })).toMatchObject({
      docId: 'log-1:3',
      fileId: 'log-1',
      entryIndex: 3,
      levelValue: 'error',
      sourceValue: 'oracle.adf.model.log.Jpx',
      timestampValue: '2026-05-09T17:20:53.443Z',
      issueTagsText: '|exception|server|',
      parseWarningsText: '|Unrecognized context block|',
    });
  });

  it('applies collection-style exclusion projection to returned JSON documents', () => {
    const projected = applyOracleProjection({
      fileId: 'log-1',
      message: 'visible',
      rawText: 'large raw text',
      args: ['hidden'],
      nested: {
        keep: true,
        secret: 'hidden',
      },
    }, {
      rawText: 0,
      args: 0,
      'nested.secret': 0,
    });

    expect(projected).toEqual({
      fileId: 'log-1',
      message: 'visible',
      nested: {
        keep: true,
      },
    });
  });

  it('binds full JSON documents as CLOBs during bulk insert', async () => {
    const executeManyCalls: Array<{ sql: string; binds: any[]; options: any }> = [];
    const connection = {
      executeMany: async (sql: string, binds: any[], options: any) => {
        executeManyCalls.push({ sql, binds, options });
        return {};
      },
      commit: async () => {},
      close: async () => {},
    };
    const pool = {
      getConnection: async () => connection,
      close: async () => {},
    };
    const database = new OracleJsonDatabase(pool as any, 'HAR_DOCS', {}, {
      string: 'STRING',
      number: 'NUMBER',
      date: 'DATE',
      clob: 'CLOB',
    });

    await database.collection('har_entries').insertMany([{
      fileId: 'file-1',
      index: 1,
      request: {
        method: 'POST',
        url: 'https://example.com/upload',
        postData: {
          text: 'x'.repeat(70_000),
        },
      },
      response: {
        status: 200,
        content: {
          mimeType: 'application/json',
          text: 'y'.repeat(70_000),
        },
      },
    }]);

    expect(executeManyCalls).toHaveLength(1);
    expect(executeManyCalls[0].options.bindDefs.doc.type).toBe('CLOB');
    expect(executeManyCalls[0].binds[0].doc.length).toBeGreaterThan(100_000);
  });
});
