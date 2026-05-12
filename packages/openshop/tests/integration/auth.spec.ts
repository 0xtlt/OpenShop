import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import { createServer } from '#server/index'
import { truncateAll, createConfig } from './helpers.js'

const SECRET = process.env.SHOPIFY_API_SECRET!

const simpleFlow = { name: 'auth-flow', async run() {} }

function signOAuthQuery(params: Record<string, string>): Record<string, string> {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  const hmac = createHmac('sha256', SECRET).update(message).digest('hex')
  return { ...params, hmac }
}

async function makeApp() {
  return createServer(() => createConfig({ 'auth-flow': simpleFlow }))
}

test.group('Auth routes', (group) => {
  group.each.setup(() => truncateAll())

  test('GET /auth without shop returns 400', async ({ assert }) => {
    const app = await makeApp()
    const res = await app.request('http://localhost/auth')
    assert.equal(res.status, 400)
    const data = await res.json()
    assert.equal(data.error, 'Missing shop parameter')
  })

  test('GET /auth?shop= builds Shopify OAuth redirect', async ({ assert }) => {
    const prevKey = process.env.SHOPIFY_API_KEY
    const prevHost = process.env.HOST
    process.env.SHOPIFY_API_KEY = 'test-client-id'
    process.env.HOST = 'https://app.example.test'
    try {
      const app = await makeApp()
      const res = await app.request('http://localhost/auth?shop=redirect-shop.myshopify.com', { redirect: 'manual' })
      assert.equal(res.status, 302)
      const loc = res.headers.get('location') ?? ''
      assert.include(loc, 'redirect-shop.myshopify.com')
      assert.include(loc, 'admin/oauth/authorize')
      assert.include(loc, 'client_id=test-client-id')
    } finally {
      process.env.SHOPIFY_API_KEY = prevKey
      process.env.HOST = prevHost
    }
  })

  test('GET /auth rejects invalid shop domain', async ({ assert }) => {
    const app = await makeApp()
    const res = await app.request('http://localhost/auth?shop=evil.example.com')
    assert.equal(res.status, 400)
    const data = await res.json()
    assert.equal(data.error, 'Invalid shop parameter')
  })

  test('GET /auth/callback rejects invalid HMAC', async ({ assert }) => {
    const app = await makeApp()
    const res = await app.request(
      'http://localhost/auth/callback?shop=x.myshopify.com&code=c&state=s&hmac=deadbeef',
    )
    assert.equal(res.status, 401)
    const data = await res.json()
    assert.equal(data.error, 'Invalid HMAC')
  })

  test('GET /auth/callback rejects valid HMAC with invalid shop domain', async ({ assert }) => {
    const app = await makeApp()
    const params = signOAuthQuery({
      shop: 'evil.example.com',
      code: 'c',
      state: 's',
      timestamp: String(Math.floor(Date.now() / 1000)),
    })
    const qs = new URLSearchParams(params).toString()
    const res = await app.request(`http://localhost/auth/callback?${qs}`)
    assert.equal(res.status, 400)
    const data = await res.json()
    assert.equal(data.error, 'Invalid shop parameter')
  })

  test('GET /auth/callback with valid HMAC and mocked token exchange updates installation', async ({ assert }) => {
    const prevKey = process.env.SHOPIFY_API_KEY
    process.env.SHOPIFY_API_KEY = 'app-key-for-callback'

    const shop = 'oauth-ok.myshopify.com'
    const state = 'expected-nonce-123'
    const db = getDb()
    await db.insert(installations).values({ shop, nonce: state })

    const app = await makeApp()

    const params = signOAuthQuery({
      shop,
      code: 'temporary-code',
      state,
      timestamp: String(Math.floor(Date.now() / 1000)),
    })
    const qs = new URLSearchParams(params).toString()

    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/admin/oauth/access_token')) {
        return Response.json({ access_token: 'stored-access-token', scope: 'read_products' })
      }
      return originalFetch(input, init)
    }

    try {
      const res = await app.request(`http://localhost/auth/callback?${qs}`, { redirect: 'manual' })
      assert.equal(res.status, 302)

      const [row] = await db.select().from(installations).where(eq(installations.shop, shop)).limit(1)
      assert.equal(row.accessToken, 'stored-access-token')
      assert.equal(row.scopes, 'read_products')
      assert.isNull(row.nonce)
    } finally {
      globalThis.fetch = originalFetch
      process.env.SHOPIFY_API_KEY = prevKey
    }
  })
})
