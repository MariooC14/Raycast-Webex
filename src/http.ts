const requestTimeout = 15_000;

export async function fetchWithTimeout<T>(
  url: string | URL,
  options: RequestInit,
  read: (response: Response, signal: AbortSignal) => Promise<T>,
  errors: { timeout: string; connection: string },
): Promise<T> {
  const deadline = AbortSignal.timeout(requestTimeout);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  try {
    const response = await fetch(url, { ...options, signal, redirect: "error" });
    return await read(response, signal);
  } catch {
    options.signal?.throwIfAborted();
    throw new Error(deadline.aborted ? errors.timeout : errors.connection);
  }
}

export async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof SyntaxError)) throw error;
  }
}

export function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}
