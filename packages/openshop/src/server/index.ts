import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve, type ServerType } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApiRoutes } from '#server/api'
import { createAuthRoutes } from '#server/auth'
import { createFunctionRoutes } from '#server/functions'
import { createProxyRoutes } from '#server/proxy'
import { createWebhookRoutes } from '#server/webhooks'
import { shopMiddleware } from '#server/shop'
import type { OpenShopConfig } from '#types'

export type ConfigGetter = () => OpenShopConfig

export async function createServer(getConfig: ConfigGetter, options?: { staticDir?: string }) {
  const app = new Hono()

  // Auth routes (no shop middleware — these are public)
  app.route('/auth', createAuthRoutes())

  // Webhook routes (no shop middleware — Shopify sends HMAC, not JWT)
  app.route('/webhooks', createWebhookRoutes(getConfig))

  // Proxy routes (auto-discovered from proxy/ directory, HMAC-verified by Shopify)
  const proxyDir = resolve(process.cwd(), 'proxy')
  if (existsSync(proxyDir)) {
    app.use('/proxy/*', cors())
    const proxyRoutes = await createProxyRoutes(proxyDir, { authModes: ['appProxyHmac', 'customerAccountJwt'] })
    app.route('/proxy', proxyRoutes)

    // Extension-direct routes: same handlers, CORS enabled, JWT required
    // Mounted on /ext/* so Shopify CLI proxy doesn't intercept
    const extRoutes = await createProxyRoutes(proxyDir, { authModes: ['customerAccountJwt'] })
    app.use('/ext/*', cors())
    app.route('/ext', extRoutes)
  }

  // CORS for dev only (not needed when serving from same origin in prod)
  if (!options?.staticDir) {
    app.use('/api/*', cors())
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
    app.use('/*', serveStatic({ root: options.staticDir }))

    // SPA fallback: serve index.html for non-API, non-static routes
    app.get('*', serveStatic({ root: options.staticDir, path: 'index.html' }))
  }

  return app
}

export async function startApiServer(config: OpenShopConfig | ConfigGetter, port = 3001, staticDir?: string): Promise<ServerType> {
  const getConfig = typeof config === 'function' ? config : () => config
  const app = await createServer(getConfig, staticDir ? { staticDir } : undefined)

  const server = serve({ fetch: app.fetch, port })

  console.log(`[openshop] API server running on http://localhost:${port}`)
  return server
}
