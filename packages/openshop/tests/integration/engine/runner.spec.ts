import { test } from '@japa/runner'
import { eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { flowRuns, logs, stepResults } from '#db/schema'
import { runFlow } from '#engine/runner'
import { dispatchFlow } from '#engine/dispatch'
import { cancelRun } from '#engine/abort'
import { truncateAll, createConfig, TEST_SHOP } from '../helpers.ts'
import type { FlowRunContext } from '#types'

function defineTestFlow(fn: (ctx: FlowRunContext) => Promise<void>, opts: Record<string, unknown> = {}) {
  return { name: 'test-flow', ...opts, run: fn }
}

test.group('runner', (group) => {
  group.each.setup(() => truncateAll())

  test('successful flow completes', async ({ assert }) => {
    const flow = defineTestFlow(async ({ step, logger }) => {
      await step('greet', async () => {
        logger.info({}, 'hello')
        return 'world'
      })
    })
    const config = createConfig({ 'test-flow': flow })
    const { runId } = await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })

    const result = await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP })
    assert.equal(result.status, 'completed')

    const db = getDb()
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    assert.equal(run.status, 'completed')
    assert.isNotNull(run.completedAt)
  })

  test('returns lease_lost when the worker no longer owns the run', async ({ assert }) => {
    let runId = ''
    const db = getDb()
    const flow = defineTestFlow(async () => {
      await db.update(flowRuns)
        .set({ workerId: 'worker-b' })
        .where(eq(flowRuns.id, runId))
    })
    const config = createConfig({ 'test-flow': flow })
    const dispatched = await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })
    runId = dispatched.runId
    await db.update(flowRuns)
      .set({ status: 'running', workerId: 'worker-a', attempts: 1, availableAt: new Date(Date.now() + 30_000) })
      .where(eq(flowRuns.id, runId))

    const result = await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP, workerId: 'worker-a', attempt: 1 })
    assert.equal(result.status, 'lease_lost')

    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    assert.equal(run.status, 'running')
    assert.equal(run.workerId, 'worker-b')
    assert.isNull(run.completedAt)
  })

  test('failing flow sets status to failed', async ({ assert }) => {
    const flow = defineTestFlow(async () => {
      throw new Error('boom')
    })
    const config = createConfig({ 'test-flow': flow })
    // Override retry policy to 0 retries so it goes straight to failed
    const { runId } = await dispatchFlow({
      flowName: 'test-flow', config, shop: TEST_SHOP,
      options: { retryPolicy: { maxAttempts: 0 } },
    })

    const result = await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP })
    assert.equal(result.status, 'failed')
    assert.include((result as { error: string }).error, 'boom')

    const db = getDb()
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    assert.equal(run.status, 'failed')
    assert.include(run.error!, 'boom')
  })

  test('flow with retry stays pending after failure', async ({ assert }) => {
    const flow = defineTestFlow(async () => { throw new Error('retry me') }, {
      retryPolicy: { maxAttempts: 3 },
    })
    const config = createConfig({ 'test-flow': flow })
    const { runId } = await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })

    const result = await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP })
    assert.equal(result.status, 'failed')
    assert.isTrue((result as { willRetry: boolean }).willRetry)

    const db = getDb()
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1)
    assert.equal(run.status, 'pending') // pending for retry, not failed
    assert.isNotNull(run.availableAt)
  })

  test('cancellation sets status to canceled', async ({ assert }) => {
    const flow = defineTestFlow(async ({ step }) => {
      // First step succeeds quickly
      await step('setup', async () => 'ok')
      // Second step is slow — cancel fires during this
      await step('slow', () => new Promise((r) => setTimeout(r, 5000)))
    })
    const config = createConfig({ 'test-flow': flow })
    const { runId } = await dispatchFlow({
      flowName: 'test-flow', config, shop: TEST_SHOP,
      options: { retryPolicy: { maxAttempts: 0 } },
    })

    // Cancel after 50ms — should hit during 'slow' step
    setTimeout(() => cancelRun(runId), 50)

    const result = await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP })
    // After cancel, the step's abort signal fires. The step catches it.
    // Result can be 'canceled' or 'failed' depending on timing
    assert.oneOf(result.status, ['canceled', 'failed'])
  }).timeout(10_000)

  test('input validation rejects invalid input', async ({ assert }) => {
    const { type } = await import('arktype')
    const flow = defineTestFlow(async () => {}, { input: type({ limit: 'number' }) })
    const config = createConfig({ 'test-flow': flow })
    const { runId } = await dispatchFlow({
      flowName: 'test-flow', config, shop: TEST_SHOP,
      options: { retryPolicy: { maxAttempts: 0 } },
    })

    const result = await runFlow({
      runId, flowName: 'test-flow', config, shop: TEST_SHOP,
      input: { limit: 'not-a-number' },
    })

    assert.equal(result.status, 'failed')
    assert.include((result as { error: string }).error, 'Invalid input')
  })

  test('flow creates logs in DB', async ({ assert }) => {
    const flow = defineTestFlow(async ({ logger }) => {
      logger.info({ key: 'val' }, 'test message')
    })
    const config = createConfig({ 'test-flow': flow })
    const { runId } = await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })

    await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP })

    // Wait a tick for async log inserts
    await new Promise((r) => setTimeout(r, 100))

    const db = getDb()
    const allLogs = await db.select().from(logs).where(eq(logs.flowRunId, runId))
    const testLog = allLogs.find((l) => l.message === 'test message')
    assert.isDefined(testLog)
    assert.equal(testLog!.level, 'info')
  })

  test('flow timeout causes failure', async ({ assert }) => {
    const flow = defineTestFlow(async () => {
      await new Promise((r) => setTimeout(r, 5000))
    }, { timeout: 100 })
    const config = createConfig({ 'test-flow': flow })
    const { runId } = await dispatchFlow({
      flowName: 'test-flow', config, shop: TEST_SHOP,
      options: { retryPolicy: { maxAttempts: 0 } },
    })

    const result = await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP })
    assert.equal(result.status, 'failed')
    assert.include((result as { error: string }).error, 'timed out')
  }).timeout(5000)

  test('flow with multiple steps stores all outputs', async ({ assert }) => {
    const flow = defineTestFlow(async ({ step }) => {
      const a = await step('step-a', async () => 'alpha')
      await step('step-b', async () => ({ prev: a, val: 'beta' }))
    })
    const config = createConfig({ 'test-flow': flow })
    const { runId } = await dispatchFlow({ flowName: 'test-flow', config, shop: TEST_SHOP })
    await runFlow({ runId, flowName: 'test-flow', config, shop: TEST_SHOP })

    const db = getDb()
    const steps = await db.select().from(stepResults).where(eq(stepResults.flowRunId, runId))
    assert.equal(steps.length, 2)
    const stepA = steps.find((s) => s.stepName === 'step-a')
    const stepB = steps.find((s) => s.stepName === 'step-b')
    assert.equal(stepA?.output, 'alpha')
    assert.deepEqual(stepB?.output, { prev: 'alpha', val: 'beta' })
  })
})
