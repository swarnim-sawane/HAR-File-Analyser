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
  getQueue?: (name: string, options?: Record<string, unknown>) => Promise<OracleAqQueueLike>;
  commit: () => Promise<void>;
  rollback?: () => Promise<void>;
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
    number?: unknown;
    string?: unknown;
  };
  oracleDriver?: {
    AQ_DEQ_MODE_REMOVE?: number;
    AQ_DEQ_NAV_FIRST_MSG?: number;
    AQ_DEQ_NO_WAIT?: number;
    AQ_MSG_DELIV_MODE_PERSISTENT?: number;
    AQ_VISIBILITY_ON_COMMIT?: number;
    DB_TYPE_JSON?: unknown;
  };
};

interface AddJobOptions {
  attempts?: number;
  backoff?: {
    type?: string;
    delay?: number;
  };
}

interface OracleAqQueueLike {
  enqOptions?: Record<string, unknown>;
  deqOptions?: Record<string, unknown>;
  enqOne: (message: Record<string, unknown>) => Promise<any>;
  deqOne: () => Promise<any | undefined>;
}

interface OracleAqJobQueueOptions {
  autoCreate?: boolean;
  queuePrefix?: string;
}

interface OracleAqJobPayload<T = any> {
  id: string;
  name: string;
  data: T;
  attemptsMade: number;
  maxAttempts: number;
  backoffDelayMs: number;
  createdAt: string;
}

interface ClaimedOracleAqJob {
  connection: OracleConnectionLike;
  payload: OracleAqJobPayload;
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
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString('utf8')) as T;
  return value as T;
}

function normalizeOracleQueueIdentifier(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const withPrefix = /^[A-Z]/.test(normalized) ? normalized : `Q_${normalized}`;
  const compact = withPrefix.replace(/_+/g, '_').slice(0, 128);

  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(compact)) {
    throw new Error(`Invalid Oracle AQ queue identifier derived from: ${value}`);
  }

  return compact;
}

function buildPhysicalAqQueueName(logicalQueueName: string, queuePrefix?: string): string {
  const prefix = normalizeOracleQueueIdentifier(queuePrefix || process.env.ORACLE_AQ_QUEUE_PREFIX || 'HAR_ANALYZER');
  const logical = normalizeOracleQueueIdentifier(logicalQueueName);
  const availableLogicalLength = Math.max(1, 127 - prefix.length);
  return normalizeOracleQueueIdentifier(`${prefix}_${logical.slice(0, availableLogicalLength)}`);
}

function getOracleAqDriver(db: OracleRuntimeDatabase) {
  return {
    AQ_DEQ_MODE_REMOVE: db.oracleDriver?.AQ_DEQ_MODE_REMOVE ?? 3,
    AQ_DEQ_NAV_FIRST_MSG: db.oracleDriver?.AQ_DEQ_NAV_FIRST_MSG ?? 1,
    AQ_DEQ_NO_WAIT: db.oracleDriver?.AQ_DEQ_NO_WAIT ?? 0,
    AQ_MSG_DELIV_MODE_PERSISTENT: db.oracleDriver?.AQ_MSG_DELIV_MODE_PERSISTENT ?? 1,
    AQ_VISIBILITY_ON_COMMIT: db.oracleDriver?.AQ_VISIBILITY_ON_COMMIT ?? 2,
    DB_TYPE_JSON: db.oracleDriver?.DB_TYPE_JSON ?? 'JSON',
  };
}

function parseAutoCreateEnv(value: string | undefined): boolean {
  if (value === undefined || value === '') return true;
  return !/^(false|0|no)$/i.test(value.trim());
}

async function rollbackQuietly(connection: OracleConnectionLike): Promise<void> {
  if (!connection.rollback) return;
  await connection.rollback().catch(() => undefined);
}

function isOracleAqPrivilegeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /DBMS_AQADM|DBMS_AQ|PLS-00201|ORA-01031|insufficient privileges/i.test(message);
}

function buildOracleAqSetupError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    'Oracle AQ/TEQ setup failed for HAR Analyzer. Grant the application schema EXECUTE on DBMS_AQADM and DBMS_AQ plus AQ administration privileges, ' +
      'or pre-create/start the queues and set ORACLE_AQ_AUTO_CREATE=false. Original error: ' +
      message,
  );
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

export class OracleAqJobQueue {
  public readonly physicalQueueName: string;
  private ready = false;
  private readonly claimedJobs = new Map<string, ClaimedOracleAqJob>();

