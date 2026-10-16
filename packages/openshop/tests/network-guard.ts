import { writeSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import tls from 'node:tls'

/**
 * Keeps the test suites offline. The bootstrap replaces `fetch`, the `request`
 * and `get` functions of `node:http` and `node:https`, `http.ClientRequest`,
 * `net.connect` / `net.createConnection` and `tls.connect` with a guard that
 * lets local addresses through and refuses every other one, so a test that
 * forgets to mock Shopify (or any other host) fails instead of reaching the
 * network. Tests that mock `fetch` wrap this guard, so whatever they do not
 * answer themselves is refused too. The global `WebSocket` (like `fetch`
 * underneath) opens its connections with `net.connect` / `tls.connect`, so the
 * socket guard covers it; a socket made with `new net.Socket().connect()` is
 * not covered.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

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

function isLocal(hostname: string | null): boolean {
  return hostname !== null && (LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost'))
}

interface HostOptions {
  hostname?: string | null
  host?: string | null
}

function hostOfOptions(options: HostOptions): string | null {
  if (options.hostname) return options.hostname
  if (options.host) return options.host.replace(/:\d+$/, '')
  return null
}

/** The host `http.request(url?, options?, callback?)` would connect to. */
function nodeRequestTarget(args: unknown[]): { host: string | null; label: string } {
  const [first, second] = args
  let host: string | null = null
  let label = ''
  if (typeof first === 'string' || first instanceof URL) {
    label = String(first)
    try { host = new URL(first).hostname } catch { host = null }
    if (second && typeof second === 'object') host = hostOfOptions(second as HostOptions) ?? host
  } else if (first && typeof first === 'object') {
    // Node defaults to localhost when the options name no host.
    host = hostOfOptions(first as HostOptions) ?? 'localhost'
    label = `${host}${(first as { path?: string }).path ?? ''}`
  }
  return { host, label: label || String(host) }
}

/** The host `net.connect(options | port | path, host?)` or `tls.connect(...)` would connect to. */
function socketTarget(args: unknown[]): { host: string | null; label: string } {
  const [first, second] = args
  if (first && typeof first === 'object') {
    const options = first as HostOptions & { path?: string; port?: number | string }
    // A Unix socket path is local; with no host, Node connects to localhost.
    if (options.path && !options.host) return { host: 'localhost', label: options.path }
    const host = options.host ?? 'localhost'
    return { host, label: `${host}:${options.port ?? ''}` }
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { host: 'localhost', label: first }
  const host = typeof second === 'string' ? second : 'localhost'
  return { host, label: `${host}:${String(first)}` }
}

type RequestFunction = (...args: unknown[]) => unknown

export function installNetworkGuard(): NetworkGuard {
  const originalFetch = globalThis.fetch
  const modules = [http, https] as unknown as Array<{ request: RequestFunction; get: RequestFunction }>
  const originals = modules.map((module) => ({ module, request: module.request, get: module.get }))
  const sockets = [
    { module: net as unknown as Record<string, RequestFunction>, name: 'connect' },
    { module: net as unknown as Record<string, RequestFunction>, name: 'createConnection' },
    { module: tls as unknown as Record<string, RequestFunction>, name: 'connect' },
  ].map((entry) => ({ ...entry, original: entry.module[entry.name]! }))
  const httpModule = http as unknown as { ClientRequest: typeof http.ClientRequest }
  const originalClientRequest = httpModule.ClientRequest

  const guard: NetworkGuard = {
    blocked: [],
    report: () => {
      if (guard.blocked.length === 0) return
      const urls = [...new Set(guard.blocked)]
      const message = [
        '',
        `[network-guard] FAILED: ${guard.blocked.length} request(s) to the network were refused.`,
        '[network-guard] Tests must mock every non-local address. Refused:',
        ...urls.map((url) => `  ${url}`),
        '',
      ].join('\n')
      console.error(message)
      process.exitCode = 1
      // The test summary prints after this hook and may read as a pass: say it
      // again as the very last line, synchronously, when the process exits.
      process.once('exit', () => {
        writeSync(2, `\n[network-guard] Exiting with code 1: ${guard.blocked.length} network request(s) were refused (listed above the summary).\n`)
      })
    },
    restore: () => {
      globalThis.fetch = originalFetch
      for (const original of originals) {
        original.module.request = original.request
        original.module.get = original.get
      }
      for (const socket of sockets) socket.module[socket.name] = socket.original
      httpModule.ClientRequest = originalClientRequest
      syncBuiltinESMExports()
    },
  }

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    let hostname: string | null = null
    try { hostname = new URL(url).hostname } catch { /* refused below */ }
    if (isLocal(hostname)) return originalFetch(input, init)
    guard.blocked.push(url)
    throw new TypeError(`[network-guard] Integration tests must not reach the network: ${url}`)
  }

  for (const original of originals) {
    const wrap = (target: RequestFunction): RequestFunction => (...args: unknown[]) => {
      const { host, label } = nodeRequestTarget(args)
      if (isLocal(host)) return target(...args)
      guard.blocked.push(label)
      throw new TypeError(`[network-guard] Integration tests must not reach the network: ${label}`)
    }
    original.module.request = wrap(original.request)
    original.module.get = wrap(original.get)
  }

  for (const socket of sockets) {
    socket.module[socket.name] = (...args: unknown[]) => {
      const { host, label } = socketTarget(args)
      if (isLocal(host)) return socket.original(...args)
      guard.blocked.push(label)
      throw new TypeError(`[network-guard] Integration tests must not reach the network: ${label}`)
    }
  }

  // `new http.ClientRequest(url, options)` bypasses `http.request`.
  httpModule.ClientRequest = new Proxy(originalClientRequest, {
    construct(target, args: unknown[], newTarget) {
      const { host, label } = nodeRequestTarget(args)
      if (!isLocal(host)) {
        guard.blocked.push(label)
        throw new TypeError(`[network-guard] Integration tests must not reach the network: ${label}`)
      }
      return Reflect.construct(target, args, newTarget) as object
    },
  })
  // Named imports (`import { request } from 'node:http'`) see the guard too.
  syncBuiltinESMExports()

  return guard
}
