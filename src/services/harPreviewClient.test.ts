import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarPreview } from './harPreviewClient';
import type { HarPreviewSnapshot } from './progressiveHarPreview';

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: MessageEvent<any>) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    FakeWorker.latest = this;
  }

  emit(data: Record<string, unknown>) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const originalWorker = globalThis.Worker;

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalWorker) vi.stubGlobal('Worker', originalWorker);
});

describe('startHarPreview error classification', () => {
  it('marks structural validation errors as terminal and typed', async () => {
    const snapshots: HarPreviewSnapshot[] = [];
    const session = startHarPreview(
      new File(['{}'], 'invalid.har'),
      (event) => snapshots.push(event.snapshot),
    );

    FakeWorker.latest.emit({
      type: 'error',
      previewId: session.previewId,
      errorKind: 'validation',
      error: 'HAR file contains an invalid request entry.',
    });

    await expect(session.validated).rejects.toMatchObject({
      code: 'HAR_PREVIEW_VALIDATION',
    });
    expect(snapshots.at(-1)).toMatchObject({
      phase: 'failed',
      error: 'HAR file contains an invalid request entry.',
    });
  });

  it('keeps preview runtime failures advisory so upload phases can continue', async () => {
    const snapshots: HarPreviewSnapshot[] = [];
    const session = startHarPreview(
      new File(['{}'], 'capture.har'),
      (event) => snapshots.push(event.snapshot),
    );

    FakeWorker.latest.emit({
      type: 'error',
      previewId: session.previewId,
      errorKind: 'preview',
      error: 'The browser could not read the local preview.',
    });
    await expect(session.validated).rejects.toThrow(/could not read/);
    session.setPhase('uploading');

    expect(snapshots.at(-1)).toMatchObject({ phase: 'uploading' });
    expect(snapshots.at(-1)?.error).toBeUndefined();
  });
});
