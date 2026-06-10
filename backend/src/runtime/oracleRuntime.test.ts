import { describe, expect, it } from 'vitest';
import {
  OracleCacheStore,
  OracleEventBus,
  OracleJobQueue,
} from './oracleRuntime';

class MemoryCursor {
  private rows: any[];
  private limitRows?: number;

  constructor(rows: any[]) {
    this.rows = rows;
  }

  sort(sortSpec: Record<string, 1 | -1>) {
    const [[field, direction]] = Object.entries(sortSpec);
    this.rows = [...this.rows].sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * (direction === -1 ? -1 : 1);
    });
    return this;
  }

  limit(limitRows: number) {
    this.limitRows = limitRows;
    return this;
  }

  async toArray() {
    return this.limitRows === undefined ? this.rows : this.rows.slice(0, this.limitRows);
  }
}

class MemoryCollection {
  private docs = new Map<string, any>();

  private keyFor(doc: any) {
    return doc.fileId ?? doc._id ?? `${this.docs.size + 1}`;
  }

  private matches(doc: any, filter: Record<string, any>) {
    return Object.entries(filter).every(([field, expected]) => {
      const actual = doc[field];
      if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        if ('$lte' in expected && !(actual <= expected.$lte)) return false;
        if ('$gt' in expected && !(actual > expected.$gt)) return false;
        if ('$in' in expected && !expected.$in.includes(actual)) return false;
        return true;
      }
      return actual === expected;
    });
  }

  find(filter: Record<string, any> = {}) {
    return new MemoryCursor(Array.from(this.docs.values()).filter((doc) => this.matches(doc, filter)));
  }

  async findOne(filter: Record<string, any> = {}) {
    return (await this.find(filter).limit(1).toArray())[0] ?? null;
  }

  async insertOne(doc: any) {
    this.docs.set(this.keyFor(doc), JSON.parse(JSON.stringify(doc)));
    return { insertedId: this.keyFor(doc) };
  }

  async countDocuments(filter: Record<string, any> = {}) {
    return (await this.find(filter).toArray()).length;
  }

  async deleteMany(filter: Record<string, any> = {}) {
    const matches = await this.find(filter).toArray();
    for (const doc of matches) {
      this.docs.delete(this.keyFor(doc));
    }
    return { deletedCount: matches.length };
  }
}

class MemoryDb {
  private collections = new Map<string, MemoryCollection>();

  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MemoryCollection());
    }
    return this.collections.get(name)!;
  }
}

describe('OracleCacheStore', () => {
  it('stores strings, expiring values, counters, and set membership in Oracle documents', async () => {
    const cache = new OracleCacheStore(new MemoryDb() as any, () => new Date('2026-06-10T00:00:00.000Z'));

    await cache.setex('file:file-1:metadata', 60, '{"status":"processing"}');
    await cache.sadd('upload:file-1:chunks', '0', '1');
    await cache.incr('upload:file-1:attempts');
    await cache.expire('upload:file-1:chunks', 60);

    expect(await cache.get('file:file-1:metadata')).toBe('{"status":"processing"}');
    expect(await cache.scard('upload:file-1:chunks')).toBe(2);
    expect(await cache.exists('upload:file-1:attempts')).toBe(1);
    expect(await cache.keys('*:file-1:*')).toEqual([
      'file:file-1:metadata',
      'upload:file-1:attempts',
      'upload:file-1:chunks',
    ]);
  });
});

describe('OracleEventBus', () => {
  it('publishes socket envelopes and polls only new events', async () => {
    const bus = new OracleEventBus(new MemoryDb() as any, () => new Date('2026-06-10T00:00:00.000Z'));

    await bus.publish('socket:events', JSON.stringify({ type: 'upload:progress' }));
    const firstPoll = await bus.poll('socket:events', 0);
    const secondPoll = await bus.poll('socket:events', firstPoll[0].index);

    expect(firstPoll).toHaveLength(1);
    expect(JSON.parse(firstPoll[0].message).type).toBe('upload:progress');
    expect(secondPoll).toEqual([]);
  });
});

describe('OracleJobQueue', () => {
  it('enqueues, claims, completes, and counts jobs through Oracle documents', async () => {
    const queue = new OracleJobQueue(new MemoryDb() as any, 'har-processing', () => new Date('2026-06-10T00:00:00.000Z'));

    const created = await queue.add('process_file', { fileId: 'file-1' }, { attempts: 2 });
    expect(await queue.getJobCounts('waiting', 'active', 'completed')).toMatchObject({ waiting: 1 });

    const claimed = await queue.claimNext();
    expect(claimed?.id).toBe(created.id);
    expect(claimed?.data.fileId).toBe('file-1');
    expect(await queue.getJobCounts('waiting', 'active', 'completed')).toMatchObject({ active: 1 });

    await queue.complete(created.id, { success: true });
    expect(await queue.getJobCounts('waiting', 'active', 'completed')).toMatchObject({ completed: 1 });
  });
});
