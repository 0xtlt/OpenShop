import { resolve } from 'node:path'
import { createHmac } from 'node:crypto'
import { type, type Type } from 'arktype'
import { eq } from 'drizzle-orm'
import { createServer } from '#server/index'
import { serve, type ServerType } from '@hono/node-server'
import type { OpenShopConfig } from '#types'
import { runFlow, type RunFlowResult } from '#engine/runner'
import { dispatchFlow } from '#engine/dispatch'
import { getDb } from '#db/client'
import { flowRuns, installations } from '#db/schema'
import { createFakeProviders, resetFakeProviders, type TypedFakeProviders } from './fake.js'
import { FactoryScope, type Factory } from './factory.js'
import { createShopifyClient } from '../shopify/client.js'

// ─── Proxy test client ──────────────────────────────────────────────

interface ProxyRequestBuilder<TExpect = unknown> {
  asCustomer(customerId: string): ProxyRequestBuilder<TExpect>
  qs(params: Record<string, string>): ProxyRequestBuilder<TExpect>
  json(body: unknown): ProxyRequestBuilder<TExpect>
  header(key: string, value: string): ProxyRequestBuilder<TExpect>
  expect<T>(schema: Type<T>): ProxyRequestBuilder<T>
  send(): Promise<ProxyResponse<TExpect>>
}

interface ProxyResponse<T = unknown> {
  status: number
  headers: Record<string, string>
  body: T
  text: string
  contentType: string
}

function createProxyClient(baseUrl: string, shop: string, secret: string) {
  function buildSignature(params: Record<string, string>): string {
    const sorted = Object.keys(params)
      .filter((k) => k !== 'signature')
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('')
    return createHmac('sha256', secret).update(sorted).digest('hex')
  }

  function request(method: string, path: string): ProxyRequestBuilder {
    let customerId = ''
    let extraQs: Record<string, string> = {}
    let bodyData: unknown
    let expectSchema: Type | null = null
    const extraHeaders: Record<string, string> = {}

    const builder: ProxyRequestBuilder = {
      asCustomer(id) { customerId = id; return builder },
      qs(params) { extraQs = { ...extraQs, ...params }; return builder },
      json(body) { bodyData = body; return builder },
      header(key, value) { extraHeaders[key] = value; return builder },
      expect(schema) { expectSchema = schema; return builder as never },
      async send(): Promise<ProxyResponse<unknown>> {
        const params: Record<string, string> = {
          shop,
          timestamp: String(Math.floor(Date.now() / 1000)),
          path_prefix: '/apps/openshop',
          logged_in_customer_id: customerId,
          ...extraQs,
        }
        params.signature = buildSignature(params)

        const qs = new URLSearchParams(params).toString()
        const url = `${baseUrl}/proxy${path}?${qs}`

        if (bodyData !== undefined) {
          extraHeaders['Content-Type'] = 'application/json'
        }

        const init: RequestInit = {
          method,
          headers: { ...extraHeaders },
          body: bodyData !== undefined ? JSON.stringify(bodyData) : undefined,
        }

        const res = await fetch(url, init)
        const text = await res.text()
        const contentType = res.headers.get('content-type') ?? ''

        let body: unknown = text
        if (contentType.includes('json')) {
          try { body = JSON.parse(text) } catch { /* raw text */ }
        }

        if (expectSchema) {
          const result = expectSchema(body)
          if (result instanceof type.errors) {
            throw new Error(`Proxy response validation failed: ${result.summary}`)
          }
          body = result
        }

        const headers: Record<string, string> = {}
        res.headers.forEach((v, k) => { headers[k] = v })

        return { status: res.status, headers, body, text, contentType }
      },
    }

    return builder
  }

  return {
    get: (path: string) => request('GET', path),
    post: (path: string) => request('POST', path),
    put: (path: string) => request('PUT', path),
    delete: (path: string) => request('DELETE', path),
    patch: (path: string) => request('PATCH', path),
  }
}

function createSessionToken(shop: string, secret: string, apiKey: string, sub = '1'): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: apiKey,
    sub,
    exp: now + 60,
    nbf: now - 10,
    iat: now,
    jti: 'test-jti',
    sid: 'test-sid',
  })).toString('base64url')
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

// ─── Test context ───────────────────────────────────────────────────

export type ProxyClient = ReturnType<typeof createProxyClient>

export interface TestContext {
  url: string
  port: number
  config: OpenShopConfig

