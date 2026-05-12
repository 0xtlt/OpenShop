import { test } from '@japa/runner'
import { eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { flowRuns } from '#db/schema'
import { dispatchFlow } from '#engine/dispatch'
import { truncateAll, createConfig, TEST_SHOP } from '../helpers.js'

const simpleFlow = {
  name: 'test-flow',
  async run() {},
}

const flowWithTimeout = {
  name: 'timeout-flow',
  timeout: 30_000,
  async run() {},
}

const allowConcurrency = {
  name: 'concurrent-flow',
  concurrency: 'allow' as const,
  async run() {},
}

test.group('dispatch', (group) => {
  group.each.setup(() => truncateAll())

  test('creates a pending flow run', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const { runId, status } = await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })

    assert.isString(runId)
    assert.equal(status, 'pending')

    const db = getDb()
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    assert.equal(run.status, 'pending')
    assert.equal(run.flowName, 'test-flow')
    assert.equal(run.shop, TEST_SHOP)
  })

  test('throws on unknown flow', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    await assert.rejects(
      () => dispatchFlow({ flowName: 'unknown', config, shop: TEST_SHOP }),
      /not found/,
    )
  })

  test('concurrency reject throws when flow already running', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })

    try {
      await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })
      assert.fail('Should have thrown')
    } catch (err) {
      assert.equal((err as Error).name, 'FlowConcurrencyError')
    }
  })

  test('concurrency allow permits multiple runs', async ({ assert }) => {
    const config = createConfig({ 'concurrent-flow': allowConcurrency })
    const a = await dispatchFlow({ flowName: 'concurrent-flow', config, shop: TEST_SHOP })
    const b = await dispatchFlow({ flowName: 'concurrent-flow', config, shop: TEST_SHOP })

    assert.notEqual(a.runId, b.runId)
  })

  test('sets deadlineAt from flow timeout', async ({ assert }) => {
    const config = createConfig({ 'timeout-flow': flowWithTimeout })
    const { runId } = await dispatchFlow({ flowName: 'timeout-flow', config, shop: TEST_SHOP })

    const db = getDb()
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    assert.isNotNull(run.deadlineAt)
  })

  test('stores retry policy', async ({ assert }) => {
    const config = createConfig({ 'test-flow': { ...simpleFlow, retryPolicy: { maxAttempts: 5 } } })
    const { runId } = await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })

    const db = getDb()
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    const policy = run.retryPolicy as Record<string, unknown>
    assert.equal(policy.maxAttempts, 5)
  })

  test('delayed dispatch sets future availableAt', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const before = Date.now()
    const { runId } = await dispatchFlow({
      flowName: 'test-flow', config, shop: TEST_SHOP,
      options: { delayMs: 10_000 },
    })

    const db = getDb()
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    assert.isAbove(run.availableAt!.getTime(), before + 5_000)
  })
})
