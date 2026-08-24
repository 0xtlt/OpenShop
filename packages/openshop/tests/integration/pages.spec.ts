import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { getDb } from '#db/client'
import { mcpTokens } from '#db/schema'
import { createMcpToken } from '#server/mcp/tokens'
import { createServer } from '#server/index'
import { createConfig, truncateAll, TEST_SHOP } from './helpers.ts'

const SECRET = process.env.SHOPIFY_API_SECRET!

function createJwt(shop = TEST_SHOP): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: 'test-app',
    sub: '123',
    exp: now + 3600,
    nbf: now - 10,
    iat: now,
    jti: 'jti-test',
    sid: 'sid-test',
  })).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const simpleFlow = {
  name: 'test-flow',
  async run() {},
}

test.group('Admin page visibility', (group) => {
  group.each.setup(() => truncateAll())

  const req = (app: Awaited<ReturnType<typeof createServer>>, path: string) => {
    return app.request(path, {
      headers: { Authorization: `Bearer ${createJwt()}` },
    })
  }

  test('GET /api/pages returns visible defaults', async ({ assert }) => {
    const app = await createServer(() => createConfig({ 'test-flow': simpleFlow }))
    const res = await req(app, '/api/pages')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      flows: 'visible',
      providers: 'visible',
      crons: 'visible',
      functions: 'visible',
      mcp: 'visible',
    })
  })

  test('GET /api/pages requires an authenticated Shopify session', async ({ assert }) => {
    const app = await createServer(() => createConfig({ 'test-flow': simpleFlow }))
    const res = await app.request('/api/pages')
    assert.equal(res.status, 401)
  })

  test('hidden pages remain reachable on the admin API', async ({ assert }) => {
    const app = await createServer(() => createConfig({ 'test-flow': simpleFlow }, {
      pages: { functions: 'hidden', mcp: 'hidden' },
    }))

    const pages = await req(app, '/api/pages')
    assert.equal(pages.status, 200)
    assert.deepEqual(await pages.json(), {
      flows: 'visible',
      providers: 'visible',
      crons: 'visible',
      functions: 'hidden',
      mcp: 'hidden',
    })

    assert.equal((await req(app, '/api/functions')).status, 200)
    assert.equal((await req(app, '/api/mcp/capabilities')).status, 200)
    assert.equal((await req(app, '/api/flows')).status, 200)
  })

  test('disabled pages return 404 on their admin API group', async ({ assert }) => {
    const app = await createServer(() => createConfig({ 'test-flow': simpleFlow }, {
      pages: {
        flows: 'disabled',
        functions: 'disabled',
        mcp: 'disabled',
      },
    }))

    const pages = await req(app, '/api/pages')
    assert.equal(pages.status, 200)
    assert.equal((await pages.json()).flows, 'disabled')

    assert.equal((await req(app, '/api/flows')).status, 404)
    assert.equal((await req(app, '/api/flows/test-flow/runs')).status, 404)
    assert.equal((await req(app, '/api/runs?limit=10')).status, 404)
    assert.equal((await req(app, '/api/functions')).status, 404)
    assert.equal((await req(app, '/api/mcp/capabilities')).status, 404)

    assert.equal((await req(app, '/api/providers')).status, 200)
    assert.equal((await req(app, '/api/crons')).status, 200)
  })

  test('disabling the MCP admin page does not disable the MCP protocol', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow }, {
      pages: { mcp: 'disabled' },
    })
    const app = await createServer(() => config)
    const generated = createMcpToken()

    await getDb().insert(mcpTokens).values({
      appHandle: 'default',
      shop: TEST_SHOP,
      name: 'protocol-only token',
      tokenId: generated.tokenId,
      tokenHash: generated.tokenHash,
      tokenFingerprint: generated.tokenFingerprint,
    })

    assert.equal((await req(app, '/api/mcp/capabilities')).status, 404)

    const protocol = await app.request('/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${generated.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    assert.equal(protocol.status, 200)
  })

  test('mcp.enabled false rejects MCP protocol requests', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow }, {
      mcp: { enabled: false },
    })
    const app = await createServer(() => config)
    const generated = createMcpToken()

    await getDb().insert(mcpTokens).values({
      appHandle: 'default',
      shop: TEST_SHOP,
      name: 'disabled protocol token',
      tokenId: generated.tokenId,
      tokenHash: generated.tokenHash,
      tokenFingerprint: generated.tokenFingerprint,
    })

    const protocol = await app.request('/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${generated.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    assert.equal(protocol.status, 403)
    assert.deepEqual(await protocol.json(), { error: 'MCP is disabled' })
  })
})
