import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { flowRuns } from '#db/schema'
import { createServer } from '#server/index'
import { dispatchFlow } from '#engine/dispatch'
import { runFlow } from '#engine/runner'
import { truncateAll, createConfig, TEST_SHOP } from './helpers.js'

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

let app: Awaited<ReturnType<typeof createServer>>

test.group('API routes', (group) => {
  group.setup(async () => {
    const config = createConfig({ 'test-flow': simpleFlow })
    config.crons = [{ name: 'Test cron', schedule: '*/5 * * * *', flow: 'test-flow' }]
    app = await createServer(() => config)
  })

  group.each.setup(() => truncateAll())

  const req = (path: string, opts: RequestInit = {}) => {
    const headers = new Headers(opts.headers)
    headers.set('Authorization', `Bearer ${createJwt()}`)
    if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    return app.request(path, { ...opts, headers })
  }

  // ─── Flows

  test('GET /api/flows returns flow list', async ({ assert }) => {
    const res = await req('/api/flows')
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.isArray(data)
    assert.equal(data[0].name, 'test-flow')
    assert.property(data[0], 'inputSchema')
  })

  // ─── Crons

  test('GET /api/crons returns cron list', async ({ assert }) => {
    const res = await req('/api/crons')
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.isArray(data)
    assert.equal(data[0].flow, 'test-flow')
    assert.equal(data[0].name, 'Test cron')
    assert.isTrue(data[0].enabled)
  })

  test('POST /api/crons/toggle disables a cron', async ({ assert }) => {
    const res = await req('/api/crons/toggle', {
      method: 'POST',
      body: JSON.stringify({ key: 'test-flow:*/5 * * * *', enabled: false }),
    })
    assert.equal(res.status, 200)

    const listRes = await req('/api/crons')
    const data = await listRes.json()
    assert.isFalse(data[0].enabled)
  })

  // ─── Runs

  test('GET /api/runs returns all runs', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })

    const res = await req('/api/runs?limit=10')
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.isArray(data)
    assert.isAbove(data.length, 0)
  })

  test('GET /api/runs supports search', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })

    const res = await req('/api/runs?search=test-flow')
    const data = await res.json()
    assert.isAbove(data.length, 0)

    const noRes = await req('/api/runs?search=nonexistent')
    const noData = await noRes.json()
    assert.equal(noData.length, 0)
  })

  test('GET /api/flows/:name/runs returns filtered runs', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })

    const res = await req('/api/flows/test-flow/runs?limit=10')
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.isAbove(data.length, 0)
    assert.equal(data[0].flowName, 'test-flow')
  })

  // ─── Run detail

  test('GET /runs/:id returns run with steps', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const { runId } = await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })
    await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP })

    const res = await req(`/api/runs/${runId}`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.id, runId)
    assert.equal(data.status, 'completed')
    assert.isArray(data.steps)
  })

  test('GET /runs/:id returns 404 for unknown', async ({ assert }) => {
    const res = await req('/api/runs/00000000-0000-0000-0000-000000000000')
    assert.equal(res.status, 404)
  })

  // ─── Trigger flow

  test('POST /api/flows/:name/run triggers a flow', async ({ assert }) => {
    const res = await req('/api/flows/test-flow/run', {
      method: 'POST',
      body: JSON.stringify({ input: {} }),
    })
    assert.oneOf(res.status, [200, 202])
    const data = await res.json()
    assert.isString(data.runId)
  })

  test('POST /api/flows/:name/run rejects unknown flow', async ({ assert }) => {
    const res = await req('/api/flows/nope/run', {
      method: 'POST',
      body: JSON.stringify({ input: {} }),
    })
    assert.oneOf(res.status, [400, 500])
  })

  // ─── Cancel & Retry

  test('POST /runs/:id/cancel cancels a pending run', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const { runId } = await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })

    const res = await req(`/api/runs/${runId}/cancel`, { method: 'POST' })
    assert.equal(res.status, 200)

    const db = getDb()
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    assert.equal(run.status, 'canceled')
  })

  test('POST /runs/:id/retry retries a failed run', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const { runId } = await dispatchFlow({
      flowName: 'test-flow', config, shop: TEST_SHOP,
      options: { retryPolicy: { maxAttempts: 0 } },
    })
    await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP, input: {} })

    // Manually set to failed so we can retry
    const db = getDb()
    await db.update(flowRuns).set({ status: 'failed' }).where(eq(flowRuns.id, runId))

    const res = await req(`/api/runs/${runId}/retry`, { method: 'POST' })
    assert.equal(res.status, 200)

    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    assert.equal(run.status, 'pending')
  })

  // ─── Auth

  test('request without token returns 401', async ({ assert }) => {
    const res = await app.request('/api/flows')
    assert.equal(res.status, 401)
  })

  test('request with invalid token returns 401', async ({ assert }) => {
    const res = await app.request('/api/flows', {
      headers: { Authorization: 'Bearer invalid.token.here' },
    })
    assert.equal(res.status, 401)
  })

  // ─── Logs

  test('GET /runs/:id/logs returns logs with filters', async ({ assert }) => {
    const config = createConfig({
      'test-flow': {
        name: 'test-flow',
        async run({ logger }: any) {
          logger.info({ key: 'val' }, 'info message')
          logger.warn({}, 'warn message')
          logger.error({}, 'error message')
        },
      },
    })
    const { runId } = await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })
    await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP })
    await new Promise((r) => setTimeout(r, 200)) // wait for async log inserts

    // All logs
    const res = await req(`/api/runs/${runId}/logs?levels=info,warn,error`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.isAbove(data.total, 0)
    assert.isArray(data.logs)

    // Filter by query
    const filtered = await req(`/api/runs/${runId}/logs?levels=info,warn,error&q=warn`)
    const fData = await filtered.json()
    const matched = fData.logs.filter((l: any) => l._matched)
    assert.isAbove(matched.length, 0)
  })

  test('GET /runs/:id/logs/export returns JSON', async ({ assert }) => {
    const config = createConfig({
      'test-flow': {
        name: 'test-flow',
        async run({ logger }: any) { logger.info({}, 'export test') },
      },
    })
    const { runId } = await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })
    await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP })
    await new Promise((r) => setTimeout(r, 200))

    const res = await req(`/api/runs/${runId}/logs/export?format=json&levels=info,warn,error`)
    assert.equal(res.status, 200)
    const ct = res.headers.get('content-type') ?? ''
    assert.include(ct, 'json')
  })

  test('GET /runs/:id/logs/export returns CSV', async ({ assert }) => {
    const config = createConfig({
      'test-flow': {
        name: 'test-flow',
        async run({ logger }: any) { logger.info({}, 'csv test') },
      },
    })
    const { runId } = await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })
    await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP })
    await new Promise((r) => setTimeout(r, 200))

    const res = await req(`/api/runs/${runId}/logs/export?format=csv&levels=info,warn,error`)
    assert.equal(res.status, 200)
    const text = await res.text()
    assert.include(text, 'level,message')
  })

  // ─── Providers

  test('GET /api/providers returns provider list', async ({ assert }) => {
    const res = await req('/api/providers')
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.isArray(data)
  })

  // ─── Health

  test('GET /health returns ok', async ({ assert }) => {
    const res = await app.request('/health')
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.status, 'ok')
  })
})

test.group('API Shopify functions list', (group) => {
  let fnApp: Awaited<ReturnType<typeof createServer>>

  group.setup(async () => {
    const config = createConfig({ 'test-flow': simpleFlow }, {
      functions: {
        testFn: {
          type: 'cart-transform',
          handle: 'test-fn',
          config: {
            note: { type: 'text', label: 'Note' },
          },
        },
      },
    })
    fnApp = await createServer(() => config)
  })

  group.each.setup(() => truncateAll())

  test('GET /api/functions returns definitions without calling Shopify', async ({ assert }) => {
    const res = await fnApp.request('/api/functions', {
      headers: { Authorization: `Bearer ${createJwt()}` },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.isArray(data)
    assert.equal(data.length, 1)
    assert.equal(data[0].handle, 'test-fn')
    assert.equal(data[0].type, 'cart-transform')
    assert.isFalse(data[0].supportsUpdate)
    assert.property(data[0].fields, 'note')
    assert.equal(data[0].fields.note.label, 'Note')
  })
})
