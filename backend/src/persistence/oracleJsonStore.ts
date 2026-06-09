type OracleConnection = {
  execute: (sql: string, binds?: Record<string, unknown> | unknown[], options?: Record<string, unknown>) => Promise<any>;
  executeMany: (sql: string, binds: Record<string, unknown>[], options?: Record<string, unknown>) => Promise<any>;
  commit: () => Promise<void>;
  close: () => Promise<void>;
};

type OraclePool = {
  getConnection: () => Promise<OracleConnection>;
  close: (drainTime?: number) => Promise<void>;
};

type OracleModule = {
  CLOB?: unknown;
  OBJECT?: unknown;
  OUT_FORMAT_OBJECT?: unknown;
  fetchAsString?: unknown[];
  createPool: (config: Record<string, unknown>) => Promise<OraclePool>;
};

type OracleFilter = Record<string, unknown>;
type OracleSort = Record<string, 1 | -1 | 'asc' | 'desc'>;
type OracleProjection = Record<string, 0 | 1>;
type OracleInsertManyOptions = {
  ordered?: boolean;
};

interface WhereState {
  binds: Record<string, unknown>;
  nextBind: number;
}

interface OracleIndexedColumns {
  docId: string;
  fileId?: string;
  entryIndex?: number;
  uploadedAt?: Date | string;
  statusValue?: string;
  levelValue?: string;
  sourceValue?: string;
  timestampValue?: string;
  requestMethod?: string;
  requestUrl?: string;
  responseStatus?: number;
  contentType?: string;
  inferredSeverity?: string;
  parseStatus?: string;
  parseFormat?: string;
  issueTagsText?: string;
  parseWarningsText?: string;
  timeMs?: number;
}

export interface OracleJsonStoreConfig {
  user: string;
  password: string;
  connectString: string;
  tableName?: string;
  poolMin?: number;
  poolMax?: number;
  poolIncrement?: number;
}

const DEFAULT_TABLE_NAME = 'HAR_ANALYZER_DOCS';
const INDEXED_FIELD_COLUMNS: Record<string, string> = {
  fileId: 'FILE_ID',
  index: 'ENTRY_INDEX',
  uploadedAt: 'UPLOADED_AT',
  status: 'STATUS_VALUE',
  level: 'LEVEL_VALUE',
  source: 'SOURCE_VALUE',
  timestamp: 'TIMESTAMP_VALUE',
  'request.method': 'REQUEST_METHOD',
  'request.url': 'REQUEST_URL',
  'response.status': 'RESPONSE_STATUS',
  'response.content.mimeType': 'CONTENT_TYPE',
  inferredSeverity: 'INFERRED_SEVERITY',
  parseStatus: 'PARSE_STATUS',
  parseFormat: 'PARSE_FORMAT',
  time: 'TIME_MS',
};
const TAG_TEXT_COLUMNS: Record<string, string> = {
  issueTags: 'ISSUE_TAGS_TEXT',
  parseWarnings: 'PARSE_WARNINGS_TEXT',
};
const VALID_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;

