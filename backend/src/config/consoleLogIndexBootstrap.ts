import type { Document } from 'mongodb';

export const CONSOLE_LOG_ENTRY_INDEX_NAME = 'console_logs_fileId_index_unique';

const CONSOLE_LOG_ENTRY_INDEX_KEY = {
  fileId: 1,
  index: 1,
} as const;

export type ConsoleLogEntryIndexStatus = 'created' | 'reused' | 'upgraded';

type IndexKey = Record<string, number>;

type IndexDescriptionLike = {
  key: IndexKey;
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

export interface ConsoleLogsIndexCollectionLike {
  listIndexes(): { toArray(): Promise<IndexDescriptionLike[]> };
  createIndex(key: IndexKey, options?: { name?: string; unique?: boolean }): Promise<string>;
  dropIndex(name: string): Promise<unknown>;
  aggregate(pipeline: Document[]): { toArray(): Promise<Document[]> };
}

export async function reconcileConsoleLogEntryIndex(
  collection: ConsoleLogsIndexCollectionLike,
): Promise<ConsoleLogEntryIndexStatus> {
  const existingIndexes = await collection.listIndexes().toArray();
  const matchingIndexes = existingIndexes.filter(isConsoleLogEntryIndex);

  if (matchingIndexes.some((index) => index.unique)) {
    return 'reused';
  }

  const legacyIndex = matchingIndexes[0];

  if (!legacyIndex) {
    await collection.createIndex(CONSOLE_LOG_ENTRY_INDEX_KEY, {
      name: CONSOLE_LOG_ENTRY_INDEX_NAME,
      unique: true,
    });
    return 'created';
  }

  const duplicateEntries = await findDuplicateConsoleLogEntries(collection);
  if (duplicateEntries.length > 0) {
    const firstDuplicate = duplicateEntries[0];
    throw new Error(
      `console_logs request lookup index blocked by duplicates. Legacy index "${legacyIndex.name}" is non-unique and manual cleanup is required before startup can continue. Example duplicate: fileId="${firstDuplicate._id.fileId}", index=${firstDuplicate._id.index}, count=${firstDuplicate.count}.`,
    );
  }

  await collection.dropIndex(legacyIndex.name);
  await collection.createIndex(CONSOLE_LOG_ENTRY_INDEX_KEY, {
    name: CONSOLE_LOG_ENTRY_INDEX_NAME,
    unique: true,
  });

  return 'upgraded';
}

function isConsoleLogEntryIndex(index: IndexDescriptionLike): boolean {
  return hasExactIndexKey(index.key, CONSOLE_LOG_ENTRY_INDEX_KEY);
}

function hasExactIndexKey(actual: IndexKey, expected: IndexKey): boolean {
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);

  if (actualKeys.length !== expectedKeys.length) {
    return false;
  }

  return expectedKeys.every((key) => actual[key] === expected[key]);
}

async function findDuplicateConsoleLogEntries(collection: ConsoleLogsIndexCollectionLike): Promise<DuplicateEntry[]> {
  const duplicateEntries = await collection
    .aggregate([
      {
        $group: {
          _id: {
            fileId: '$fileId',
            index: '$index',
          },
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
      { $limit: 1 },
    ])
    .toArray();

  return duplicateEntries as DuplicateEntry[];
}
