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
});
