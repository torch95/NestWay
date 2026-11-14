/**
 * fetch() wrapper with an AbortController-based timeout so a stalled backend
 * (e.g. locked SQLite catalog) never leaves the UI in a permanent loading state.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 8_000;

export class FetchTimeoutError extends Error {
  constructor(public readonly url: string, public readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms: ${url}`);
    this.name = 'FetchTimeoutError';
  }
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  // Chain with any caller-provided signal so manual cancellation still works.
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted && !(outer && outer.aborted)) {
      throw new FetchTimeoutError(input, timeoutMs);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}
