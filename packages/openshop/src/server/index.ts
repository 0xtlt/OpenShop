import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve, type ServerType } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { createApiRoutes } from '#server/api'
import { createAuthRoutes } from '#server/auth'
import { createFunctionRoutes } from '#server/functions'
import { createProxyRoutes } from '#server/proxy'
import { createWebhookRoutes } from '#server/webhooks'
import { createShopMiddleware } from '#server/shop'
import { normalizeShopDomain } from '#server/shop-domain'
import { DEFAULT_SHOPIFY_APP_HANDLE, resolveShopifyAppBySignedQuery } from '#server/shopify-apps'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import type { OpenShopConfig } from '#types'
import { getRuntimeLogger } from '../runtime/logger.ts'

export type ConfigGetter = () => OpenShopConfig
export interface ServerOptions {
  staticDir?: string
  proxyDir?: string
}

const localOrigin = /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/
const shopifyExtensionOrigin = 'https://extensions.shopifycdn.com'

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
  if (origin === 'https://shopify.com') return origin
  if (origin === shopifyExtensionOrigin) return origin
  if (/^https:\/\/[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(origin)) return origin
  if (configuredOrigins().includes(origin)) return origin
  return undefined
}

const restrictedCors = cors({ origin: resolveCorsOrigin })
const extensionCors = cors({ origin: '*' })
const robotsHeader = 'noindex, nofollow, noarchive, nosnippet'
const robotsTxt = `User-agent: *
Disallow: /
`

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
    { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': robotsHeader } },
  )
}

async function isInstalledShop(shopifyApp: string, shop: string): Promise<boolean> {
  const [installation] = await getDb()
    .select({ id: installations.id })
    .from(installations)
    .where(and(
      eq(installations.appHandle, shopifyApp),
      eq(installations.shop, shop),
      isNotNull(installations.accessToken),
      isNull(installations.uninstalledAt),
    ))
    .limit(1)

  return Boolean(installation)
}

export async function createServer(getConfig: ConfigGetter, options?: ServerOptions) {
  const app = new Hono()

  app.use('*', async (c, next) => {
    c.header('X-Robots-Tag', robotsHeader)
    await next()
  })

  app.get('/robots.txt', (c) => c.text(robotsTxt))

  // Auth routes (no shop middleware — these are public)
  app.route('/auth', createAuthRoutes(getConfig))

  // Webhook routes (no shop middleware — Shopify sends HMAC, not JWT)
  app.route('/webhooks', createWebhookRoutes(getConfig))

  // Proxy routes (auto-discovered from proxy/ directory, HMAC-verified by Shopify)
  const proxyDir = options?.proxyDir ?? resolve(process.cwd(), 'proxy')
  if (existsSync(proxyDir)) {
    app.use('/proxy/*', extensionCors)
    const proxyRoutes = await createProxyRoutes(proxyDir, getConfig, { authModes: ['appProxyHmac', 'customerAccountJwt'] })
    app.route('/proxy', proxyRoutes)

    // Extension-direct routes: same handlers, CORS enabled, JWT required
    // Mounted on /ext/* so Shopify CLI proxy doesn't intercept
    const extRoutes = await createProxyRoutes(proxyDir, getConfig, { authModes: ['customerAccountJwt'] })
    app.use('/ext/*', extensionCors)
    app.route('/ext', extRoutes)
  }

  // CORS for dev only (not needed when serving from same origin in prod)
  if (!options?.staticDir) {
    app.use('/api/*', restrictedCors)
  }

  // Extract shop from session token / query param
  app.use('/api/*', createShopMiddleware(getConfig))

  // Mount API
  app.route('/api', createApiRoutes(getConfig))
  app.route('/api', createFunctionRoutes(getConfig))

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

  // Static file serving + SPA fallback (production)
  if (options?.staticDir) {
    const staticHandler = serveStatic({ root: options.staticDir })
    const indexHtmlPath = resolve(options.staticDir, 'index.html')

    app.use('/*', async (c, next) => {
      const pathname = new URL(c.req.url).pathname
      if (!isUiShellPath(pathname)) return next()

      const query = c.req.query() as Record<string, string>
      const shop = normalizeShopDomain(query.shop)
      if (!shop) return unauthorizedUi()

      let shopifyApp
      try {
        shopifyApp = resolveShopifyAppBySignedQuery(getConfig(), query)
      } catch {
        return unauthorizedUi()
      }

      if (!(await isInstalledShop(shopifyApp.handle, shop))) {
        const appParam = shopifyApp.handle === DEFAULT_SHOPIFY_APP_HANDLE ? '' : `&app=${encodeURIComponent(shopifyApp.handle)}`
        return c.redirect(`/auth?shop=${encodeURIComponent(shop)}${appParam}`)
      }

      ;(c as unknown as { set: (key: string, value: string) => void }).set('shopifyApiKey', shopifyApp.apiKey)
      await next()
    })

    app.use('/*', async (c, next) => {
      const pathname = new URL(c.req.url).pathname
      if (isUiShellPath(pathname)) return next()
      return staticHandler(c, next)
    })

    // SPA fallback: serve index.html for non-API, non-static routes
    app.get('*', async (c) => {
      const pathname = new URL(c.req.url).pathname
      if (!isUiShellPath(pathname)) return staticHandler(c, async () => undefined)
      const apiKey = (c as unknown as { get: (key: string) => unknown }).get('shopifyApiKey') as string | undefined
      const html = readFileSync(indexHtmlPath, 'utf8')
        .replace(/<meta name="shopify-api-key" content="[^"]*" \/>/, `<meta name="shopify-api-key" content="${apiKey ?? ''}" />`)
        .replace(
          /data-api-key="[^"]*" src="https:\/\/cdn\.shopify\.com\/shopifycloud\/app-bridge\.js"/,
          `data-api-key="${apiKey ?? ''}" src="https://cdn.shopify.com/shopifycloud/app-bridge.js"`,
        )
      return c.html(html)
    })
  }

  return app
}

export async function startApiServer(config: OpenShopConfig | ConfigGetter, port = 3001, options?: string | ServerOptions): Promise<ServerType> {
  const getConfig = typeof config === 'function' ? config : () => config
  const serverOptions = typeof options === 'string' ? { staticDir: options } : options
  const app = await createServer(getConfig, serverOptions)

  const server = serve({ fetch: app.fetch, port })

  getRuntimeLogger().info(`[openshop] API server running on http://localhost:${port}`)
  return server
}
