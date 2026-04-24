import { describe, expect, it } from 'vitest';
import {
  CONSOLE_LOG_ENTRY_INDEX_NAME,
  reconcileConsoleLogEntryIndex,
  type ConsoleLogsIndexCollectionLike,
} from '../consoleLogIndexBootstrap';

type IndexDefinition = {
  key: Record<string, number>;
  name: string;
  unique?: boolean;
};

type DuplicateEntry = {
  _id: {
    fileId: string;
    index: number;
  };
  count: number;
};

class FakeConsoleLogsCollection implements ConsoleLogsIndexCollectionLike {
  public readonly createCalls: Array<{ key: Record<string, number>; options?: { name?: string; unique?: boolean } }> =
    [];
  public readonly dropCalls: string[] = [];
  public readonly aggregatePipelines: object[][] = [];

  private indexes: IndexDefinition[];
  private duplicateEntries: DuplicateEntry[];

  constructor(indexes: IndexDefinition[], duplicateEntries: DuplicateEntry[] = []) {
    this.indexes = indexes.map((index) => ({
      key: { ...index.key },
      name: index.name,
      unique: index.unique,
    }));
    this.duplicateEntries = duplicateEntries.map((entry) => ({
      _id: { ...entry._id },
      count: entry.count,
    }));
  }

  listIndexes() {
    return {
      toArray: async () =>
        this.indexes.map((index) => ({
          key: { ...index.key },
          name: index.name,
          unique: index.unique,
        })),
    };
  }

  async createIndex(key: Record<string, number>, options?: { name?: string; unique?: boolean }) {
    this.createCalls.push({
      key: { ...key },
      options: options ? { ...options } : undefined,
    });

    const name = options?.name ?? Object.entries(key).map(([entryKey, value]) => `${entryKey}_${value}`).join('_');
    this.indexes = this.indexes.filter((index) => index.name !== name);
    this.indexes.push({
      key: { ...key },
      name,
      unique: options?.unique,
    });

    return name;
  }

  async dropIndex(name: string) {
    this.dropCalls.push(name);
    this.indexes = this.indexes.filter((index) => index.name !== name);
  }

  aggregate(pipeline: object[]) {
    this.aggregatePipelines.push([...pipeline]);
    return {
      toArray: async () => this.duplicateEntries,
    };
  }

  getIndexes() {
    return this.indexes.map((index) => ({
      key: { ...index.key },
      name: index.name,
      unique: index.unique,
    }));
  }
}

describe('reconcileConsoleLogEntryIndex', () => {
  it('creates the unique console log entry index when it does not exist', async () => {
    const collection = new FakeConsoleLogsCollection([{ key: { fileId: 1 }, name: 'fileId_1' }]);

    await expect(reconcileConsoleLogEntryIndex(collection)).resolves.toBe('created');

    expect(collection.createCalls).toEqual([
      {
        key: { fileId: 1, index: 1 },
        options: { name: CONSOLE_LOG_ENTRY_INDEX_NAME, unique: true },
      },
    ]);
    expect(collection.dropCalls).toEqual([]);
  });

  it('reuses an existing exact unique console log entry index', async () => {
    const collection = new FakeConsoleLogsCollection([
      { key: { fileId: 1, index: 1 }, name: 'fileId_1_index_1', unique: true },
    ]);

    await expect(reconcileConsoleLogEntryIndex(collection)).resolves.toBe('reused');

    expect(collection.createCalls).toEqual([]);
    expect(collection.dropCalls).toEqual([]);
    expect(collection.aggregatePipelines).toEqual([]);
  });

  it('upgrades a legacy non-unique console log entry index when there are no duplicates', async () => {
    const collection = new FakeConsoleLogsCollection([
      { key: { fileId: 1, index: 1 }, name: 'fileId_1_index_1' },
    ]);

    await expect(reconcileConsoleLogEntryIndex(collection)).resolves.toBe('upgraded');

    expect(collection.dropCalls).toEqual(['fileId_1_index_1']);
    expect(collection.createCalls).toEqual([
      {
        key: { fileId: 1, index: 1 },
        options: { name: CONSOLE_LOG_ENTRY_INDEX_NAME, unique: true },
      },
    ]);
    expect(collection.getIndexes()).toContainEqual({
      key: { fileId: 1, index: 1 },
      name: CONSOLE_LOG_ENTRY_INDEX_NAME,
      unique: true,
    });
  });

  it('fails safely when duplicate console log rows would block the upgrade', async () => {
    const collection = new FakeConsoleLogsCollection(
      [{ key: { fileId: 1, index: 1 }, name: 'fileId_1_index_1' }],
      [{ _id: { fileId: 'file-123', index: 7 }, count: 2 }],
    );

    await expect(reconcileConsoleLogEntryIndex(collection)).rejects.toThrow(
      /manual cleanup is required before startup can continue/i,
    );

    expect(collection.dropCalls).toEqual([]);
    expect(collection.createCalls).toEqual([]);
  });

  it('is idempotent across repeated startup runs after a successful upgrade', async () => {
    const collection = new FakeConsoleLogsCollection([
      { key: { fileId: 1, index: 1 }, name: 'fileId_1_index_1' },
    ]);

    await expect(reconcileConsoleLogEntryIndex(collection)).resolves.toBe('upgraded');
    await expect(reconcileConsoleLogEntryIndex(collection)).resolves.toBe('reused');

    expect(collection.dropCalls).toEqual(['fileId_1_index_1']);
    expect(collection.createCalls).toHaveLength(1);
  });
});
