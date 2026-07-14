import { Readable } from 'stream';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalArtifactStore,
  OciArtifactStore,
  createArtifactStoreFromEnv,
  materializeArtifact,
  parseOciAuthMode,
  sourceArtifactKey,
  uploadChunkKey,
  type OciObjectStorageAdapter,
} from './artifactStore';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'har-artifacts-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('LocalArtifactStore', () => {
  it('stores, streams, lists, materializes, and deletes provider-neutral keys', async () => {
    const root = await temporaryDirectory();
    const scratch = await temporaryDirectory();
    const sourcePath = path.join(scratch, 'input.har');
    await fs.writeFile(sourcePath, '{"log":{"entries":[]}}');
    const store = new LocalArtifactStore(root);
    const key = sourceArtifactKey('file_123');

    await store.probe();
    const stored = await store.put(key, { filePath: sourcePath }, 'application/json');
    expect(stored.key).toBe('artifacts/file_123/source');
    expect(stored.size).toBeGreaterThan(0);

    const opened = await store.open(key);
    let body = '';
    for await (const chunk of opened.body) body += chunk.toString();
    expect(body).toContain('entries');

    const listed = [];
    for await (const info of store.list('artifacts/file_123')) listed.push(info.key);
    expect(listed).toEqual([key]);

    const materializedPath = path.join(scratch, 'worker', 'input.har');
    const materialized = await materializeArtifact(store, key, materializedPath);
    expect(await fs.readFile(materialized.filePath, 'utf8')).toBe(body);
    await materialized.cleanup();
    await expect(fs.access(materializedPath)).rejects.toMatchObject({ code: 'ENOENT' });

    expect(await store.delete(key)).toBe(true);
    expect(await store.head(key)).toBeNull();
    expect(await store.delete(key)).toBe(false);
  });

  it('rejects traversal keys', async () => {
    const store = new LocalArtifactStore(await temporaryDirectory());
    await expect(store.put('../escape', {
      body: Readable.from('bad'),
      contentLength: 3,
    })).rejects.toThrow(/invalid artifact key/i);
  });
});

describe('OciArtifactStore', () => {
  it('maps the common contract to OCI Object Storage requests', async () => {
    const objects = new Map<string, Buffer>();
    const adapter: OciObjectStorageAdapter = {
      putObject: vi.fn(async (request) => {
        const body = request.putObjectBody as Readable;
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        objects.set(String(request.objectName), Buffer.concat(chunks));
        return { eTag: 'etag-1' };
      }),
      getObject: vi.fn(async (request) => {
        const value = objects.get(String(request.objectName));
        if (!value) throw Object.assign(new Error('missing'), { statusCode: 404 });
        return { value: Readable.from(value), contentLength: value.length, eTag: 'etag-1' };
      }),
      headObject: vi.fn(async (request) => {
        const value = objects.get(String(request.objectName));
        if (!value) throw Object.assign(new Error('missing'), { statusCode: 404 });
        return { contentLength: value.length, eTag: 'etag-1' };
      }),
      deleteObject: vi.fn(async (request) => {
        objects.delete(String(request.objectName));
      }),
      listObjects: vi.fn(async (request) => ({
        listObjects: {
          objects: Array.from(objects.entries())
            .filter(([name]) => name.startsWith(String(request.prefix)))
            .map(([name, value]) => ({ name, size: value.length, etag: 'etag-1' })),
        },
      })),
    };
    const store = new OciArtifactStore(adapter, {
      namespaceName: 'namespace',
      bucketName: 'bucket',
      prefix: 'har-analyzer',
    });
    const key = uploadChunkKey('file_123', 0);

    await store.probe();
    await store.put(key, { body: Readable.from('chunk'), contentLength: 5 });
    expect(adapter.putObject).toHaveBeenCalledWith(expect.objectContaining({
      namespaceName: 'namespace',
      bucketName: 'bucket',
      objectName: 'har-analyzer/tmp/file_123/chunks/0',
      contentLength: 5,
    }));
    expect((await store.head(key))?.size).toBe(5);

    const listed = [];
    for await (const item of store.list('tmp/file_123')) listed.push(item.key);
    expect(listed).toEqual([key]);
    expect(await store.delete(key)).toBe(true);
    expect(await store.head(key)).toBeNull();
  });
});

describe('createArtifactStoreFromEnv', () => {
  it('defaults to local storage and validates OCI configuration', async () => {
    const root = await temporaryDirectory();
    expect(createArtifactStoreFromEnv({ ARTIFACT_LOCAL_DIR: root }).kind).toBe('local');
    expect(() => createArtifactStoreFromEnv({ ARTIFACT_STORE: 'oci-object-storage' }))
      .toThrow(/namespace and.*bucket/i);
  });

  it('fails closed when hosted deployment is not configured for OCI Object Storage', () => {
    expect(() => createArtifactStoreFromEnv({ HOSTED_DEPLOYMENT: 'true' }))
      .toThrow(/requires ARTIFACT_STORE=oci-object-storage/i);
    expect(() => createArtifactStoreFromEnv({
      HOSTED_DEPLOYMENT: 'true',
      ARTIFACT_STORE: 'local',
      ARTIFACT_LOCAL_DIR: 'ignored',
    })).toThrow(/requires ARTIFACT_STORE=oci-object-storage/i);
  });

  it('accepts only supported OCI authentication modes', () => {
    expect(parseOciAuthMode(undefined)).toBe('resource-principal');
    expect(parseOciAuthMode('config-file')).toBe('config-file');
    expect(() => parseOciAuthMode('instance-principal')).toThrow(/unsupported OCI_AUTH_MODE/i);
  });
});
