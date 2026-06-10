import { EventEmitter } from 'events';
import type { OracleJsonDatabase } from '../persistence/oracleJsonStore';

type NowProvider = () => Date;
type JobStatus = 'waiting' | 'active' | 'completed' | 'failed';
type QueueCountStatus = JobStatus | 'delayed';

interface CacheDocument {
  fileId: string;
  key: string;
  value?: string;
  members?: string[];
  expiresAt?: string;
  updatedAt: string;
}

interface EventDocument {
  fileId: string;
  index: number;
  channel: string;
  message: string;
  createdAt: string;
}

export interface OracleQueuedJob<T = any> {
  id: string;
  name: string;
  data: T;
  attemptsMade: number;
}

interface JobDocument {
  fileId: string;
  index: number;
  jobId: string;
  queueName: string;
  name: string;
  data: any;
  status: JobStatus;
  attemptsMade: number;
  maxAttempts: number;
  backoffDelayMs: number;
  nextRunAt: string;
  result?: any;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

type OracleConnectionLike = {
  execute: (sql: string, binds?: Record<string, unknown>, options?: Record<string, unknown>) => Promise<any>;
  commit: () => Promise<void>;
  close: () => Promise<void>;
};

type OracleRuntimeDatabase = OracleJsonDatabase & {
  pool?: {
    getConnection: () => Promise<OracleConnectionLike>;
  };
  tableName?: string;
  outFormatObject?: unknown;
  bindTypes?: {
    clob?: unknown;
    string?: unknown;
  };
};

interface AddJobOptions {
  attempts?: number;
  backoff?: {
    type?: string;
    delay?: number;
  };
}

function iso(date: Date): string {
  return date.toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
}

function isExpired(doc: { expiresAt?: string }, now: Date): boolean {
  return Boolean(doc.expiresAt && doc.expiresAt <= iso(now));
}

function parseStoredDocument<T>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T;
  if (value && typeof value === 'object' && 'toString' in value) return JSON.parse(String(value)) as T;
  return value as T;
}

export class OracleCacheStore {
  constructor(
    private readonly db: OracleJsonDatabase,
    private readonly now: NowProvider = () => new Date(),
  ) {}

  private cacheCollection() {
    return this.db.collection<CacheDocument>('oracle_runtime_cache');
  }

  private setCollection() {
    return this.db.collection<CacheDocument>('oracle_runtime_sets');
  }

  async ping(): Promise<'PONG'> {
    await this.db.command({ ping: 1 });
    return 'PONG';
  }

  async get(key: string): Promise<string | null> {
    const doc = await this.cacheCollection().findOne({ fileId: key });
    if (!doc) return null;
    if (isExpired(doc, this.now())) {
      await this.cacheCollection().deleteMany({ fileId: key });
      return null;
    }
    return doc.value ?? null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    await this.cacheCollection().insertOne({
      fileId: key,
      key,
      value,
      updatedAt: iso(this.now()),
    });
    return 'OK';
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<'OK'> {
    const expiresAt = new Date(this.now().getTime() + ttlSeconds * 1000);
    await this.cacheCollection().insertOne({
      fileId: key,
      key,
      value,
      expiresAt: iso(expiresAt),
      updatedAt: iso(this.now()),
    });
    return 'OK';
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const existing = await this.setCollection().findOne({ fileId: key });
    const before = new Set(existing?.members ?? []);
    for (const member of members) before.add(member);

    await this.setCollection().insertOne({
      fileId: key,
      key,
      members: Array.from(before).sort(),
      expiresAt: existing?.expiresAt,
      updatedAt: iso(this.now()),
    });

    return before.size - (existing?.members?.length ?? 0);
  }

  async scard(key: string): Promise<number> {
    const doc = await this.setCollection().findOne({ fileId: key });
    if (!doc) return 0;
    if (isExpired(doc, this.now())) {
      await this.setCollection().deleteMany({ fileId: key });
      return 0;
    }
    return doc.members?.length ?? 0;
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    const expiresAt = iso(new Date(this.now().getTime() + ttlSeconds * 1000));
    let changed = 0;
    const cacheDoc = await this.cacheCollection().findOne({ fileId: key });
    if (cacheDoc) {
      await this.cacheCollection().insertOne({ ...cacheDoc, expiresAt, updatedAt: iso(this.now()) });
      changed = 1;
    }
    const setDoc = await this.setCollection().findOne({ fileId: key });
    if (setDoc) {
      await this.setCollection().insertOne({ ...setDoc, expiresAt, updatedAt: iso(this.now()) });
      changed = 1;
    }
    return changed;
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      deleted += (await this.cacheCollection().deleteMany({ fileId: key })).deletedCount ?? 0;
      deleted += (await this.setCollection().deleteMany({ fileId: key })).deletedCount ?? 0;
    }
    return deleted;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = wildcardToRegExp(pattern);
    const now = this.now();
    const cacheDocs = await this.cacheCollection().find({}).toArray();
    const setDocs = await this.setCollection().find({}).toArray();
    const keys = new Set<string>();

    for (const doc of [...cacheDocs, ...setDocs]) {
      if (!isExpired(doc, now) && regex.test(doc.key)) {
        keys.add(doc.key);
      }
    }

    return Array.from(keys).sort();
  }

