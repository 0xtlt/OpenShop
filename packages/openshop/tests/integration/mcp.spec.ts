import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { installations, mcpAuditLogs } from '#db/schema'
import { createServer } from '#server/index'
import { dispatchFlow } from '#engine/dispatch'
import { runFlow } from '#engine/runner'
import { encryptString } from '#server/crypto'
import { createConfig, truncateAll, TEST_SHOP } from './helpers.ts'

const SECRET = process.env.SHOPIFY_API_SECRET!
const SHOP_B = 'mcp-other.myshopify.com'

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
    jti: `jti-${shop}`,
    sid: `sid-${shop}`,
  })).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const logFlow = {
  name: 'log-flow',
  async run({ logger }: any) {
    logger.info({ area: 'mcp' }, 'mcp info')
    logger.warn({ area: 'mcp' }, 'mcp warn')
  },
}

async function createLoggedRun(shop = TEST_SHOP) {
  const config = createConfig({ 'log-flow': logFlow })
  const { runId } = await dispatchFlow({ flowName: 'log-flow', config, shop })
  await runFlow({ runId, flowName: 'log-flow', config, shop })
  await new Promise((resolve) => setTimeout(resolve, 200))
  return runId
}

let app: Awaited<ReturnType<typeof createServer>>

test.group('MCP', (group) => {
  group.setup(async () => {
    const config = createConfig({ 'log-flow': logFlow }, {
      mcp: {
        permissions: {
          custom: {
            'demo:read_status': { label: 'Read demo status' },
          },
        },
        tools: {
          'demo.status': {
            description: 'Read status',
            requiredPermissions: ['demo:read_status'],
            run: () => ({ ok: true }),
          },
        },
        resources: {
          'openshop://demo/status': {
            name: 'Demo status docs',
            requiredPermissions: [],
            read: () => 'demo',
          },
        },
      },
    })
    app = await createServer(() => config)
  })

  group.each.setup(() => truncateAll())

  const adminReq = (path: string, opts: RequestInit = {}, shop = TEST_SHOP) => {
    const headers = new Headers(opts.headers)
    headers.set('Authorization', `Bearer ${createJwt(shop)}`)
    if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    return app.request(path, { ...opts, headers })
  }

  const createToken = async (permissions: string[] = [], body: Record<string, unknown> = {}, shop = TEST_SHOP) => {
    const res = await adminReq('/api/mcp/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'test token', permissions, ...body }),
    }, shop)
    const data = await res.json()
    return { res, data }
  }

  const mcpReq = (token: string, body: Record<string, unknown>) => app.request('/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  test('admin can create a token and only receives the secret once', async ({ assert }) => {
    const { res, data } = await createToken(['read_logs'])
    assert.equal(res.status, 201)
    assert.isString(data.token)
    assert.equal(data.item.permissions[0], 'read_logs')

    const listRes = await adminReq('/api/mcp/tokens')
    const list = await listRes.json()
    assert.lengthOf(list, 1)
    assert.notProperty(list[0], 'token')
    assert.equal(list[0].tokenId, data.item.tokenId)
    assert.equal(new Date(list[0].expiresAt).getTime() > Date.now(), true)
  })

  test('rotating a token keeps its tokenId and invalidates the old secret', async ({ assert }) => {
    const { data } = await createToken(['read_logs'])
    const rotateRes = await adminReq(`/api/mcp/tokens/${data.item.id}/rotate`, { method: 'POST' })
    const rotated = await rotateRes.json()
    assert.equal(rotateRes.status, 200)
    assert.include(rotated.token, data.item.tokenId)

    const oldRes = await mcpReq(data.token, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    assert.equal(oldRes.status, 401)

    const newRes = await mcpReq(rotated.token, { jsonrpc: '2.0', id: 2, method: 'initialize' })
    assert.equal(newRes.status, 200)
  })

  test('revoked tokens cannot be rotated', async ({ assert }) => {
    const { data } = await createToken(['read_logs'])
    await adminReq(`/api/mcp/tokens/${data.item.id}/revoke`, { method: 'POST' })

    const rotateRes = await adminReq(`/api/mcp/tokens/${data.item.id}/rotate`, { method: 'POST' })
    const body = await rotateRes.json()
    assert.equal(rotateRes.status, 409)
    assert.equal(body.error, 'Cannot rotate a revoked token')
  })

  test('revoked tokens cannot be reactivated through patch', async ({ assert }) => {
    const { data } = await createToken(['read_logs'])
    await adminReq(`/api/mcp/tokens/${data.item.id}/revoke`, { method: 'POST' })

    const patchRes = await adminReq(`/api/mcp/tokens/${data.item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active', name: 'reactivated token' }),
    })
    const patchBody = await patchRes.json()
    assert.equal(patchRes.status, 409)
    assert.equal(patchBody.error, 'Cannot update a revoked token')

    const detailRes = await adminReq(`/api/mcp/tokens/${data.item.id}`)
    const detail = await detailRes.json()
    assert.equal(detail.status, 'revoked')
    assert.equal(detail.name, 'test token')
  })

  test('revoked tokens cannot have permissions changed', async ({ assert }) => {
    const { data } = await createToken(['read_logs'])
    await adminReq(`/api/mcp/tokens/${data.item.id}/revoke`, { method: 'POST' })

    const permissionsRes = await adminReq(`/api/mcp/tokens/${data.item.id}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions: ['read_flows'] }),
    })
    const permissionsBody = await permissionsRes.json()
    assert.equal(permissionsRes.status, 409)
    assert.equal(permissionsBody.error, 'Cannot update a revoked token')

    const detailRes = await adminReq(`/api/mcp/tokens/${data.item.id}`)
    const detail = await detailRes.json()
    assert.deepEqual(detail.permissions, ['read_logs'])
  })

  test('admin token API rejects invalid explicit expiration values', async ({ assert }) => {
    const createRes = await adminReq('/api/mcp/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'bad expiry', expiresAt: 'not-a-date' }),
    })
    const createBody = await createRes.json()
    assert.equal(createRes.status, 400)
    assert.equal(createBody.error, 'expiresAt must be a valid date string or null')

    const { data } = await createToken()
    const patchRes = await adminReq(`/api/mcp/tokens/${data.item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ expiresInDays: 0 }),
    })
    const patchBody = await patchRes.json()
    assert.equal(patchRes.status, 400)
    assert.equal(patchBody.error, 'expiresInDays must be a positive integer or null')
  })

  test('MCP rejects missing and invalid bearer tokens', async ({ assert }) => {
    const missing = await app.request('/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    assert.equal(missing.status, 401)

    const { data } = await createToken()
    const invalid = await mcpReq(`${data.token}x`, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    assert.equal(invalid.status, 401)
  })

  test('MCP rejects expired and revoked tokens', async ({ assert }) => {
    const expired = await createToken([], { expiresAt: new Date(Date.now() - 60_000).toISOString() })
    const expiredRes = await mcpReq(expired.data.token, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    assert.equal(expiredRes.status, 403)

    const active = await createToken([])
    await adminReq(`/api/mcp/tokens/${active.data.item.id}/revoke`, { method: 'POST' })
    const revokedRes = await mcpReq(active.data.token, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    assert.equal(revokedRes.status, 403)
  })

  test('tools/list only returns tools allowed by granted permissions', async ({ assert }) => {
    const { data } = await createToken(['read_logs'])
    const res = await mcpReq(data.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    assert.equal(res.status, 200)
    const body = await res.json()
    const names = body.result.tools.map((tool: any) => tool.name)
    assert.include(names, 'openshop.shops.list')
    assert.include(names, 'openshop.logs.search')
    assert.notInclude(names, 'openshop.admin.graphql')
    assert.notInclude(names, 'demo.status')
  })

  test('openshop.shops.list is available without grants and lists active installations for the token app', async ({ assert }) => {
    await getDb().insert(installations).values([
      { appHandle: 'default', shop: TEST_SHOP, accessToken: encryptString('token-a'), scopes: 'read_products' },
      { appHandle: 'default', shop: SHOP_B, accessToken: encryptString('token-b'), scopes: 'read_orders' },
      { appHandle: 'default', shop: 'uninstalled.myshopify.com', accessToken: encryptString('token-c'), uninstalledAt: new Date() },
      { appHandle: 'other', shop: 'hidden.myshopify.com', accessToken: encryptString('token-d') },
    ])
    const { data } = await createToken([])
    const res = await mcpReq(data.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'openshop.shops.list', arguments: {} },
    })
    const body = await res.json()
    const shops = body.result.structuredContent.shops.map((shop: any) => shop.shop)
    assert.deepEqual(shops, [SHOP_B, TEST_SHOP])
  })

  test('openshop.admin.graphql requires its explicit permission', async ({ assert }) => {
    const { data } = await createToken([])
    const res = await mcpReq(data.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'openshop.admin.graphql',
        arguments: { shop: TEST_SHOP, apiVersion: '2026-04', query: 'query { shop { name } }' },
      },
    })
    const body = await res.json()
    assert.equal(body.error.code, -32003)
  })

  test('openshop.admin.graphql defaults omitted API version to the latest stable version', async ({ assert }) => {
    await getDb().insert(installations).values({
      appHandle: 'default',
      shop: TEST_SHOP,
      accessToken: encryptString('offline-admin-token'),
      scopes: 'read_products',
    })
    const { data } = await createToken(['shopify_admin_graphql'])
    const originalFetch = globalThis.fetch
    let requestedVersion: string | null = null
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const match = url.match(new RegExp(`^https://${TEST_SHOP}/admin/api/(\\d{4}-\\d{2})/graphql\\.json$`))
      if (match) {
        requestedVersion = match[1]!
        assert.equal((init?.headers as Record<string, string>)['X-Shopify-Access-Token'], 'offline-admin-token')
        return Response.json({ data: { shop: { name: 'Latest Shop' } } })
      }
      return originalFetch(input, init)
    }

    try {
      const res = await mcpReq(data.token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'openshop.admin.graphql',
          arguments: { shop: TEST_SHOP, query: 'query { shop { name } }' },
        },
      })
      const body = await res.json()
      assert.equal(res.status, 200)
      assert.equal(body.result.structuredContent.apiVersion, requestedVersion)
      assert.match(body.result.structuredContent.apiVersion, /^\d{4}-\d{2}$/)
      assert.equal(body.result.structuredContent.data.shop.name, 'Latest Shop')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('openshop.admin.graphql runs against an installed shop, returns raw Shopify JSON, and audits the target shop', async ({ assert }) => {
    await getDb().insert(installations).values({
      appHandle: 'default',
      shop: SHOP_B,
      accessToken: encryptString('offline-admin-token'),
      scopes: 'read_products,write_products',
    })
    const { data } = await createToken(['shopify_admin_graphql'])
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `https://${SHOP_B}/admin/api/2026-04/graphql.json`) {
        assert.equal((init?.headers as Record<string, string>)['X-Shopify-Access-Token'], 'offline-admin-token')
        const body = JSON.parse(String(init?.body))
        assert.equal(body.query, 'query { shop { name } }')
        return Response.json({
          data: { shop: { name: 'Integration Shop' } },
          extensions: { cost: { requestedQueryCost: 1 } },
        })
      }
      return originalFetch(input, init)
    }

    try {
      const res = await mcpReq(data.token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'openshop.admin.graphql',
          arguments: { shop: SHOP_B, apiVersion: '2026-04', query: 'query { shop { name } }' },
        },
      })
      const body = await res.json()
      assert.equal(res.status, 200)
      assert.equal(body.result.structuredContent.status, 200)
      assert.isTrue(body.result.structuredContent.ok)
      assert.equal(body.result.structuredContent.data.shop.name, 'Integration Shop')
      assert.equal(body.result.structuredContent.extensions.cost.requestedQueryCost, 1)

      const audits = await getDb().select().from(mcpAuditLogs).where(eq(mcpAuditLogs.tokenId, data.item.tokenId))
      assert.lengthOf(audits, 1)
      assert.equal(audits[0].shop, TEST_SHOP)
      assert.equal(audits[0].targetShop, SHOP_B)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('tools/call denies missing permissions and writes audit', async ({ assert }) => {
    const runId = await createLoggedRun()
    const { data } = await createToken([])
    const res = await mcpReq(data.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'openshop.logs.search', arguments: { runId } },
    })
    const body = await res.json()
    assert.equal(body.error.code, -32003)

    const audits = await getDb().select().from(mcpAuditLogs).where(eq(mcpAuditLogs.tokenId, data.item.tokenId))
    assert.lengthOf(audits, 1)
    assert.equal(audits[0].status, 'denied')
  })

  test('tools/call validates arguments before running a tool', async ({ assert }) => {
    const { data } = await createToken(['read_logs'])
    const res = await mcpReq(data.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'openshop.logs.search', arguments: { runId: 123 } },
    })
    const body = await res.json()
    assert.equal(body.error.code, -32602)
    assert.include(body.error.message, 'arguments.runId must be string')
  })

  test('MCP rejects oversized request bodies without relying on Content-Length', async ({ assert }) => {
    const { data } = await createToken(['read_logs'])
    const largeBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      padding: 'x'.repeat(1_010_000),
    })

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' },
      body: largeBody,
    })
    assert.equal(res.status, 413)
  })

  test('openshop.logs.search returns logs for the token shop and writes audit', async ({ assert }) => {
    const runId = await createLoggedRun()
    const { data } = await createToken(['read_logs'])
    const res = await mcpReq(data.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'openshop.logs.search', arguments: { runId, q: 'warn', limit: 10 } },
    })
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.property(body.result, 'content')
    assert.include(body.result.content[0].text, 'mcp warn')

    const audits = await getDb().select().from(mcpAuditLogs).where(eq(mcpAuditLogs.tokenId, data.item.tokenId))
    assert.lengthOf(audits, 1)
    assert.equal(audits[0].status, 'success')
  })

  test('MCP token cannot read another shop run logs', async ({ assert }) => {
    const otherRunId = await createLoggedRun(SHOP_B)
    const { data } = await createToken(['read_logs'], {}, TEST_SHOP)
    const res = await mcpReq(data.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'openshop.logs.search', arguments: { runId: otherRunId } },
    })
    const body = await res.json()
    assert.equal(body.error.code, -32000)
    assert.include(body.error.message, 'Run not found')
  })

  test('admin token list is isolated by shop', async ({ assert }) => {
    const shopBToken = await createToken(['read_logs'], {}, SHOP_B)
    const shopAListRes = await adminReq('/api/mcp/tokens', {}, TEST_SHOP)
    const shopAList = await shopAListRes.json()
    assert.isFalse(shopAList.some((token: any) => token.tokenId === shopBToken.data.item.tokenId))

    const shopBListRes = await adminReq('/api/mcp/tokens', {}, SHOP_B)
    const shopBList = await shopBListRes.json()
    assert.isTrue(shopBList.some((token: any) => token.tokenId === shopBToken.data.item.tokenId))
  })

  test('resources/list and resources/read expose documentation resources', async ({ assert }) => {
    const { data } = await createToken(['read_logs'])
    const listRes = await mcpReq(data.token, { jsonrpc: '2.0', id: 1, method: 'resources/list' })
    const list = await listRes.json()
    const uris = list.result.resources.map((resource: any) => resource.uri)
    assert.include(uris, 'openshop://docs/log-search')

    const readRes = await mcpReq(data.token, {
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/read',
      params: { uri: 'openshop://docs/log-search' },
    })
    const read = await readRes.json()
    assert.include(read.result.contents[0].text, 'openshop.logs.search')
  })
})
