import { describe, expect, it, vi } from 'vitest';
import { ensureMongoIndex } from './database';

describe('ensureMongoIndex', () => {
  it('skips creation when an equivalent unique index already exists under another name', async () => {
    const collection = {
      indexes: vi.fn().mockResolvedValue([
        {
          name: 'console_logs_fileId_index_unique',
          key: { fileId: 1, index: 1 },
          unique: true,
        },
      ]),
      createIndex: vi.fn(),
    };

    await ensureMongoIndex(collection, { fileId: 1, index: 1 }, { unique: true });

    expect(collection.indexes).toHaveBeenCalledTimes(1);
    expect(collection.createIndex).not.toHaveBeenCalled();
  });

  it('creates the index when no equivalent index exists', async () => {
    const collection = {
      indexes: vi.fn().mockResolvedValue([{ name: '_id_', key: { _id: 1 } }]),
      createIndex: vi.fn().mockResolvedValue('fileId_1_index_1'),
    };

    await ensureMongoIndex(collection, { fileId: 1, index: 1 }, { unique: true });

    expect(collection.createIndex).toHaveBeenCalledWith({ fileId: 1, index: 1 }, { unique: true });
  });

  it('creates the index when the collection does not exist yet', async () => {
    const collection = {
      indexes: vi.fn().mockRejectedValue(Object.assign(
        new Error('ns does not exist: har-analyzer.ai_usage_events'),
        { code: 26, codeName: 'NamespaceNotFound' },
      )),
      createIndex: vi.fn().mockResolvedValue('requestId_1'),
    };

    await expect(
      ensureMongoIndex(collection, { requestId: 1 }, { unique: true }),
    ).resolves.toBe('requestId_1');

    expect(collection.createIndex).toHaveBeenCalledWith({ requestId: 1 }, { unique: true });
  });

  it('does not hide unrelated index lookup failures', async () => {
    const failure = Object.assign(new Error('authentication failed'), { code: 13 });
    const collection = {
      indexes: vi.fn().mockRejectedValue(failure),
      createIndex: vi.fn(),
    };

    await expect(ensureMongoIndex(collection, { requestId: 1 })).rejects.toBe(failure);
    expect(collection.createIndex).not.toHaveBeenCalled();
  });
});
