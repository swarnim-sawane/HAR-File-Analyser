export interface IdleHandle {
  cancel: () => void;
}

type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;

export function runWhenIdle(callback: IdleCallback, timeout = 1000): IdleHandle {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(callback as IdleRequestCallback, { timeout });
    return {
      cancel: () => window.cancelIdleCallback(idleId),
    };
  }

  const timer = globalThis.setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => 0,
    });
  }, 1);

  return {
    cancel: () => globalThis.clearTimeout(timer),
  };
}