  constructor(
    private readonly db: OracleRuntimeDatabase,
    private readonly queueName: string,
    private readonly options: OracleAqJobQueueOptions = {},
    private readonly now: NowProvider = () => new Date(),
  ) {
    this.physicalQueueName = buildPhysicalAqQueueName(queueName, options.queuePrefix);
  }

  private collection() {
    return this.db.collection<JobDocument>('oracle_runtime_jobs');
  }

  private autoCreateEnabled(): boolean {
    return this.options.autoCreate ?? parseAutoCreateEnv(process.env.ORACLE_AQ_AUTO_CREATE);
  }

  private jobDocumentFor(payload: OracleAqJobPayload, status: JobStatus, extra: Partial<JobDocument> = {}): JobDocument {
    const now = this.now();
    return {
      fileId: `${this.queueName}:${payload.id}`,
      index: now.getTime(),
      jobId: payload.id,
      queueName: this.queueName,
      name: payload.name,
      data: payload.data,
      status,
      attemptsMade: payload.attemptsMade,
      maxAttempts: payload.maxAttempts,
      backoffDelayMs: payload.backoffDelayMs,
      nextRunAt: extra.nextRunAt ?? iso(now),
      createdAt: payload.createdAt,
      updatedAt: iso(now),
      ...extra,
    };
  }

  private async ensureReady(connection: OracleConnectionLike): Promise<void> {
    if (this.ready) return;

    if (!connection.getQueue) {
      throw new Error('Oracle AQ requires node-oracledb connection.getQueue support.');
    }

    if (this.autoCreateEnabled()) {
      try {
        await connection.execute(
          `
            BEGIN
              DBMS_AQADM.CREATE_TRANSACTIONAL_EVENT_QUEUE(
                queue_name => :queueName,
                queue_payload_type => 'JSON'
              );
            EXCEPTION
              WHEN OTHERS THEN
                IF SQLCODE IN (-955, -24006, -24010) OR INSTR(LOWER(SQLERRM), 'already') > 0 THEN
                  NULL;
                ELSE
                  RAISE;
                END IF;
            END;`,
          { queueName: this.physicalQueueName },
        );

        await connection.execute(
          `
            BEGIN
              DBMS_AQADM.START_QUEUE(queue_name => :queueName);
            EXCEPTION
              WHEN OTHERS THEN
                IF SQLCODE IN (-24010) OR INSTR(LOWER(SQLERRM), 'already') > 0 THEN
                  NULL;
                ELSE
                  RAISE;
                END IF;
            END;`,
          { queueName: this.physicalQueueName },
        );
        await connection.commit();
      } catch (error) {
        if (isOracleAqPrivilegeError(error)) {
          throw buildOracleAqSetupError(error);
        }
        throw error;
      }
    }

    this.ready = true;
  }

  private async getAqQueue(connection: OracleConnectionLike): Promise<OracleAqQueueLike> {
    await this.ensureReady(connection);
    const driver = getOracleAqDriver(this.db);
    const queue = await connection.getQueue!(this.physicalQueueName, {
      payloadType: driver.DB_TYPE_JSON,
    });

    if (queue.enqOptions) {
      queue.enqOptions.visibility = driver.AQ_VISIBILITY_ON_COMMIT;
      queue.enqOptions.deliveryMode = driver.AQ_MSG_DELIV_MODE_PERSISTENT;
    }

    if (queue.deqOptions) {
      queue.deqOptions.mode = driver.AQ_DEQ_MODE_REMOVE;
      queue.deqOptions.navigation = driver.AQ_DEQ_NAV_FIRST_MSG;
      queue.deqOptions.visibility = driver.AQ_VISIBILITY_ON_COMMIT;
      queue.deqOptions.wait = driver.AQ_DEQ_NO_WAIT;
    }

    return queue;
  }

  private async withConnection<T>(fn: (connection: OracleConnectionLike) => Promise<T>): Promise<T> {
    if (!this.db.pool) {
      throw new Error('Oracle AQ requires an Oracle connection pool.');
    }

    const connection = await this.db.pool.getConnection();
    try {
      return await fn(connection);
    } finally {
      await connection.close();
    }
  }