  /** Run a flow with faked providers */
  runFlow: (flowName: string, input?: Record<string, unknown>, shop?: string) => Promise<RunFlowResult>
  /** Dispatch a flow to the queue */
  dispatchFlow: (flowName: string, input?: Record<string, unknown>, shop?: string) => Promise<{ runId: string }>
  /** Proxy test client — auto-signs HMAC */
  proxy: ProxyClient
  /** Create a signed Shopify session token for authenticated API requests. */
  sessionToken: (shop?: string, sub?: string) => string
  /** Authorization header value for authenticated API requests. */
  authorizationHeader: (shop?: string, sub?: string) => string
  /** Auto-generated provider fakes — typed from OpenShopConnectors */
  fakes: TypedFakeProviders
  /** Reset all fakes call history */
  resetFakes: () => void

  /** Create a resource via a factory, tracked for auto-cleanup */
  create: <TResource, TOverrides>(factory: Factory<TResource, TOverrides>, overrides?: Partial<TOverrides>) => Promise<TResource>
  /** Cleanup all factory-created resources */
  cleanup: () => Promise<void>

  /** Access the Drizzle DB client */
  db: ReturnType<typeof getDb>
  /** Shut down the test server */
  shutdown: () => Promise<void>
}

export interface TestOptions {
  configPath?: string
  port?: number
  shop?: string
  secret?: string
  apiKey?: string
  accessToken?: string
}

export async function createTestContext(options: TestOptions = {}): Promise<TestContext> {
  const cwd = process.cwd()
  const configPath = options.configPath ?? resolve(cwd, 'openshop.config.ts')
  const shop = options.shop ?? 'test.myshopify.com'
  const secret = options.secret ?? process.env.SHOPIFY_API_SECRET ?? 'test-secret'
  const apiKey = options.apiKey ?? process.env.SHOPIFY_API_KEY ?? 'test-app'

  process.env.SHOPIFY_API_SECRET = secret
  process.env.SHOPIFY_API_KEY = apiKey

  const mod = await import(configPath)
  const config: OpenShopConfig = mod.default ?? mod

  const getConfig = () => config
  const app = await createServer(getConfig)

  const port = options.port ?? (40000 + Math.floor(Math.random() * 10000))
  let server: ServerType | null = null

  await new Promise<void>((done) => {
    server = serve({ fetch: app.fetch, port }, () => done())
  })

  const url = `http://localhost:${port}`
  const db = getDb()
  const fakes = createFakeProviders(config.providers)

  if (options.accessToken) {
    const [existing] = await db.select({ id: installations.id }).from(installations).where(eq(installations.shop, shop)).limit(1)
    if (existing) {
      await db.update(installations)
        .set({ accessToken: options.accessToken, scopes: 'read_products,read_orders', uninstalledAt: null })
        .where(eq(installations.id, existing.id))
    } else {
      await db.insert(installations).values({ shop, accessToken: options.accessToken, scopes: 'read_products,read_orders' })
    }
  }

  // Factory scope — uses real Shopify client for the test shop
  let factoryScope: FactoryScope | null = null
  try {
    const shopify = await createShopifyClient(shop)
    factoryScope = new FactoryScope(shopify)
  } catch {
    // No Shopify client available (no installation) — factories won't work
  }

  return {
    url,
    port,
    config,

    async runFlow(flowName, input = {}, flowShop = shop) {
      const [run] = await db.insert(flowRuns).values({
        shop: flowShop,
        flowName,
        status: 'running',
        input: JSON.parse(JSON.stringify(input)),
        availableAt: new Date(),
      }).returning({ id: flowRuns.id })

      return runFlow({
        runId: run.id,
        flowName,
        input,
        config,
        shop: flowShop,
        connectors: fakes as unknown as OpenShopConnectors,
      })
    },

    async dispatchFlow(flowName, input = {}, flowShop = shop) {
      const result = await dispatchFlow({ flowName, input, config, shop: flowShop })
      return { runId: result.runId }
    },

    proxy: createProxyClient(url, shop, secret),
    sessionToken: (tokenShop = shop, sub = '1') => createSessionToken(tokenShop, secret, apiKey, sub),
    authorizationHeader: (tokenShop = shop, sub = '1') => `Bearer ${createSessionToken(tokenShop, secret, apiKey, sub)}`,
    fakes,
    resetFakes: () => resetFakeProviders(fakes),

    async create(factory, overrides) {
      if (!factoryScope) throw new Error('No Shopify client available. Is the test shop installed?')
      return factoryScope.create(factory, overrides)
    },
    async cleanup() {
      if (factoryScope) await factoryScope.cleanup()
    },

    db,

    async shutdown() {
      if (factoryScope) await factoryScope.cleanup()
      server?.close()
    },
  }
}
