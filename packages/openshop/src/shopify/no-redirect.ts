/** Thrown when Shopify answers a redirect, which is never followed. */
export class RedirectRefusedError extends Error {
  constructor() {
    // Names neither the address nor anything the request carried.
    super('[openshop] Shopify answered a redirect, not followed')
    this.name = 'RedirectRefusedError'
  }
}

/** Whether fetch failed because the answer was a redirect (`redirect: 'error'`). */
function isRedirectError(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined
  return cause instanceof Error && /redirect/i.test(cause.message)
}

/**
 * `fetch` that never follows a redirect, for every request that carries an
 * access token or the client secret: a redirect would send it to another
 * address. A redirect rejects with `RedirectRefusedError`; any other error is
 * rethrown unchanged.
 */
export async function fetchWithoutRedirect(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: 'error' })
  } catch (error) {
    if (isRedirectError(error)) throw new RedirectRefusedError()
    throw error
  }
}