  async exists(key: string): Promise<number> {
    return (await this.get(key)) === null ? 0 : 1;
  }

  async incr(key: string): Promise<number> {
    const current = Number.parseInt((await this.get(key)) ?? '0', 10) || 0;
    const next = current + 1;
    await this.set(key, String(next));
    return next;
  }

  async quit(): Promise<void> {
    return undefined;
  }
}

export class OracleEventBus {
  constructor(
    private readonly db: OracleJsonDatabase,
    private readonly now: NowProvider = () => new Date(),
  ) {}

  private collection() {
    return this.db.collection<EventDocument>('oracle_runtime_events');
  }

  async publish(channel: string, message: string): Promise<number> {
    const index = this.now().getTime() * 1000 + Math.floor(Math.random() * 1000);
    await this.collection().insertOne({
      fileId: `${channel}:${index}`,
      index,
      channel,
      message,
      createdAt: iso(this.now()),
    });
    return 1;
  }

  async poll(channel: string, afterIndex: number, limit = 100): Promise<EventDocument[]> {
    return this.collection()
      .find({ channel, index: { $gt: afterIndex } })
      .sort({ index: 1 })
      .limit(limit)
      .toArray();
  }
}

export class OracleJobQueue {
  constructor(
    private readonly db: OracleRuntimeDatabase,
    private readonly queueName: string,
    private readonly now: NowProvider = () => new Date(),
  ) {}

  private collection() {
    return this.db.collection<JobDocument>('oracle_runtime_jobs');
  }

  async add(name: string, data: any, options: AddJobOptions = {}): Promise<OracleQueuedJob> {
    const id = randomId('job');
    const now = this.now();
    const doc: JobDocument = {
      fileId: `${this.queueName}:${id}`,
      index: now.getTime(),
      jobId: id,
      queueName: this.queueName,
      name,
      data,
      status: 'waiting',
      attemptsMade: 0,
      maxAttempts: options.attempts ?? 1,
      backoffDelayMs: options.backoff?.delay ?? 0,
      nextRunAt: iso(now),
      createdAt: iso(now),
      updatedAt: iso(now),
    };

    await this.collection().insertOne(doc);
    return { id, name, data, attemptsMade: 0 };
  }

  private async claimNextPortable(): Promise<OracleQueuedJob | null> {
    const now = this.now();
    const [doc] = await this.collection()
      .find({ queueName: this.queueName, status: 'waiting', nextRunAt: { $lte: iso(now) } })
      .sort({ index: 1 })
      .limit(1)
      .toArray();

    if (!doc) return null;

    await this.collection().insertOne({
      ...doc,
      status: 'active',
      updatedAt: iso(now),
    });

    return {
      id: doc.jobId,
      name: doc.name,
      data: doc.data,
      attemptsMade: doc.attemptsMade,
    };
  }

