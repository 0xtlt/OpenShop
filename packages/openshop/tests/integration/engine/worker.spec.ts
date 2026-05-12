import { test } from '@japa/runner'
import { eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { flowRuns } from '#db/schema'
import { Worker } from '#engine/worker'
import { dispatchFlow } from '#engine/dispatch'
import { truncateAll, createConfig, TEST_SHOP } from '../helpers.js'

const quickFlow = {
  name: 'quick-flow',
  async run() {},
}

const slowFlow = {
  name: 'slow-flow',
  async run() {
    await new Promise((r) => setTimeout(r, 200))
  },
}

const failFlow = {
  name: 'fail-flow',
  async run() { throw new Error('worker-fail') },
}

test.group('worker', (group) => {
  group.each.setup(() => truncateAll())

  test('picks up and completes a pending run', async ({ assert }) => {
    const config = createConfig({ 'quick-flow': quickFlow })
    const { runId } = await dispatchFlow({ flowName: 'quick-flow', config, shop: TEST_SHOP })

    const worker = new Worker(config, { pollIntervalMs: 100, concurrency: 1 })
    await worker.start()
    await new Promise((r) => setTimeout(r, 1500))
    await worker.stop()

    const db = getDb()
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    assert.equal(run.status, 'completed')
  }).timeout(10_000)

  test('handles failing flow gracefully', async ({ assert }) => {
    const config = createConfig({ 'fail-flow': failFlow })
    const { runId } = await dispatchFlow({
      flowName: 'fail-flow', config, shop: TEST_SHOP,
      options: { retryPolicy: { maxAttempts: 0 } },
    })

    const worker = new Worker(config, { pollIntervalMs: 100, concurrency: 1 })
    await worker.start()
    await new Promise((r) => setTimeout(r, 1500))
    await worker.stop()

    const db = getDb()
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    assert.equal(run.status, 'failed')
    assert.include(run.error!, 'worker-fail')
  }).timeout(10_000)

  test('processes multiple runs concurrently', async ({ assert }) => {
    const config = createConfig({ 'slow-flow': { ...slowFlow, concurrency: 'allow' as const } })
    const a = await dispatchFlow({ flowName: 'slow-flow', config, shop: TEST_SHOP })
    const b = await dispatchFlow({ flowName: 'slow-flow', config, shop: TEST_SHOP })

    const worker = new Worker(config, { pollIntervalMs: 100, concurrency: 5 })
    await worker.start()
    await new Promise((r) => setTimeout(r, 2000))
    await worker.stop()

    const db = getDb()
    const [runA] = await db.select().from(flowRuns).where(eq(flowRuns.id, a.runId)).limit(1)
    const [runB] = await db.select().from(flowRuns).where(eq(flowRuns.id, b.runId)).limit(1)
    assert.equal(runA.status, 'completed')
    assert.equal(runB.status, 'completed')
  }).timeout(10_000)

  test('graceful stop waits for active runs', async ({ assert }) => {
    const config = createConfig({ 'slow-flow': slowFlow })
    await dispatchFlow({ flowName: 'slow-flow', config, shop: TEST_SHOP })

    const worker = new Worker(config, { pollIntervalMs: 100, concurrency: 1 })
    await worker.start()
    await new Promise((r) => setTimeout(r, 300)) // let it claim the run
    await worker.stop() // should wait for completion

    assert.isFalse(worker.isRunning)
    assert.equal(worker.activeCount, 0)
  }).timeout(10_000)

  test('handles unregistered flow name', async ({ assert }) => {
    const config = createConfig({ 'quick-flow': quickFlow })
    // Dispatch with full config, then remove the flow from worker config
    const { runId } = await dispatchFlow({ flowName: 'quick-flow', config, shop: TEST_SHOP })

    const emptyConfig = createConfig({})
    const worker = new Worker(emptyConfig, { pollIntervalMs: 100, concurrency: 1 })
    await worker.start()
    await new Promise((r) => setTimeout(r, 1500))
    await worker.stop()

    const db = getDb()
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    assert.equal(run.status, 'failed')
    assert.include(run.error!, 'not registered')
  }).timeout(10_000)
})
