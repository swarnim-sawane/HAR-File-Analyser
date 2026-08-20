import type { HarFile } from '../types/har';

// HAR evidence may contain sensitive values, so this cache deliberately stays
// memory-only. The small LRU bound prevents tab switching from creating an
// unbounded second copy of every file opened during a long browser session.
const MAX_CACHED_HAR_FILES = 4;
const resolvedHarFiles = new Map<string, HarFile>();
const pendingHarFiles = new Map<string, Promise<HarFile>>();

const markRecentlyUsed = (fileId: string, harData: HarFile): HarFile => {
  resolvedHarFiles.delete(fileId);
  resolvedHarFiles.set(fileId, harData);

  while (resolvedHarFiles.size > MAX_CACHED_HAR_FILES) {
    const oldestFileId = resolvedHarFiles.keys().next().value as string | undefined;
    if (!oldestFileId) break;
    resolvedHarFiles.delete(oldestFileId);
  }

  return harData;
};

export const peekHarData = (fileId: string): HarFile | null => {
  const cached = resolvedHarFiles.get(fileId);
  return cached ? markRecentlyUsed(fileId, cached) : null;
};

export const getOrLoadHarData = (
  fileId: string,
  loader: () => Promise<HarFile>,
): Promise<HarFile> => {
  const cached = peekHarData(fileId);
  if (cached) return Promise.resolve(cached);

  const pending = pendingHarFiles.get(fileId);
  if (pending) return pending;

  const loadPromise = loader()
    .then(harData => markRecentlyUsed(fileId, harData))
    .finally(() => pendingHarFiles.delete(fileId));

  pendingHarFiles.set(fileId, loadPromise);
  return loadPromise;
};

export const clearHarDataCache = (): void => {
  resolvedHarFiles.clear();
  pendingHarFiles.clear();
};

export const getHarDataCacheSize = (): number => resolvedHarFiles.size;