  async claimNext(): Promise<OracleQueuedJob | null> {
    if (!this.db.pool || !this.db.tableName) {
      return this.claimNextPortable();
    }

    const now = this.now();
    const connection = await this.db.pool.getConnection();
    try {
      const selectSql = `
        SELECT DOC_ID, DOC
        FROM ${this.db.tableName}
        WHERE COLLECTION_NAME = :collectionName
          AND JSON_VALUE(DOC, '$.queueName' RETURNING VARCHAR2(256) NULL ON ERROR) = :queueName
          AND STATUS_VALUE = 'waiting'
          AND JSON_VALUE(DOC, '$.nextRunAt' RETURNING VARCHAR2(64) NULL ON ERROR) <= :nowValue
          AND ROWNUM = 1
        FOR UPDATE SKIP LOCKED`;

      const result = await connection.execute(
        selectSql,
        {
          collectionName: 'oracle_runtime_jobs',
          queueName: this.queueName,
          nowValue: iso(now),
        },
        { outFormat: this.db.outFormatObject, maxRows: 1 },
      );
      const row = result.rows?.[0];
      if (!row) return null;

      const doc = parseStoredDocument<JobDocument>(row.DOC ?? row.doc);
      const docId = String(row.DOC_ID ?? row.doc_id);
      const updated: JobDocument = {
        ...doc,
        status: 'active',
        updatedAt: iso(now),
      };

      await connection.execute(
        `
          UPDATE ${this.db.tableName}
          SET STATUS_VALUE = :statusValue,
              DOC = :doc,
              UPDATED_AT = SYSTIMESTAMP
          WHERE COLLECTION_NAME = :collectionName
            AND DOC_ID = :docId`,
        {
          statusValue: updated.status,
          doc: JSON.stringify(updated),
          collectionName: 'oracle_runtime_jobs',
          docId,
        },
        this.db.bindTypes?.clob
          ? {
              bindDefs: {
                statusValue: { type: this.db.bindTypes.string, maxSize: 64 },
                doc: { type: this.db.bindTypes.clob },
                collectionName: { type: this.db.bindTypes.string, maxSize: 64 },
                docId: { type: this.db.bindTypes.string, maxSize: 256 },
              },
            }
          : undefined,
      );
      await connection.commit();

      return {
        id: doc.jobId,
        name: doc.name,
        data: doc.data,
        attemptsMade: doc.attemptsMade,
      };
    } finally {
      await connection.close();
    }
  }

  async complete(jobId: string, result: any): Promise<void> {
    const doc = await this.collection().findOne({ queueName: this.queueName, jobId });
    if (!doc) return;
    await this.collection().insertOne({
      ...doc,
      status: 'completed',
      result,
      updatedAt: iso(this.now()),
    });
  }

  async fail(jobId: string, error: unknown): Promise<JobStatus> {
    const doc = await this.collection().findOne({ queueName: this.queueName, jobId });
    if (!doc) return 'failed';

    const attemptsMade = doc.attemptsMade + 1;
    const shouldRetry = attemptsMade < doc.maxAttempts;
    const status: JobStatus = shouldRetry ? 'waiting' : 'failed';
    const nextRunAt = new Date(this.now().getTime() + doc.backoffDelayMs * Math.max(1, attemptsMade));

    await this.collection().insertOne({
      ...doc,
      status,
      attemptsMade,
      nextRunAt: iso(nextRunAt),
      error: error instanceof Error ? error.message : String(error),
      updatedAt: iso(this.now()),
    });

    return status;
  }

  async getJobCounts(...statuses: QueueCountStatus[]) {
    const result: Record<string, number> = {};
    const now = iso(this.now());
    for (const status of statuses) {
      if (status === 'delayed') {
        result[status] = await this.collection().countDocuments({
          queueName: this.queueName,
          status: 'waiting',
          nextRunAt: { $gt: now },
        });
      } else if (status === 'waiting') {
        result[status] = await this.collection().countDocuments({
          queueName: this.queueName,
          status,
          nextRunAt: { $lte: now },
        });
      } else {
        result[status] = await this.collection().countDocuments({ queueName: this.queueName, status });
      }
    }
    return result;
  }

  async close(): Promise<void> {
    return undefined;
  }
}

export class OracleQueueWorker extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private activeCount = 0;
  private closed = false;

  constructor(
    private readonly queue: OracleJobQueue,
    private readonly processor: (job: OracleQueuedJob) => Promise<any>,
    private readonly options: { concurrency?: number; pollIntervalMs?: number } = {},
  ) {
    super();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.options.pollIntervalMs ?? 500);
    void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.closed) return;
    try {
      const concurrency = this.options.concurrency ?? 1;
      while (this.activeCount < concurrency) {
        const job = await this.queue.claimNext();
        if (!job) return;
        this.activeCount += 1;
        void this.runJob(job);
      }
    } catch (error) {
      console.error('Oracle queue polling failed:', error);
    }
  }

  private async runJob(job: OracleQueuedJob): Promise<void> {
    try {
      const result = await this.processor(job);
      await this.queue.complete(job.id, result);
      this.emit('completed', job, result);
    } catch (error) {
      await this.queue.fail(job.id, error);
      this.emit('failed', job, error);
    } finally {
      this.activeCount -= 1;
      void this.tick();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
