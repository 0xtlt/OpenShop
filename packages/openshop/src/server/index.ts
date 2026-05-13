import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve, type ServerType } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { createApiRoutes } from '#server/api'
import { createAuthRoutes } from '#server/auth'
import { createFunctionRoutes } from '#server/functions'
import { createProxyRoutes } from '#server/proxy'
import { createWebhookRoutes } from '#server/webhooks'
import { shopMiddleware } from '#server/shop'
import { verifyQueryHmac } from '#server/hmac'
import { normalizeShopDomain } from '#server/shop-domain'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import type { OpenShopConfig } from '#types'

export type ConfigGetter = () => OpenShopConfig
export interface ServerOptions {
  staticDir?: string
  proxyDir?: string
}

const localOrigin = /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/

function configuredOrigins(): string[] {
  return [process.env.HOST, process.env.SHOPIFY_APP_URL]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try { return new URL(value).origin } catch { return value.replace(/\/$/, '') }
    })
}

function resolveCorsOrigin(origin: string): string | undefined {
  if (!origin) return undefined
  if (localOrigin.test(origin)) return origin
  if (origin === 'https://admin.shopify.com') return origin
  if (/^https:\/\/[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(origin)) return origin
  if (configuredOrigins().includes(origin)) return origin
  return undefined
}

const restrictedCors = cors({ origin: resolveCorsOrigin })

const reservedPrefixes = ['/api', '/auth', '/webhooks', '/proxy', '/ext', '/health']

function isUiShellPath(pathname: string): boolean {
  if (reservedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false
  if (pathname === '/' || pathname.endsWith('/')) return true
  if (pathname.endsWith('.html')) return true
  return !pathname.split('/').pop()?.includes('.')
}

function unauthorizedUi() {
  return new Response(
    '<!doctype html><html><body><main><h1>Open this app from Shopify admin</h1></main></body></html>',
    { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

async function isInstalledShop(shop: string): Promise<boolean> {
  const [installation] = await getDb()
    .select({ id: installations.id })
    .from(installations)
    .where(and(
      eq(installations.shop, shop),
      isNotNull(installations.accessToken),
      isNull(installations.uninstalledAt),
    ))
    .limit(1)

  return Boolean(installation)
}

export async function createServer(getConfig: ConfigGetter, options?: ServerOptions) {
  const app = new Hono()

  // Auth routes (no shop middleware — these are public)
  app.route('/auth', createAuthRoutes())

  // Webhook routes (no shop middleware — Shopify sends HMAC, not JWT)
  app.route('/webhooks', createWebhookRoutes(getConfig))

  // Proxy routes (auto-discovered from proxy/ directory, HMAC-verified by Shopify)
  const proxyDir = options?.proxyDir ?? resolve(process.cwd(), 'proxy')
  if (existsSync(proxyDir)) {
    app.use('/proxy/*', restrictedCors)
    const proxyRoutes = await createProxyRoutes(proxyDir, { authModes: ['appProxyHmac', 'customerAccountJwt'] })
    app.route('/proxy', proxyRoutes)

    // Extension-direct routes: same handlers, CORS enabled, JWT required
    // Mounted on /ext/* so Shopify CLI proxy doesn't intercept
    const extRoutes = await createProxyRoutes(proxyDir, { authModes: ['customerAccountJwt'] })
    app.use('/ext/*', restrictedCors)
    app.route('/ext', extRoutes)
  }

  // CORS for dev only (not needed when serving from same origin in prod)
  if (!options?.staticDir) {
    app.use('/api/*', restrictedCors)
  }

  // Extract shop from session token / query param
  app.use('/api/*', shopMiddleware)

  // Mount API
  app.route('/api', createApiRoutes(getConfig))
  app.route('/api', createFunctionRoutes(getConfig))

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

  // Static file serving + SPA fallback (production)
  if (options?.staticDir) {
    app.use('/*', async (c, next) => {
      const pathname = new URL(c.req.url).pathname
      if (!isUiShellPath(pathname)) return next()

      const secret = process.env.SHOPIFY_API_SECRET ?? ''
      if (!secret) return c.html('SHOPIFY_API_SECRET is not configured', 500)

      const query = c.req.query() as Record<string, string>
      const shop = normalizeShopDomain(query.shop)
      if (!shop || !verifyQueryHmac(query, secret)) return unauthorizedUi()

      if (!(await isInstalledShop(shop))) {
        return c.redirect(`/auth?shop=${encodeURIComponent(shop)}`)
      }

      await next()
    })

    app.use('/*', serveStatic({ root: options.staticDir }))

    // SPA fallback: serve index.html for non-API, non-static routes
    app.get('*', serveStatic({ root: options.staticDir, path: 'index.html' }))
  }

  return app
}

export async function startApiServer(config: OpenShopConfig | ConfigGetter, port = 3001, options?: string | ServerOptions): Promise<ServerType> {
  const getConfig = typeof config === 'function' ? config : () => config
  const serverOptions = typeof options === 'string' ? { staticDir: options } : options
  const app = await createServer(getConfig, serverOptions)

  const server = serve({ fetch: app.fetch, port })

  console.log(`[openshop] API server running on http://localhost:${port}`)
  return server
}
