/// <reference lib="webworker" />

import {
  HarEntryStreamParser,
  HarPreviewValidationError,
  MAX_PREVIEW_REQUESTS,
} from '../services/progressiveHarPreview';

interface StartMessage {
  type: 'start';
  previewId: string;
  file: File;
  maxRequests?: number;
}

interface CancelMessage {
  type: 'cancel';
}

type WorkerInput = StartMessage | CancelMessage;

let cancelled = false;

const postSnapshot = (
  previewId: string,
  requests: ReturnType<HarEntryStreamParser['finish']>['retained'],
  totalParsed: number,
  skippedOversizedEntries: number,
  isTruncated: boolean,
  complete: boolean,
) => {
  self.postMessage({
    type: 'snapshot',
    previewId,
    requests,
    totalParsed,
    skippedOversizedEntries,
    isTruncated,
    complete,
  });
};

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  if (event.data.type === 'cancel') {
    cancelled = true;
    return;
  }

  const { previewId, file, maxRequests = MAX_PREVIEW_REQUESTS } = event.data;
  cancelled = false;
  const parser = new HarEntryStreamParser(maxRequests);
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let retained = [] as ReturnType<HarEntryStreamParser['finish']>['retained'];
  let totalParsed = 0;
  let skippedOversizedEntries = 0;
  let lastPublishedAt = 0;

  try {
    while (!cancelled) {
      const { done, value } = await reader.read();
      if (done) break;

      parser.push(decoder.decode(value, { stream: true }));
      const current = parser.snapshot();
      if (
        current.totalParsed !== totalParsed
        || current.skippedOversizedEntries !== skippedOversizedEntries
      ) {
        retained = current.retained;
        totalParsed = current.totalParsed;
        skippedOversizedEntries = current.skippedOversizedEntries;
        const now = Date.now();
        if (lastPublishedAt === 0 || now - lastPublishedAt >= 80 || retained.length >= maxRequests) {
          postSnapshot(
            previewId,
            retained,
            totalParsed,
            skippedOversizedEntries,
            current.isTruncated,
            false,
          );
          lastPublishedAt = now;
        }
      }
    }

    if (cancelled) {
      await reader.cancel();
      self.postMessage({ type: 'cancelled', previewId });
      return;
    }

    parser.push(decoder.decode());
    const result = parser.finish();
    postSnapshot(
      previewId,
      result.retained,
      result.totalParsed,
      result.skippedOversizedEntries,
      result.isTruncated,
      true,
    );
  } catch (error) {
    self.postMessage({
      type: 'error',
      previewId,
      errorKind: error instanceof HarPreviewValidationError ? 'validation' : 'preview',
      error: error instanceof Error
        ? error.message.slice(0, 240)
        : 'Unable to read this HAR file.',
    });
  } finally {
    reader.releaseLock();
  }
};

export {};
