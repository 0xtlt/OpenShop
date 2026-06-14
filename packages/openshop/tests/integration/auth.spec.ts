import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import { decryptString } from '#server/crypto'
import { createServer } from '#server/index'
import { truncateAll, createConfig } from './helpers.ts'

const SECRET = process.env.SHOPIFY_API_SECRET!
const MULTI_SHOPIFY = {
  scopes: 'read_products',
  apps: {
    clientA: {
      apiKey: 'client-a-key',
      apiSecret: 'client-a-secret',
      appUrl: 'https://client-a.example.test',
    },
    clientB: {
      apiKey: 'client-b-key',
      apiSecret: 'client-b-secret',
      appUrl: 'https://client-b.example.test',
    },
  },
}

const simpleFlow = { name: 'auth-flow', async run() {} }

function signOAuthQuery(params: Record<string, string>, secret = SECRET): Record<string, string> {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  const hmac = createHmac('sha256', secret).update(message).digest('hex')
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

  test('GET /auth with multiple apps requires an explicit app handle', async ({ assert }) => {
    const app = await createServer(() => createConfig({ 'auth-flow': simpleFlow }, { shopify: MULTI_SHOPIFY }))
    const res = await app.request('http://localhost/auth?shop=multi-auth.myshopify.com')
    assert.equal(res.status, 400)
    const data = await res.json()
    assert.include(data.error, 'Missing Shopify app handle')
  })

  test('GET /auth with app handle builds the matching app OAuth redirect', async ({ assert }) => {
    const app = await createServer(() => createConfig({ 'auth-flow': simpleFlow }, { shopify: MULTI_SHOPIFY }))
    const res = await app.request('http://localhost/auth?shop=multi-auth.myshopify.com&app=clientA', { redirect: 'manual' })
    assert.equal(res.status, 302)
    const loc = res.headers.get('location') ?? ''
    assert.include(loc, 'client_id=client-a-key')
    assert.include(loc, encodeURIComponent('https://client-a.example.test/auth/callback'))

    const [row] = await getDb().select().from(installations)
      .where(and(eq(installations.appHandle, 'clientA'), eq(installations.shop, 'multi-auth.myshopify.com')))
      .limit(1)
    assert.equal(row.shop, 'multi-auth.myshopify.com')
    assert.isString(row.nonce)
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
      assert.notEqual(row.accessToken, 'stored-access-token')
      assert.equal(decryptString(row.accessToken), 'stored-access-token')
      assert.equal(row.scopes, 'read_products')
      assert.isNull(row.nonce)
    } finally {
      globalThis.fetch = originalFetch
      process.env.SHOPIFY_API_KEY = prevKey
    }
  })

  test('GET /auth/callback resolves the app from HMAC and isolates installations by app', async ({ assert }) => {
    const shop = 'same-shop.myshopify.com'
    const stateA = 'nonce-client-a'
    const stateB = 'nonce-client-b'
    const db = getDb()
    await db.insert(installations).values([
      { appHandle: 'clientA', shop, nonce: stateA },
      { appHandle: 'clientB', shop, nonce: stateB },
    ])

    const app = await createServer(() => createConfig({ 'auth-flow': simpleFlow }, { shopify: MULTI_SHOPIFY }))
    const params = signOAuthQuery({
      shop,
      code: 'temporary-code-client-b',
      state: stateB,
      timestamp: String(Math.floor(Date.now() / 1000)),
    }, 'client-b-secret')
    const qs = new URLSearchParams(params).toString()

    const originalFetch = globalThis.fetch
    let tokenBody: any
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/admin/oauth/access_token')) {
        tokenBody = JSON.parse(String(init?.body))
        return Response.json({ access_token: 'stored-token-client-b', scope: 'read_products' })
      }
      return originalFetch(input, init)
    }

    try {
      const res = await app.request(`http://localhost/auth/callback?${qs}`, { redirect: 'manual' })
      assert.equal(res.status, 302)
      assert.deepEqual(tokenBody, {
        client_id: 'client-b-key',
        client_secret: 'client-b-secret',
        code: 'temporary-code-client-b',
      })

      const [rowA] = await db.select().from(installations)
        .where(and(eq(installations.appHandle, 'clientA'), eq(installations.shop, shop)))
        .limit(1)
      const [rowB] = await db.select().from(installations)
        .where(and(eq(installations.appHandle, 'clientB'), eq(installations.shop, shop)))
        .limit(1)

      assert.isNull(rowA.accessToken)
      assert.equal(rowA.nonce, stateA)
      assert.equal(decryptString(rowB.accessToken), 'stored-token-client-b')
      assert.isNull(rowB.nonce)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
