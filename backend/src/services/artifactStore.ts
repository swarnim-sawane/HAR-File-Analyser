import { createReadStream, createWriteStream, promises as fs } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';

export type ArtifactStoreKind = 'local' | 'oci-object-storage';

export interface ArtifactInfo {
  key: string;
  size: number;
  etag?: string;
  lastModified?: Date;
}

export type ArtifactSource =
  | { filePath: string }
  | { body: Readable; contentLength: number };

export interface ArtifactStore {
  readonly kind: ArtifactStoreKind;
  probe(): Promise<void>;
  put(key: string, source: ArtifactSource, contentType?: string): Promise<ArtifactInfo>;
  open(key: string): Promise<{ info: ArtifactInfo; body: Readable }>;
  head(key: string): Promise<ArtifactInfo | null>;
  delete(key: string): Promise<boolean>;
  list(prefix: string): AsyncIterable<ArtifactInfo>;
}

interface OciObjectSummary {
  name?: string;
  size?: number;
  etag?: string;
  timeModified?: Date;
  timeCreated?: Date;
}

export interface OciObjectStorageAdapter {
  putObject(request: Record<string, unknown>): Promise<{ eTag?: string }>;
  getObject(request: Record<string, unknown>): Promise<{
    value?: unknown;
    contentLength?: number;
    eTag?: string;
    lastModified?: Date;
  }>;
  headObject(request: Record<string, unknown>): Promise<{
    contentLength?: number;
    eTag?: string;
    lastModified?: Date;
  }>;
  deleteObject(request: Record<string, unknown>): Promise<unknown>;
  listObjects(request: Record<string, unknown>): Promise<{
    listObjects?: {
      objects?: OciObjectSummary[];
      nextStartWith?: string;
    };
  }>;
}

export interface OciArtifactStoreConfig {
  namespaceName: string;
  bucketName: string;
  prefix?: string;
}

export type OciAuthMode = 'resource-principal' | 'config-file';

function validateKey(key: string): string {
  const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/');

  if (!normalized || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid artifact key.');
  }

  return normalized;
}

function safePrefix(prefix: string | undefined): string {
  if (!prefix?.trim()) return '';
  return validateKey(prefix.trim().replace(/^\/+|\/+$/g, ''));
}

function sourceStream(source: ArtifactSource): Readable {
  return 'filePath' in source ? createReadStream(source.filePath) : source.body;
}

async function sourceLength(source: ArtifactSource): Promise<number> {
  if ('filePath' in source) return (await fs.stat(source.filePath)).size;
  return source.contentLength;
}

function asNodeReadable(value: unknown): Readable {
  if (value instanceof Readable) return value;
  if (Buffer.isBuffer(value) || typeof value === 'string') return Readable.from(value);
  if (value && typeof (value as { pipe?: unknown }).pipe === 'function') {
    return value as Readable;
  }
  if (value && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function') {
    return Readable.from(value as AsyncIterable<Uint8Array>);
  }
  throw new Error('Object Storage returned an unsupported response body.');
}

export class LocalArtifactStore implements ArtifactStore {
  readonly kind = 'local' as const;
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  private resolveKey(key: string): string {
    const resolved = path.resolve(this.rootDir, ...validateKey(key).split('/'));
    if (resolved !== this.rootDir && !resolved.startsWith(`${this.rootDir}${path.sep}`)) {
      throw new Error('Artifact key escapes the configured local storage root.');
    }
    return resolved;
  }

  async probe(): Promise<void> {
    const probePath = path.join(this.rootDir, `.probe-${randomUUID()}`);
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.writeFile(probePath, 'ok', { flag: 'wx' });
    await fs.rm(probePath, { force: true });
  }

  async put(key: string, source: ArtifactSource): Promise<ArtifactInfo> {
    const normalizedKey = validateKey(key);
    const destination = this.resolveKey(normalizedKey);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(destination), { recursive: true });

    try {
      await pipeline(sourceStream(source), createWriteStream(temporary, { flags: 'wx' }));
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }

