import {
  HarPreviewEvent,
  HarPreviewPhase,
  HarPreviewRequest,
  HarPreviewSnapshot,
  MAX_PREVIEW_REQUESTS,
} from './progressiveHarPreview';

interface WorkerSnapshotMessage {
  type: 'snapshot';
  previewId: string;
  requests: HarPreviewRequest[];
  totalParsed: number;
  skippedOversizedEntries: number;
  isTruncated: boolean;
  complete: boolean;
}

interface WorkerErrorMessage {
  type: 'error';
  previewId: string;
  errorKind: 'validation' | 'preview';
  error: string;
}

interface WorkerCancelledMessage {
  type: 'cancelled';
  previewId: string;
}

type WorkerOutput = WorkerSnapshotMessage | WorkerErrorMessage | WorkerCancelledMessage;

export interface HarPreviewSession {
  previewId: string;
  ready: Promise<void>;
  validated: Promise<void>;
  setPhase: (phase: HarPreviewPhase) => void;
  fail: (message: string) => void;
  cancel: () => void;
  finish: () => void;
}

export class HarPreviewValidationError extends Error {
  readonly code = 'HAR_PREVIEW_VALIDATION';

  constructor(message: string) {
    super(message);
    this.name = 'HarPreviewValidationError';
  }
}

export const isHarPreviewValidationError = (error: unknown): error is HarPreviewValidationError =>
  error instanceof HarPreviewValidationError
  || (typeof error === 'object' && error !== null
    && (error as { code?: unknown }).code === 'HAR_PREVIEW_VALIDATION');

const createPreviewId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `har-preview-${crypto.randomUUID()}`
    : `har-preview-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const startHarPreview = (
  file: File,
  onEvent?: (event: HarPreviewEvent) => void,
): HarPreviewSession => {
  const previewId = createPreviewId();
  let revision = 0;
  let phase: HarPreviewPhase = 'validating';
  let requests: HarPreviewRequest[] = [];
  let totalParsed = 0;
  let skippedOversizedEntries = 0;
  let isTruncated = false;
  let settled = false;
  let validationSettled = false;

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  let resolveValidated!: () => void;
  let rejectValidated!: (error: Error) => void;
  const validated = new Promise<void>((resolve, reject) => {
    resolveValidated = resolve;
    rejectValidated = reject;
  });

  const worker = new Worker(new URL('../workers/harPreview.worker.ts', import.meta.url), {
    type: 'module',
  });
  let workerStopped = false;

  const stopWorker = () => {
    if (workerStopped) return;
    workerStopped = true;
    worker.terminate();
  };

  const emit = (error?: string) => {
    revision += 1;
    const snapshot: HarPreviewSnapshot = {
      previewId,
      fileName: file.name,
      fileSize: file.size,
      phase,
      revision,
      requests,
      totalParsed,
      skippedOversizedEntries,
      isTruncated,
      maxRequests: MAX_PREVIEW_REQUESTS,
      ...(error ? { error } : {}),
    };
    onEvent?.({ type: 'snapshot', snapshot });
  };

  const settleReady = (error?: Error) => {
    if (settled) return;
    settled = true;
    if (error) rejectReady(error);
    else resolveReady();
  };

  const settleValidation = (error?: Error) => {
    if (validationSettled) return;
    validationSettled = true;
    if (error) rejectValidated(error);
    else resolveValidated();
  };

  worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
    const message = event.data;
    if (message.previewId !== previewId) return;

    if (message.type === 'snapshot') {
      requests = message.requests;
      totalParsed = message.totalParsed;
      skippedOversizedEntries = message.skippedOversizedEntries;
      isTruncated = message.isTruncated;
      emit();
      if (requests.length > 0 || message.complete) settleReady();
      if (message.complete) {
        settleValidation();
        stopWorker();
      }
      return;
    }

    if (message.type === 'error') {
      const error = message.errorKind === 'validation'
        ? new HarPreviewValidationError(message.error)
        : new Error(message.error);
      if (message.errorKind === 'validation') {
        phase = 'failed';
        emit(message.error);
      }
      settleReady(error);
      settleValidation(error);
      stopWorker();
      return;
    }

    phase = 'cancelled';
    emit('Preview cancelled.');
    const error = new Error('Preview cancelled.');
    settleReady(error);
    settleValidation(error);
    stopWorker();
  };

  worker.onerror = () => {
    const message = 'The browser could not start the HAR preview worker.';
    phase = 'failed';
    emit(message);
    const error = new Error(message);
    settleReady(error);
    settleValidation(error);
    stopWorker();
  };

  emit();
  worker.postMessage({ type: 'start', previewId, file, maxRequests: MAX_PREVIEW_REQUESTS });

  // Preview is advisory. Callers may still inspect these promises, but a local
  // preview failure must never become an unhandled rejection or stop upload.
  void ready.catch(() => undefined);
  void validated.catch(() => undefined);

  return {
    previewId,
    ready,
    validated,
    setPhase(nextPhase) {
      if (phase === 'failed' || phase === 'cancelled') return;
      phase = nextPhase;
      emit();
    },
    fail(message) {
      phase = 'failed';
      emit(message);
      const error = new Error(message);
      settleReady(error);
      settleValidation(error);
      stopWorker();
    },
    cancel() {
      phase = 'cancelled';
      emit('Preview cancelled.');
      const error = new Error('Preview cancelled.');
      settleReady(error);
      settleValidation(error);
      if (!workerStopped) {
        worker.postMessage({ type: 'cancel' });
      }
      stopWorker();
    },
    finish() {
      phase = 'ready';
      emit();
      stopWorker();
    },
  };
};
