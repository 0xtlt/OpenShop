/**
 * Keeps the test suites offline. The bootstrap replaces `fetch` with a
 * guard that lets local addresses through and refuses every other one, so a
 * test that forgets to mock Shopify (or any other host) fails instead of
 * reaching the network. Tests that mock `fetch` wrap this guard, so whatever
 * they do not answer themselves is refused too.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export interface NetworkGuard {
  /** Addresses refused so far, in order. */
  blocked: string[]
  /** Lists the refused addresses and fails the run when there are any. */
  report: () => void
  restore: () => void
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

export function installNetworkGuard(): NetworkGuard {
  const originalFetch = globalThis.fetch
  const guard: NetworkGuard = {
    blocked: [],
    report: () => {
      if (guard.blocked.length === 0) return
      console.error(`[network-guard] ${guard.blocked.length} request(s) to the network were refused:`)
      for (const url of new Set(guard.blocked)) console.error(`  ${url}`)
      process.exitCode = 1
    },
    restore: () => { globalThis.fetch = originalFetch },
  }
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    let hostname: string | null = null
    try { hostname = new URL(url).hostname } catch { /* refused below */ }
    if (hostname && (LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost'))) return originalFetch(input, init)
    guard.blocked.push(url)
    throw new TypeError(`[network-guard] Integration tests must not reach the network: ${url}`)
  }
  return guard
}
