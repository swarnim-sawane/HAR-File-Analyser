import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarFile } from '../../types/har';
import {
  clearHarDataCache,
  getHarDataCacheSize,
  getOrLoadHarData,
  peekHarData,
} from '../harDataCache';

const makeHar = (name: string): HarFile => ({
  log: {
    version: '1.2',
    creator: { name, version: '1' },
    entries: [],
  },
});

describe('harDataCache', () => {
  beforeEach(() => clearHarDataCache());

  it('loads a file once and reuses the same parsed object', async () => {
    const har = makeHar('one');
    const loader = vi.fn().mockResolvedValue(har);

    expect(await getOrLoadHarData('file-1', loader)).toBe(har);
    expect(await getOrLoadHarData('file-1', loader)).toBe(har);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent requests for the same file', async () => {
    const loader = vi.fn().mockResolvedValue(makeHar('shared'));

    const [first, second] = await Promise.all([
      getOrLoadHarData('file-1', loader),
      getOrLoadHarData('file-1', loader),
    ]);

    expect(first).toBe(second);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('keeps only the four most recently used HAR files', async () => {
    for (let index = 1; index <= 5; index += 1) {
      await getOrLoadHarData(`file-${index}`, async () => makeHar(String(index)));
    }

    expect(getHarDataCacheSize()).toBe(4);
    expect(peekHarData('file-1')).toBeNull();
    expect(peekHarData('file-5')).not.toBeNull();
  });
});
