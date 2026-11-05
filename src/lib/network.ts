/** Bound requests without discarding a caller's cancellation signal. */
export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, milliseconds = 20000): Promise<Response> {
  const controller = new AbortController()
  const abort = () => controller.abort(init.signal?.reason)
  if (init.signal?.aborted) abort()
  else init.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Connection timed out', 'TimeoutError')), milliseconds)
  try { return await fetch(input, { ...init, signal: controller.signal }) }
  finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort) }
}
