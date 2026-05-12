import { Hono } from 'hono'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { customerIdFromJwtSub, verifySessionToken } from '#server/jwt'
import { normalizeShopDomain } from '#server/shop-domain'
import type { ProxyDefinition, ProxyContext } from '#types'

// ─── HMAC Verification ──────────────────────────────────────────────

function verifyProxySignature(query: Record<string, string>, secret: string): boolean {
  const signature = query.signature
  if (!signature || !secret) return false

  // Build sorted param string (exclude signature)
  const sorted = Object.keys(query)
    .filter((k) => k !== 'signature')
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('')

  const computed = createHmac('sha256', secret).update(sorted).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signature, 'hex'))
  } catch {
    return false
  }
}

// ─── File scanner ───────────────────────────────────────────────────

function scanProxyDir(dir: string): Array<{ filePath: string; routePath: string }> {
  const results: Array<{ filePath: string; routePath: string }> = []

  function walk(current: string) {
    for (const entry of readdirSync(current)) {
      const full = resolve(current, entry)
      const stat = statSync(full)

      if (stat.isDirectory()) {
        walk(full)
        continue
      }

      if (!entry.endsWith('.ts') && !entry.endsWith('.js')) continue

      // Convert file path to route path
      let route = '/' + relative(dir, full)
        .replace(/\.(ts|js)$/, '')
        .replace(/\\/g, '/')

      // index files → parent path
      if (route.endsWith('/index')) route = route.slice(0, -6) || '/'

      // [param] → :param
      route = route.replace(/\[([^\]]+)\]/g, ':$1')

      results.push({ filePath: full, routePath: route })
    }
  }

  walk(dir)
  return results
}

// ─── Route builder ──────────────────────────────────────────────────

export type ProxyAuthMode = 'appProxyHmac' | 'customerAccountJwt'

interface ResolvedProxyAuth {
  kind: ProxyAuthMode
  shop: string
  customerId: string | null
}

type AuthResolution =
  | { ok: true; auth: ResolvedProxyAuth }
  | { ok: false; error: string }

function signedCustomerId(value: string | undefined): string | null {
  return value && /^\d+$/.test(value) ? value : null
}

function resolveProxyAuth(query: Record<string, string>, headers: Record<string, string>, modes: ProxyAuthMode[], secret: string): AuthResolution {
  const auth = headers['authorization'] ?? ''
  if (auth.startsWith('Bearer ')) {
    if (!modes.includes('customerAccountJwt')) {
      return { ok: false, error: 'Unauthorized: session token not accepted on this route' }
    }

    try {
      const { shop, payload } = verifySessionToken(auth.slice(7), secret)
      return {
        ok: true,
        auth: {
          kind: 'customerAccountJwt',
          shop,
          customerId: customerIdFromJwtSub(payload.sub),
        },
      }
    } catch {
      return { ok: false, error: 'Unauthorized: invalid or expired session token' }
    }
  }

  if (modes.includes('appProxyHmac')) {
    if (!verifyProxySignature(query, secret)) {
      return { ok: false, error: 'Invalid proxy signature' }
    }

    const shop = normalizeShopDomain(query.shop)
    if (!shop) return { ok: false, error: 'Invalid shop parameter' }

    return {
      ok: true,
      auth: {
        kind: 'appProxyHmac',
        shop,
        customerId: signedCustomerId(query.logged_in_customer_id),
      },
    }
  }

  return { ok: false, error: 'Unauthorized: missing session token' }
}

function sanitizedQuery(query: Record<string, string>, auth: ResolvedProxyAuth): Record<string, string> {
  const safeQuery: Record<string, string> = { ...query, shop: auth.shop }

  if (auth.customerId) {
    safeQuery.logged_in_customer_id = auth.customerId
  } else {
    delete safeQuery.logged_in_customer_id
  }

  return safeQuery
}

function buildContext(query: Record<string, string>, headers: Record<string, string>, method: string, url: string, auth: ResolvedProxyAuth): ProxyContext {
  return {
    shop: auth.shop,
    customerId: auth.customerId,
    auth: { kind: auth.kind },
    query: sanitizedQuery(query, auth),
    params: {},
    headers,
    path: new URL(url, 'http://localhost').pathname,
    method,
    body: undefined,
  }
}

function sendResponse(result: unknown, type: ProxyDefinition['type']): Response {
  if (type === 'liquid' && typeof result === 'string') {
    return new Response(result, {
      headers: { 'Content-Type': 'application/liquid' },
    })
  }

  if (type === 'html' && typeof result === 'string') {
    return new Response(result, {
      headers: { 'Content-Type': 'text/html' },
    })
  }

  // Default: JSON
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// ─── Public API ─────────────────────────────────────────────────────

export async function createProxyRoutes(proxyDir: string, options?: { authModes?: ProxyAuthMode[] }): Promise<Hono> {
  const app = new Hono()
  const secret = process.env.SHOPIFY_API_SECRET ?? ''
  const authModes = options?.authModes ?? ['appProxyHmac', 'customerAccountJwt']

  // Scan and register routes
  const files = scanProxyDir(proxyDir)

  for (const { filePath, routePath } of files) {
    let definition: ProxyDefinition

    try {
      const mod = await import(filePath)
      definition = mod.default ?? mod
    } catch (err) {
      console.warn(`[openshop] Failed to load proxy route ${routePath}:`, err)
      continue
    }

    const responseType = definition.type ?? 'json'

    // Register each HTTP method that has a handler
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const
    for (const method of methods) {
      const handler = definition[method]
      if (!handler) continue

      const honoMethod = method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'

      app[honoMethod](routePath, async (c) => {
        if (!secret) return c.json({ error: 'SHOPIFY_API_SECRET is not configured' }, 500)

        const hdrs: Record<string, string> = {}
        for (const [k, v] of Object.entries(c.req.header())) { if (typeof v === 'string') hdrs[k.toLowerCase()] = v }
        const query = c.req.query()
        const resolvedAuth = resolveProxyAuth(query, hdrs, authModes, secret)

        if (!resolvedAuth.ok) {
          return c.json({ error: resolvedAuth.error }, 401)
        }

        const ctx = buildContext(query, hdrs, c.req.method, c.req.url, resolvedAuth.auth)

        // Extract route params
        const paramObj = c.req.param()
        for (const key of Object.keys(paramObj)) {
          const val = paramObj[key as keyof typeof paramObj]
          if (val) ctx.params[key] = val
        }

        // Parse body for non-GET methods
        if (method !== 'GET') {
          try {
            const text = await c.req.text()
            ctx.body = text ? JSON.parse(text) : undefined
          } catch {
            ctx.body = undefined
          }
        }

        try {
          const result = await handler(ctx)
          return sendResponse(result, responseType)
        } catch (error) {
          console.error(`[openshop] Proxy ${method} ${routePath} error:`, error)
          return c.json({ error: 'Internal proxy error' }, 500)
        }
      })
    }

    console.log(`[openshop] Proxy route: ${routePath} (${responseType})`)
  }

  if (files.length) {
    console.log(`[openshop] ${files.length} proxy route(s) registered`)
  }

  return app
}
