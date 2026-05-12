import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProxyRoutes } from '#server/proxy'

const secret = process.env.SHOPIFY_API_SECRET!
const apiKey = process.env.SHOPIFY_API_KEY!

function signProxyQuery(params: Record<string, string>): Record<string, string> {
  const sorted = Object.keys(params)
    .filter((k) => k !== 'signature')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('')
  const signature = createHmac('sha256', secret).update(sorted).digest('hex')
  return { ...params, signature }
}

function queryString(q: Record<string, string>): string {
  return new URLSearchParams(q).toString()
}

function createJwt(shop: string, sub = 'gid://shopify/Customer/123', aud = apiKey, expOffsetSeconds = 3600): string {
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
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const proxyHandlerFile = `
export default {
  GET: async ({ shop, customerId, auth, query }) => ({
    pong: true,
    from: 'proxy-spec',
    shop,
    customerId,
    authKind: auth.kind,
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
    assert.equal(data.queryShop, 'test.myshopify.com')
    assert.equal(data.queryCustomerId, '42')
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
    assert.equal(data.queryShop, 'jwt-shop.myshopify.com')
    assert.equal(data.queryCustomerId, '123')
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