function addBind(state: WhereState, value: unknown): string {
  const name = `b${state.nextBind++}`;
  state.binds[name] = value;
  return `:${name}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof RegExp);
}

function normalizeOracleIdentifier(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!VALID_IDENTIFIER.test(normalized)) {
    throw new Error(`Invalid Oracle identifier: ${value}`);
  }
  return normalized;
}

function getByPath(doc: any, path: string): unknown {
  return path.split('.').reduce((current, segment) => current?.[segment], doc);
}

function setByPath(doc: any, path: string, value: unknown): void {
  const parts = path.split('.');
  const last = parts.pop();
  if (!last) return;
  let target = doc;
  for (const part of parts) {
    if (!target[part] || typeof target[part] !== 'object') {
      target[part] = {};
    }
    target = target[part];
  }
  target[last] = value;
}

function deleteByPath(doc: any, path: string): void {
  const parts = path.split('.');
  const last = parts.pop();
  if (!last) return;
  const target = parts.reduce((current, segment) => current?.[segment], doc);
  if (target && typeof target === 'object') {
    delete target[last];
  }
}

function jsonPathForField(field: string): string {
  const segments = field.split('.');
  if (!segments.every((segment) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))) {
    throw new Error(`Unsupported Oracle JSON field path: ${field}`);
  }
  return `$.${segments.join('.')}`;
}

function jsonValueExpression(field: string): string {
  return `JSON_VALUE(DOC, '${jsonPathForField(field)}' RETURNING VARCHAR2(4000) NULL ON ERROR)`;
}

function fieldExpression(field: string): string {
  return INDEXED_FIELD_COLUMNS[field] ?? TAG_TEXT_COLUMNS[field] ?? jsonValueExpression(field);
}

function unescapeRegexLiteral(source: string): string {
  return source
    .replace(/\\\./g, '.')
    .replace(/\\\//g, '/')
    .replace(/\\-/g, '-')
    .replace(/\\_/g, '_')
    .replace(/\\ /g, ' ');
}

function regexToLikePattern(regex: RegExp | string): string {
  const source = typeof regex === 'string' ? regex : regex.source;
  const anchored = source.startsWith('^') && source.endsWith('$');
  const trimmed = anchored ? source.slice(1, -1) : source;
  const literal = unescapeRegexLiteral(trimmed)
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  return anchored ? literal.toLowerCase() : `%${literal.toLowerCase()}%`;
}

function buildTagPredicate(field: string, value: unknown, state: WhereState): string {
  const column = TAG_TEXT_COLUMNS[field];
  if (!column) {
    throw new Error(`Unsupported Oracle JSON tag field: ${field}`);
  }

  if (typeof value === 'string') {
    return `${column} LIKE ${addBind(state, `%|${value}|%`)}`;
  }

  if (value instanceof RegExp) {
    return `LOWER(${column}) LIKE ${addBind(state, regexToLikePattern(value))}`;
  }

  if (isPlainObject(value) && '$in' in value) {
    const values = value.$in;
    if (!Array.isArray(values)) throw new Error('Unsupported Oracle JSON $in value; expected array');
    return `(${values.map((item) => `${column} LIKE ${addBind(state, `%|${String(item)}|%`)}`).join(' OR ')})`;
  }

  throw new Error(`Unsupported Oracle JSON tag predicate for ${field}`);
}

function buildComparisonPredicate(field: string, operator: string, value: unknown, state: WhereState): string {
  const expr = fieldExpression(field);

  switch (operator) {
    case '$gte':
      return `${expr} >= ${addBind(state, value)}`;
    case '$gt':
      return `${expr} > ${addBind(state, value)}`;
    case '$lte':
      return `${expr} <= ${addBind(state, value)}`;
    case '$lt':
      return `${expr} < ${addBind(state, value)}`;
    case '$in':
      if (!Array.isArray(value)) throw new Error('Unsupported Oracle JSON $in value; expected array');
      if (value.length === 0) return '1 = 0';
      return `${expr} IN (${value.map((item) => addBind(state, item)).join(', ')})`;
    case '$regex': {
      const like = regexToLikePattern(String(value));
      return `LOWER(${expr}) LIKE ${addBind(state, like)}`;
    }
    case '$options':
      return '';
    default:
      throw new Error(`Unsupported Oracle JSON filter operator: ${operator}`);
  }
}

function buildFieldPredicate(field: string, value: unknown, state: WhereState): string {
  if (TAG_TEXT_COLUMNS[field]) {
    return buildTagPredicate(field, value, state);
  }

  const expr = fieldExpression(field);

  if (value instanceof RegExp) {
    const source = value.source;
    const anchored = source.startsWith('^') && source.endsWith('$');
    const like = regexToLikePattern(value);
    return anchored
      ? `LOWER(${expr}) = ${addBind(state, like)}`
      : `LOWER(${expr}) LIKE ${addBind(state, like)}`;
  }

  if (isPlainObject(value)) {
    return Object.entries(value)
      .map(([operator, operatorValue]) => buildComparisonPredicate(field, operator, operatorValue, state))
      .filter(Boolean)
      .join(' AND ');
  }

  if (value === null) {
    return `${expr} IS NULL`;
  }

  return `${expr} = ${addBind(state, value)}`;
}

function buildFilterPredicate(filter: OracleFilter, state: WhereState): string {
  const predicates = Object.entries(filter).flatMap(([field, value]) => {
    if (field === '$and') {
      if (!Array.isArray(value)) throw new Error('Unsupported Oracle JSON $and value; expected array');
      return [`(${value.map((item) => buildFilterPredicate(item as OracleFilter, state)).join(' AND ')})`];
    }

    if (field === '$or') {
      if (!Array.isArray(value)) throw new Error('Unsupported Oracle JSON $or value; expected array');
      return [`(${value.map((item) => buildFilterPredicate(item as OracleFilter, state)).join(' OR ')})`];
    }

    return [buildFieldPredicate(field, value, state)];
  }).filter(Boolean);

  return predicates.length > 0 ? predicates.join(' AND ') : '1 = 1';
}

export function buildOracleWhereClause(collectionName: string, filter: OracleFilter = {}) {
  const state: WhereState = { binds: {}, nextBind: 1 };
  const collectionPredicate = `COLLECTION_NAME = ${addBind(state, collectionName)}`;
  const filterPredicate = buildFilterPredicate(filter, state);

  return {
    sql: `${collectionPredicate}${filterPredicate === '1 = 1' ? '' : ` AND ${filterPredicate}`}`,
    binds: state.binds,
  };
}

function buildOracleOrderBy(sort?: OracleSort): string {
  if (!sort || Object.keys(sort).length === 0) {
    return 'ENTRY_INDEX ASC';
  }

  return Object.entries(sort)
    .map(([field, direction]) => {
      const expr = fieldExpression(field);
      const dir = direction === -1 || direction === 'desc' ? 'DESC' : 'ASC';
      return `${expr} ${dir}`;
    })
    .join(', ');
}

function normalizeTagText(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return `|${value.map((item) => String(item)).join('|')}|`;
}

function parseDateLike(value: unknown): Date | string | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) return value;
  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function extractOracleIndexedColumns(collectionName: string, doc: Record<string, any>): OracleIndexedColumns {
  const fileId = typeof doc.fileId === 'string' ? doc.fileId : undefined;
  const entryIndex = toFiniteNumber(doc.index);
  const docId =
    fileId && entryIndex !== undefined
      ? `${fileId}:${entryIndex}`
      : fileId ?? String(doc._id ?? cryptoRandomId());

  return {
    docId,
    fileId,
    entryIndex,
    uploadedAt: parseDateLike(doc.uploadedAt),
    statusValue: typeof doc.status === 'string' ? doc.status : undefined,
    levelValue: typeof doc.level === 'string' ? doc.level : undefined,
    sourceValue: typeof doc.source === 'string' ? doc.source : undefined,
    timestampValue: typeof doc.timestamp === 'string' ? doc.timestamp : undefined,
    requestMethod: typeof doc.request?.method === 'string' ? doc.request.method : undefined,
    requestUrl: typeof doc.request?.url === 'string' ? doc.request.url : undefined,
    responseStatus: toFiniteNumber(doc.response?.status),
    contentType: typeof doc.response?.content?.mimeType === 'string' ? doc.response.content.mimeType : undefined,
    inferredSeverity: typeof doc.inferredSeverity === 'string' ? doc.inferredSeverity : undefined,
    parseStatus: typeof doc.parseStatus === 'string' ? doc.parseStatus : undefined,
    parseFormat: typeof doc.parseFormat === 'string' ? doc.parseFormat : undefined,
    issueTagsText: normalizeTagText(doc.issueTags),
    parseWarningsText: normalizeTagText(doc.parseWarnings),
    timeMs: toFiniteNumber(doc.time),
  };
}

function cryptoRandomId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function applyOracleProjection<T extends Record<string, any>>(doc: T, projection?: OracleProjection): T {
  if (!projection || Object.keys(projection).length === 0) {
    return structuredCloneFallback(doc);
  }

  const values = Object.values(projection);
  const inclusion = values.some((value) => value === 1) && !values.some((value) => value === 0);

  if (inclusion) {
    const output: Record<string, unknown> = {};
    for (const [path, enabled] of Object.entries(projection)) {
      if (enabled !== 1) continue;
      const value = getByPath(doc, path);
      if (value !== undefined) setByPath(output, path, value);
    }
    return output as T;
  }

  const output = structuredCloneFallback(doc);
  for (const [path, enabled] of Object.entries(projection)) {
    if (enabled === 0) deleteByPath(output, path);
  }
  return output;
}

function structuredCloneFallback<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function serializeDocument(doc: Record<string, any>): string {
  return JSON.stringify(doc);
}

function parseDocument(value: unknown): Record<string, any> {
  if (typeof value === 'string') return JSON.parse(value);
  if (value && typeof value === 'object' && 'toString' in value) return JSON.parse(String(value));
  return value as Record<string, any>;
}

async function loadOracleModule(): Promise<OracleModule> {
  try {
    const dynamicImport = new Function('moduleName', 'return import(moduleName)') as (moduleName: string) => Promise<any>;
    const imported = await dynamicImport('oracledb');
    const oracleModule = (imported.default ?? imported) as OracleModule;
    if (oracleModule.CLOB) {
      oracleModule.fetchAsString = [...(oracleModule.fetchAsString ?? []), oracleModule.CLOB];
    }
    return oracleModule;
  } catch (error) {
    throw new Error(
      'Oracle JSON persistence requires the "oracledb" package from the approved Oracle/npm registry. ' +
      `Install it in backend dependencies before using PERSISTENCE_BACKEND=oracle-json. ${(error as Error).message}`,
    );
  }
}

async function withConnection<T>(pool: OraclePool, fn: (connection: OracleConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    return await fn(connection);
  } finally {
    await connection.close();
  }
}

async function ignoreAlreadyExists(connection: OracleConnection, sql: string): Promise<void> {
  try {
    await connection.execute(sql);
  } catch (error) {
    const message = (error as Error).message;
    if (!/ORA-00955|name is already used/i.test(message)) throw error;
  }
}

export class OracleJsonCursor<T extends Record<string, any>> {
  private sortSpec?: OracleSort;
  private skipRows = 0;
  private limitRows?: number;
  private projection?: OracleProjection;

  constructor(
    private readonly collection: OracleJsonCollection<T>,
    private readonly filter: OracleFilter,
  ) {}

  sort(sortSpec: OracleSort) {
    this.sortSpec = sortSpec;
    return this;
  }

  skip(skipRows: number) {
    this.skipRows = Math.max(0, skipRows);
    return this;
  }

  limit(limitRows: number) {
    this.limitRows = Math.max(0, limitRows);
    return this;
  }

  project(projection: OracleProjection) {
    this.projection = projection;
    return this;
  }

  async toArray(): Promise<T[]> {
    return this.collection.query(this.filter, {
      sort: this.sortSpec,
      skip: this.skipRows,
      limit: this.limitRows,
      projection: this.projection,
    });
  }
}

export class OracleJsonCollection<T extends Record<string, any> = Record<string, any>> {
  constructor(
    private readonly database: OracleJsonDatabase,
    private readonly collectionName: string,
  ) {}

  find(filter: OracleFilter = {}) {
    return new OracleJsonCursor<T>(this, filter);
  }

  async findOne(filter: OracleFilter = {}): Promise<T | null> {
    const [row] = await this.find(filter).limit(1).toArray();
    return row ?? null;
  }

  async countDocuments(filter: OracleFilter = {}): Promise<number> {
    const where = buildOracleWhereClause(this.collectionName, filter);
    const sql = `SELECT COUNT(*) AS COUNT_VALUE FROM ${this.database.tableName} WHERE ${where.sql}`;

    return withConnection(this.database.pool, async (connection) => {
      const result = await connection.execute(sql, where.binds, { outFormat: this.database.outFormatObject });
      return Number(result.rows?.[0]?.COUNT_VALUE ?? result.rows?.[0]?.count_value ?? 0);
    });
  }

  async insertOne(doc: T): Promise<{ insertedId: string }> {
    const result = await this.insertMany([doc]);
    return { insertedId: result.insertedIds[0] };
  }

  async insertMany(docs: T[], _options?: OracleInsertManyOptions): Promise<{ insertedCount: number; insertedIds: string[] }> {
    if (docs.length === 0) return { insertedCount: 0, insertedIds: [] };

    const binds = docs.map((doc) => {
      const indexed = extractOracleIndexedColumns(this.collectionName, doc);
      return {
        collectionName: this.collectionName,
        docId: indexed.docId,
        fileId: indexed.fileId,
        entryIndex: indexed.entryIndex,
        uploadedAt: indexed.uploadedAt,
        statusValue: indexed.statusValue,
        levelValue: indexed.levelValue,
        sourceValue: indexed.sourceValue,
        timestampValue: indexed.timestampValue,
        requestMethod: indexed.requestMethod,
        requestUrl: indexed.requestUrl,
        responseStatus: indexed.responseStatus,
        contentType: indexed.contentType,
        inferredSeverity: indexed.inferredSeverity,
        parseStatus: indexed.parseStatus,
        parseFormat: indexed.parseFormat,
        issueTagsText: indexed.issueTagsText,
        parseWarningsText: indexed.parseWarningsText,
        timeMs: indexed.timeMs,
        doc: serializeDocument(doc),
      };
    });

    const sql = `
      MERGE INTO ${this.database.tableName} target
      USING (
        SELECT :collectionName AS collection_name, :docId AS doc_id FROM dual
      ) source
      ON (target.collection_name = source.collection_name AND target.doc_id = source.doc_id)
      WHEN MATCHED THEN UPDATE SET
        file_id = :fileId,
        entry_index = :entryIndex,
        uploaded_at = :uploadedAt,
        status_value = :statusValue,
        level_value = :levelValue,
        source_value = :sourceValue,
        timestamp_value = :timestampValue,
        request_method = :requestMethod,
        request_url = :requestUrl,
        response_status = :responseStatus,
        content_type = :contentType,
        inferred_severity = :inferredSeverity,
        parse_status = :parseStatus,
        parse_format = :parseFormat,
        issue_tags_text = :issueTagsText,
        parse_warnings_text = :parseWarningsText,
        time_ms = :timeMs,
        doc = :doc,
        updated_at = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        collection_name,
        doc_id,
        file_id,
        entry_index,
        uploaded_at,
        status_value,
        level_value,
        source_value,
        timestamp_value,
        request_method,
        request_url,
        response_status,
        content_type,
        inferred_severity,
        parse_status,
        parse_format,
        issue_tags_text,
        parse_warnings_text,
        time_ms,
        doc
      ) VALUES (
        :collectionName,
        :docId,
        :fileId,
        :entryIndex,
        :uploadedAt,
        :statusValue,
        :levelValue,
        :sourceValue,
        :timestampValue,
        :requestMethod,
        :requestUrl,
        :responseStatus,
        :contentType,
        :inferredSeverity,
        :parseStatus,
        :parseFormat,
        :issueTagsText,
        :parseWarningsText,
        :timeMs,
        :doc
      )`;

    await withConnection(this.database.pool, async (connection) => {
      await connection.executeMany(sql, binds, { autoCommit: false });
      await connection.commit();
    });

    return {
      insertedCount: docs.length,
      insertedIds: binds.map((bind) => bind.docId),
    };
  }

  async deleteMany(filter: OracleFilter = {}): Promise<{ deletedCount: number }> {
    const where = buildOracleWhereClause(this.collectionName, filter);
    const sql = `DELETE FROM ${this.database.tableName} WHERE ${where.sql}`;

    return withConnection(this.database.pool, async (connection) => {
      const result = await connection.execute(sql, where.binds, { autoCommit: true });
      return { deletedCount: result.rowsAffected ?? 0 };
    });
  }

  indexes(): Promise<Array<Record<string, unknown>>> {
    return Promise.resolve([]);
  }

  listIndexes() {
    return {
      toArray: async () => [],
    };
  }

  createIndex(): Promise<string> {
    return Promise.resolve('oracle-json-schema-managed');
  }

  dropIndex(): Promise<void> {
    return Promise.resolve();
  }

  aggregate(pipeline: Array<Record<string, any>>) {
    return {
      toArray: async () => this.aggregateInMemory(pipeline),
    };
  }

  async query(
    filter: OracleFilter,
    options: {
      sort?: OracleSort;
      skip?: number;
      limit?: number;
      projection?: OracleProjection;
    } = {},
  ): Promise<T[]> {
    const where = buildOracleWhereClause(this.collectionName, filter);
    const orderBy = buildOracleOrderBy(options.sort);
    const offsetName = `b${Object.keys(where.binds).length + 1}`;
    const fetchName = `b${Object.keys(where.binds).length + 2}`;
    const binds = {
      ...where.binds,
      [offsetName]: options.skip ?? 0,
      [fetchName]: options.limit ?? 100000,
    };
    const sql = `
      SELECT DOC
      FROM ${this.database.tableName}
      WHERE ${where.sql}
      ORDER BY ${orderBy}
      OFFSET :${offsetName} ROWS FETCH NEXT :${fetchName} ROWS ONLY`;

    return withConnection(this.database.pool, async (connection) => {
      const result = await connection.execute(sql, binds, { outFormat: this.database.outFormatObject });
      return (result.rows ?? []).map((row: any) => {
        const doc = parseDocument(row.DOC ?? row.doc);
        return applyOracleProjection(doc, options.projection) as T;
      });
    });
  }

  private async aggregateInMemory(pipeline: Array<Record<string, any>>): Promise<Array<Record<string, any>>> {
    let rows: any[] = [];

    for (const stage of pipeline) {
      if (stage.$match) {
        rows = await this.find(stage.$match).toArray();
      } else if (stage.$unwind) {
        const field = String(stage.$unwind).replace(/^\$/, '');
        rows = rows.flatMap((row) => {
          const values = getByPath(row, field);
          if (!Array.isArray(values)) return [];
          return values.map((value) => ({ ...row, [field]: value }));
        });
      } else if (stage.$group) {
        const idPath = String(stage.$group._id ?? '').replace(/^\$/, '');
        const counts = new Map<string, { _id: unknown; count: number }>();
        for (const row of rows) {
          const value = idPath ? getByPath(row, idPath) : null;
          const key = JSON.stringify(value);
          const existing = counts.get(key) ?? { _id: value, count: 0 };
          existing.count += 1;
          counts.set(key, existing);
        }
        rows = Array.from(counts.values());
      } else if (stage.$sort) {
        const [[field, direction]] = Object.entries(stage.$sort);
        rows = [...rows].sort((a, b) => {
          const av = a[field];
          const bv = b[field];
          if (av === bv) return 0;
          return (av > bv ? 1 : -1) * (direction === -1 ? -1 : 1);
        });
      } else if (stage.$limit) {
        rows = rows.slice(0, Number(stage.$limit));
      } else {
        throw new Error(`Unsupported Oracle JSON aggregate stage: ${Object.keys(stage).join(', ')}`);
      }
    }

    return rows;
  }
}

export class OracleJsonDatabase {
  public readonly tableName: string;
  public readonly outFormatObject: unknown;

  constructor(
    public readonly pool: OraclePool,
    tableName: string,
    outFormatObject: unknown,
  ) {
    this.tableName = normalizeOracleIdentifier(tableName);
    this.outFormatObject = outFormatObject;
  }

  collection<T extends Record<string, any> = Record<string, any>>(collectionName: string) {
    return new OracleJsonCollection<T>(this, collectionName);
  }

  async command(command: Record<string, unknown>) {
    if ('ping' in command) {
      await withConnection(this.pool, async (connection) => {
        await connection.execute('SELECT 1 FROM dual');
      });
      return { ok: 1 };
    }

    throw new Error(`Unsupported Oracle JSON database command: ${Object.keys(command).join(', ')}`);
  }

  async initializeSchema(): Promise<void> {
    await withConnection(this.pool, async (connection) => {
      await ignoreAlreadyExists(connection, `
        CREATE TABLE ${this.tableName} (
          collection_name VARCHAR2(64) NOT NULL,
          doc_id VARCHAR2(256) NOT NULL,
          file_id VARCHAR2(256),
          entry_index NUMBER,
          uploaded_at TIMESTAMP WITH TIME ZONE,
          status_value VARCHAR2(64),
          level_value VARCHAR2(32),
          source_value VARCHAR2(512),
          timestamp_value VARCHAR2(128),
          request_method VARCHAR2(32),
          request_url VARCHAR2(2048),
          response_status NUMBER,
          content_type VARCHAR2(512),
          inferred_severity VARCHAR2(32),
          parse_status VARCHAR2(32),
          parse_format VARCHAR2(64),
          issue_tags_text VARCHAR2(2048),
          parse_warnings_text VARCHAR2(4000),
          time_ms NUMBER,
          doc CLOB CHECK (doc IS JSON),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
          CONSTRAINT ${this.tableName.slice(0, 24)}_PK PRIMARY KEY (collection_name, doc_id)
        )`);

      await Promise.all([
        ignoreAlreadyExists(connection, `CREATE INDEX ${this.tableName.slice(0, 21)}_FID_IDX ON ${this.tableName} (collection_name, file_id)`),
        ignoreAlreadyExists(connection, `CREATE INDEX ${this.tableName.slice(0, 21)}_IDX_IDX ON ${this.tableName} (collection_name, file_id, entry_index)`),
        ignoreAlreadyExists(connection, `CREATE INDEX ${this.tableName.slice(0, 21)}_STS_IDX ON ${this.tableName} (collection_name, status_value)`),
        ignoreAlreadyExists(connection, `CREATE INDEX ${this.tableName.slice(0, 21)}_RSP_IDX ON ${this.tableName} (collection_name, file_id, response_status, entry_index)`),
        ignoreAlreadyExists(connection, `CREATE INDEX ${this.tableName.slice(0, 21)}_LVL_IDX ON ${this.tableName} (collection_name, file_id, level_value, entry_index)`),
        ignoreAlreadyExists(connection, `CREATE INDEX ${this.tableName.slice(0, 21)}_SRC_IDX ON ${this.tableName} (collection_name, file_id, source_value, entry_index)`),
        ignoreAlreadyExists(connection, `CREATE INDEX ${this.tableName.slice(0, 21)}_TSP_IDX ON ${this.tableName} (collection_name, file_id, timestamp_value, entry_index)`),
        ignoreAlreadyExists(connection, `CREATE INDEX ${this.tableName.slice(0, 21)}_PS_IDX ON ${this.tableName} (collection_name, file_id, parse_status, entry_index)`),
      ]);
    });
  }

  async close(): Promise<void> {
    await this.pool.close(10);
  }
}

export async function createOracleJsonDatabase(config: OracleJsonStoreConfig): Promise<OracleJsonDatabase> {
  const oracleDb = await loadOracleModule();
  const pool = await oracleDb.createPool({
    user: config.user,
    password: config.password,
    connectString: config.connectString,
    poolMin: config.poolMin ?? 1,
    poolMax: config.poolMax ?? 10,
    poolIncrement: config.poolIncrement ?? 1,
  });
  const database = new OracleJsonDatabase(pool, config.tableName ?? DEFAULT_TABLE_NAME, oracleDb.OUT_FORMAT_OBJECT);
  await database.initializeSchema();
  return database;
}
