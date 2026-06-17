import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from '#server/index'
import { createProxyRoutes } from '#server/proxy'
import { createConfig } from './helpers.ts'

const secret = process.env.SHOPIFY_API_SECRET!
const apiKey = process.env.SHOPIFY_API_KEY!
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

function signProxyQuery(params: Record<string, string>, signingSecret = secret): Record<string, string> {
  const sorted = Object.keys(params)
    .filter((k) => k !== 'signature')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('')
  const signature = createHmac('sha256', signingSecret).update(sorted).digest('hex')
  return { ...params, signature }
}

function queryString(q: Record<string, string>): string {
  return new URLSearchParams(q).toString()
}

function createJwt(shop: string, sub = 'gid://shopify/Customer/123', aud = apiKey, expOffsetSeconds = 3600, signingSecret = secret): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud,
    sub,
    exp: now + expOffsetSeconds,
    nbf: now - 10,
    iat: now,
    jti: 'proxy-jti',
    sid: 'proxy-sid',
  })).toString('base64url')
  const sig = createHmac('sha256', signingSecret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const proxyHandlerFile = `
export default {
  GET: async ({ shop, shopifyApp, customerId, auth, query }) => ({
    pong: true,
    from: 'proxy-spec',
    shop,
    customerId,
    authKind: auth.kind,
    shopifyApp,
    queryShop: query.shop ?? null,
    queryCustomerId: query.logged_in_customer_id ?? null,
  }),
}
`

test.group('Proxy routes (createProxyRoutes)', (group) => {
  let tmpDir: string

  group.setup(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openshop-proxy-test-'))
    writeFileSync(join(tmpDir, 'ping.ts'), proxyHandlerFile.trimStart(), 'utf8')
    writeFileSync(join(tmpDir, '_private.ts'), proxyHandlerFile.trimStart(), 'utf8')
    mkdirSync(join(tmpDir, '_shared'))
    writeFileSync(join(tmpDir, '_shared', 'ping.ts'), proxyHandlerFile.trimStart(), 'utf8')
  })

  group.teardown(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('GET without valid proxy signature returns 401', async ({ assert }) => {
    const app = await createProxyRoutes(tmpDir)
    const res = await app.request(`http://localhost/ping?shop=test.myshopify.com`)
    assert.equal(res.status, 401)
  })

  test('GET with invalid proxy signature returns 401', async ({ assert }) => {
    const app = await createProxyRoutes(tmpDir)
    const q = signProxyQuery({ shop: 'test.myshopify.com', logged_in_customer_id: '42' })
    q.signature = 'bad-signature'
    const res = await app.request(`http://localhost/ping?${queryString(q)}`)
    assert.equal(res.status, 401)
  })

  test('GET with valid HMAC returns handler JSON', async ({ assert }) => {
    const app = await createProxyRoutes(tmpDir)
    const q = signProxyQuery({ shop: 'test.myshopify.com', logged_in_customer_id: '42' })
    const res = await app.request(`http://localhost/ping?${queryString(q)}`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.pong, true)
    assert.equal(data.from, 'proxy-spec')
    assert.equal(data.shop, 'test.myshopify.com')
    assert.equal(data.customerId, '42')
    assert.equal(data.authKind, 'appProxyHmac')
    assert.equal(data.shopifyApp, 'default')
    assert.equal(data.queryShop, 'test.myshopify.com')
    assert.equal(data.queryCustomerId, '42')
  })

  test('ignores underscore-prefixed proxy files and directories', async ({ assert }) => {
    const app = await createProxyRoutes(tmpDir)
    const q = signProxyQuery({ shop: 'test.myshopify.com', logged_in_customer_id: '42' })

    const privateFile = await app.request(`http://localhost/_private?${queryString(q)}`)
    const privateDir = await app.request(`http://localhost/_shared/ping?${queryString(q)}`)

    assert.equal(privateFile.status, 404)
    assert.equal(privateDir.status, 404)
  })

  test('GET with app proxy signature resolves the matching Shopify app', async ({ assert }) => {
    const app = await createProxyRoutes(tmpDir, () => createConfig({}, { shopify: MULTI_SHOPIFY }))
    const q = signProxyQuery({ shop: 'client-b-shop.myshopify.com', logged_in_customer_id: '42' }, 'client-b-secret')
    const res = await app.request(`http://localhost/ping?${queryString(q)}`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.shop, 'client-b-shop.myshopify.com')
    assert.equal(data.authKind, 'appProxyHmac')
    assert.equal(data.shopifyApp, 'clientB')
  })

  test('extension mode rejects unsigned forged query identity', async ({ assert }) => {
    const app = await createProxyRoutes(tmpDir, { authModes: ['customerAccountJwt'] })
    const res = await app.request('http://localhost/ping?shop=victim.myshopify.com&logged_in_customer_id=999')
    assert.equal(res.status, 401)
  })

  test('extension mode uses JWT identity and ignores query identity', async ({ assert }) => {
    const app = await createProxyRoutes(tmpDir, { authModes: ['customerAccountJwt'] })
    const token = createJwt('jwt-shop.myshopify.com')
    const res = await app.request('http://localhost/ping?shop=attacker.myshopify.com&logged_in_customer_id=999', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.pong, true)
    assert.equal(data.shop, 'jwt-shop.myshopify.com')
    assert.equal(data.customerId, '123')
    assert.equal(data.authKind, 'customerAccountJwt')
    assert.equal(data.shopifyApp, 'default')
    assert.equal(data.queryShop, 'jwt-shop.myshopify.com')
    assert.equal(data.queryCustomerId, '123')
  })

  test('extension mode resolves Shopify app from JWT audience', async ({ assert }) => {
    const app = await createProxyRoutes(tmpDir, () => createConfig({}, { shopify: MULTI_SHOPIFY }), { authModes: ['customerAccountJwt'] })
    const token = createJwt('jwt-client-b.myshopify.com', 'gid://shopify/Customer/123', 'client-b-key', 3600, 'client-b-secret')
    const res = await app.request('http://localhost/ping?shop=attacker.myshopify.com&logged_in_customer_id=999', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.shop, 'jwt-client-b.myshopify.com')
    assert.equal(data.authKind, 'customerAccountJwt')
    assert.equal(data.shopifyApp, 'clientB')
    assert.equal(data.queryShop, 'jwt-client-b.myshopify.com')
  })

  test('extension mode rejects JWT with wrong audience', async ({ assert }) => {
    const app = await createProxyRoutes(tmpDir, { authModes: ['customerAccountJwt'] })
    const token = createJwt('jwt-shop.myshopify.com', 'gid://shopify/Customer/123', 'wrong-app')
    const res = await app.request('http://localhost/ping', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
  })

  test('extension mode rejects invalid bearer token', async ({ assert }) => {
    const app = await createProxyRoutes(tmpDir, { authModes: ['customerAccountJwt'] })
    const res = await app.request('http://localhost/ping', {
      headers: { Authorization: 'Bearer not-a-valid-token' },
    })
    assert.equal(res.status, 401)
  })

  test('extension mode rejects expired bearer token', async ({ assert }) => {
    const app = await createProxyRoutes(tmpDir, { authModes: ['customerAccountJwt'] })
    const token = createJwt('jwt-shop.myshopify.com', 'gid://shopify/Customer/123', apiKey, -3600)
    const res = await app.request('http://localhost/ping', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
  })

  test('numeric admin sub is not treated as a customer id', async ({ assert }) => {
    const app = await createProxyRoutes(tmpDir, { authModes: ['customerAccountJwt'] })
    const token = createJwt('jwt-shop.myshopify.com', '123')
    const res = await app.request('http://localhost/ping', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.isNull(data.customerId)
    assert.equal(data.queryShop, 'jwt-shop.myshopify.com')
    assert.isNull(data.queryCustomerId)
  })

  test('server proxy routes allow Shopify UI extension CORS', async ({ assert }) => {
    const app = await createServer(() => createConfig({}), { proxyDir: tmpDir })
    const token = createJwt('jwt-shop.myshopify.com')

    const preflight = await app.request('http://localhost/proxy/ping', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://extensions.shopifycdn.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://extensions.shopifycdn.com')
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'authorization')

    const response = await app.request('http://localhost/proxy/ping', {
      headers: {
        Origin: 'https://extensions.shopifycdn.com',
        Authorization: `Bearer ${token}`,
      },
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://extensions.shopifycdn.com')
  })

  test('missing SHOPIFY_API_SECRET fails closed', async ({ assert }) => {
    const previous = process.env.SHOPIFY_API_SECRET
    delete process.env.SHOPIFY_API_SECRET
    try {
      const app = await createProxyRoutes(tmpDir)
      const res = await app.request('http://localhost/ping?shop=test.myshopify.com')
      assert.equal(res.status, 500)
    } finally {
      process.env.SHOPIFY_API_SECRET = previous
    }
  })
})