  async add(name: string, data: any, options: AddJobOptions = {}): Promise<OracleQueuedJob> {
    const id = randomId('job');
    const payload: OracleAqJobPayload = {
      id,
      name,
      data,
      attemptsMade: 0,
      maxAttempts: options.attempts ?? 1,
      backoffDelayMs: options.backoff?.delay ?? 0,
      createdAt: iso(this.now()),
    };

    await this.withConnection(async (connection) => {
      try {
        const queue = await this.getAqQueue(connection);
        await queue.enqOne({
          payload,
          correlation: id,
        });
        await connection.commit();
      } catch (error) {
        await rollbackQuietly(connection);
        throw error;
      }
    });

    await this.collection().insertOne(this.jobDocumentFor(payload, 'waiting'));
    return { id, name, data, attemptsMade: 0 };
  }

  async claimNext(): Promise<OracleQueuedJob | null> {
    if (!this.db.pool) {
      throw new Error('Oracle AQ requires an Oracle connection pool.');
    }

    const connection = await this.db.pool.getConnection();
    let claimedThisConnection = false;
    try {
      const queue = await this.getAqQueue(connection);
      const message = await queue.deqOne();
      if (!message) {
        await rollbackQuietly(connection);
        await connection.close();
        return null;
      }

      const payload = parseStoredDocument<OracleAqJobPayload>(message.payload);
      if (this.claimedJobs.has(payload.id)) {
        await rollbackQuietly(connection);
        await connection.close();
        throw new Error(`Oracle AQ job ${payload.id} is already claimed by this worker.`);
      }

      await this.collection().insertOne(this.jobDocumentFor(payload, 'active'));
      this.claimedJobs.set(payload.id, { connection, payload });
      claimedThisConnection = true;

      return {
        id: payload.id,
        name: payload.name,
        data: payload.data,
        attemptsMade: payload.attemptsMade,
      };
    } catch (error) {
      if (!claimedThisConnection) {
        await rollbackQuietly(connection);
        await connection.close().catch(() => undefined);
      }
      throw error;
    }
  }

  async complete(jobId: string, result: any): Promise<void> {
    const claimed = this.claimedJobs.get(jobId);
    if (!claimed) {
      const existing = await this.collection().findOne({ queueName: this.queueName, jobId });
      if (!existing) return;
      await this.collection().insertOne({
        ...existing,
        status: 'completed',
        result,
        updatedAt: iso(this.now()),
      });
      return;
    }

    try {
      await this.collection().insertOne(this.jobDocumentFor(claimed.payload, 'completed', { result }));
      await claimed.connection.commit();
    } catch (error) {
      await rollbackQuietly(claimed.connection);
      throw error;
    } finally {
      this.claimedJobs.delete(jobId);
      await claimed.connection.close().catch(() => undefined);
    }
  }

  async fail(jobId: string, error: unknown): Promise<JobStatus> {
    const claimed = this.claimedJobs.get(jobId);
    if (!claimed) {
      const existing = await this.collection().findOne({ queueName: this.queueName, jobId });
      if (!existing) return 'failed';
      await this.collection().insertOne({
        ...existing,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: iso(this.now()),
      });
      return 'failed';
    }

    const attemptsMade = claimed.payload.attemptsMade + 1;
    const shouldRetry = attemptsMade < claimed.payload.maxAttempts;
    const status: JobStatus = shouldRetry ? 'waiting' : 'failed';
    const retryDelayMs = claimed.payload.backoffDelayMs * Math.max(1, attemptsMade);
    const nextRunAt = new Date(this.now().getTime() + retryDelayMs);
    const nextPayload: OracleAqJobPayload = {
      ...claimed.payload,
      attemptsMade,
    };

    try {
      if (shouldRetry) {
        const queue = await this.getAqQueue(claimed.connection);
        await queue.enqOne({
          payload: nextPayload,
          correlation: jobId,
          delay: Math.ceil(retryDelayMs / 1000),
        });
      }

      await this.collection().insertOne(this.jobDocumentFor(nextPayload, status, {
        nextRunAt: iso(nextRunAt),
        error: error instanceof Error ? error.message : String(error),
      }));
      await claimed.connection.commit();
      return status;
    } catch (innerError) {
      await rollbackQuietly(claimed.connection);
      throw innerError;
    } finally {
      this.claimedJobs.delete(jobId);
      await claimed.connection.close().catch(() => undefined);
    }
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
    const claimed = Array.from(this.claimedJobs.values());
    this.claimedJobs.clear();
    await Promise.allSettled(
      claimed.map(async ({ connection }) => {
        await rollbackQuietly(connection);
        await connection.close();
      }),
    );
  }
}

export type OracleQueueAdapter = OracleJobQueue | OracleAqJobQueue;

export class OracleQueueWorker extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private activeCount = 0;
  private closed = false;

  constructor(
    private readonly queue: OracleQueueAdapter,
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