    const stats = await fs.stat(destination);
    return { key: normalizedKey, size: stats.size, lastModified: stats.mtime };
  }

  async open(key: string): Promise<{ info: ArtifactInfo; body: Readable }> {
    const info = await this.head(key);
    if (!info) throw new Error(`Artifact not found: ${key}`);
    return { info, body: createReadStream(this.resolveKey(info.key)) };
  }

  async head(key: string): Promise<ArtifactInfo | null> {
    const normalizedKey = validateKey(key);
    const stats = await fs.stat(this.resolveKey(normalizedKey)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stats?.isFile()) return null;
    return { key: normalizedKey, size: stats.size, lastModified: stats.mtime };
  }

  async delete(key: string): Promise<boolean> {
    if (!(await this.head(key))) return false;
    await fs.rm(this.resolveKey(key), { force: true });
    return true;
  }

  async *list(prefix: string): AsyncIterable<ArtifactInfo> {
    const normalizedPrefix = prefix ? validateKey(prefix) : '';
    const startPath = normalizedPrefix ? this.resolveKey(normalizedPrefix) : this.rootDir;

    const walk = async function* (directory: string): AsyncIterable<string> {
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) yield* walk(entryPath);
        if (entry.isFile()) yield entryPath;
      }
    };

    for await (const filePath of walk(startPath)) {
      const stats = await fs.stat(filePath);
      const key = path.relative(this.rootDir, filePath).split(path.sep).join('/');
      yield { key, size: stats.size, lastModified: stats.mtime };
    }
  }
}

export class OciArtifactStore implements ArtifactStore {
  readonly kind = 'oci-object-storage' as const;
  private readonly prefix: string;

  constructor(
    private readonly client: OciObjectStorageAdapter,
    private readonly config: OciArtifactStoreConfig,
  ) {
    if (!config.namespaceName.trim() || !config.bucketName.trim()) {
      throw new Error('OCI Object Storage namespace and bucket are required.');
    }
    this.prefix = safePrefix(config.prefix);
  }

  private objectName(key: string): string {
    const normalizedKey = validateKey(key);
    return this.prefix ? `${this.prefix}/${normalizedKey}` : normalizedKey;
  }

  private objectPrefix(prefix: string): string {
    const normalizedPrefix = prefix ? validateKey(prefix) : '';
    if (!this.prefix) return normalizedPrefix;
    return normalizedPrefix ? `${this.prefix}/${normalizedPrefix}` : `${this.prefix}/`;
  }

  private request(key: string): Record<string, unknown> {
    return {
      namespaceName: this.config.namespaceName,
      bucketName: this.config.bucketName,
      objectName: this.objectName(key),
    };
  }

  async probe(): Promise<void> {
    await this.client.listObjects({
      namespaceName: this.config.namespaceName,
      bucketName: this.config.bucketName,
      prefix: this.prefix ? `${this.prefix}/` : undefined,
      limit: 1,
    });
  }

  async put(key: string, source: ArtifactSource, contentType = 'application/octet-stream'): Promise<ArtifactInfo> {
    const normalizedKey = validateKey(key);
    const size = await sourceLength(source);
    const response = await this.client.putObject({
      ...this.request(normalizedKey),
      putObjectBody: sourceStream(source),
      contentLength: size,
      contentType,
    });
    return { key: normalizedKey, size, etag: response.eTag };
  }

  async open(key: string): Promise<{ info: ArtifactInfo; body: Readable }> {
    const normalizedKey = validateKey(key);
    const response = await this.client.getObject(this.request(normalizedKey));
    return {
      info: {
        key: normalizedKey,
        size: response.contentLength ?? 0,
        etag: response.eTag,
        lastModified: response.lastModified,
      },
      body: asNodeReadable(response.value),
    };
  }

  async head(key: string): Promise<ArtifactInfo | null> {
    const normalizedKey = validateKey(key);
    try {
      const response = await this.client.headObject(this.request(normalizedKey));
      return {
        key: normalizedKey,
        size: response.contentLength ?? 0,
        etag: response.eTag,
        lastModified: response.lastModified,
      };
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!(await this.head(key))) return false;
    await this.client.deleteObject(this.request(key));
    return true;
  }

  async *list(prefix: string): AsyncIterable<ArtifactInfo> {
    const requestedPrefix = this.objectPrefix(prefix);
    let start: string | undefined;

    do {
      const response = await this.client.listObjects({
        namespaceName: this.config.namespaceName,
        bucketName: this.config.bucketName,
        prefix: requestedPrefix,
        fields: 'name,size,etag,timeCreated,timeModified',
        ...(start ? { start } : {}),
      });
      const result = response.listObjects;

      for (const object of result?.objects ?? []) {
        if (!object.name) continue;
        if (this.prefix && !object.name.startsWith(`${this.prefix}/`)) continue;
        const key = this.prefix
          ? object.name.slice(`${this.prefix}/`.length)
          : object.name;
        yield {
          key,
          size: object.size ?? 0,
          etag: object.etag,
          lastModified: object.timeModified ?? object.timeCreated,
        };
      }

      start = result?.nextStartWith;
    } while (start);
  }
}

