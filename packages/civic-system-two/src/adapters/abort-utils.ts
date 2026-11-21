export function createAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) {
    if (reason.name !== 'AbortError') {
      reason.name = 'AbortError';
    }
    return reason;
  }
  const message = typeof reason === 'string' && reason.trim() ? reason : 'The operation was aborted';
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { name?: unknown }).name === 'AbortError';
}

export interface LinkedAbortSignal {
  signal: AbortSignal;
  abortCombined: (reason?: unknown) => void;
  cleanup: () => void;
}

export function linkAbortSignals(timeoutMs: number, externalSignal?: AbortSignal): LinkedAbortSignal {
  if (externalSignal?.aborted) {
    throw createAbortError(externalSignal);
  }

  const controller = new AbortController();
  const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
  timeoutError.name = 'AbortError';

  const timer = setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);

  const onExternalAbort = () => {
    controller.abort(createAbortError(externalSignal));
  };

  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    abortCombined: (reason?: unknown) => {
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    },
    cleanup: () => {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}