export function parseOciAuthMode(value: string | undefined): OciAuthMode {
  const authMode = (value || 'resource-principal').trim().toLowerCase();
  if (authMode === 'resource-principal' || authMode === 'config-file') return authMode;
  throw new Error(`Unsupported OCI_AUTH_MODE value: ${authMode}`);
}

export interface ArtifactStoreEnvironment extends NodeJS.ProcessEnv {
  ARTIFACT_STORE?: string;
  ARTIFACT_LOCAL_DIR?: string;
  PROCESSED_DIR?: string;
  OCI_OBJECT_STORAGE_NAMESPACE?: string;
  OCI_OBJECT_STORAGE_BUCKET?: string;
  OCI_OBJECT_STORAGE_PREFIX?: string;
  OCI_AUTH_MODE?: string;
  OCI_CONFIG_FILE?: string;
  OCI_CONFIG_PROFILE?: string;
}

function createOciAdapter(env: ArtifactStoreEnvironment): OciObjectStorageAdapter {
  // Loaded only in OCI mode so local builds and tests do not require OCI credentials.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const common = require('oci-common') as any;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const objectStorage = require('oci-objectstorage') as any;
  const authMode = parseOciAuthMode(env.OCI_AUTH_MODE);

  const authenticationDetailsProvider = authMode === 'config-file'
    ? new common.ConfigFileAuthenticationDetailsProvider(
        env.OCI_CONFIG_FILE,
        env.OCI_CONFIG_PROFILE || 'DEFAULT',
      )
    : common.ResourcePrincipalAuthenticationDetailsProvider.builder();

  return new objectStorage.ObjectStorageClient({ authenticationDetailsProvider });
}

export function createArtifactStoreFromEnv(
  env: ArtifactStoreEnvironment = process.env,
  ociAdapter?: OciObjectStorageAdapter,
): ArtifactStore {
  const kind = (env.ARTIFACT_STORE || 'local').trim().toLowerCase();
  const hosted = env.HOSTED_DEPLOYMENT === 'true';

  if (hosted && kind !== 'oci-object-storage' && kind !== 'oci') {
    throw new Error('Hosted Deployment requires ARTIFACT_STORE=oci-object-storage.');
  }

  if (kind === 'local') {
    const rootDir = env.ARTIFACT_LOCAL_DIR
      || env.PROCESSED_DIR
      || path.join(process.cwd(), 'processed');
    return new LocalArtifactStore(rootDir);
  }

  if (kind !== 'oci-object-storage' && kind !== 'oci') {
    throw new Error(`Unsupported ARTIFACT_STORE value: ${kind}`);
  }

  const namespaceName = env.OCI_OBJECT_STORAGE_NAMESPACE?.trim();
  const bucketName = env.OCI_OBJECT_STORAGE_BUCKET?.trim();
  if (!namespaceName || !bucketName) {
    throw new Error(
      'OCI Object Storage requires OCI_OBJECT_STORAGE_NAMESPACE and OCI_OBJECT_STORAGE_BUCKET.',
    );
  }

  return new OciArtifactStore(ociAdapter || createOciAdapter(env), {
    namespaceName,
    bucketName,
    prefix: env.OCI_OBJECT_STORAGE_PREFIX || 'har-analyzer',
  });
}

let artifactStore: ArtifactStore | undefined;

export function getArtifactStore(): ArtifactStore {
  artifactStore ||= createArtifactStoreFromEnv();
  return artifactStore;
}

export function resetArtifactStoreForTests(): void {
  artifactStore = undefined;
}

export function uploadChunkKey(fileId: string, chunkIndex: number): string {
  return `tmp/${fileId}/chunks/${chunkIndex}`;
}

export function sourceArtifactKey(fileId: string): string {
  return `artifacts/${fileId}/source`;
}

export async function materializeArtifact(
  store: ArtifactStore,
  key: string,
  destinationPath: string,
): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const opened = await store.open(key);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await pipeline(opened.body, createWriteStream(destinationPath, { flags: 'w' }));
  return {
    filePath: destinationPath,
    cleanup: () => fs.rm(destinationPath, { force: true }).then(() => undefined),
  };
}
