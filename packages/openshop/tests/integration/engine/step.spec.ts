import { test } from '@japa/runner'
import { eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { flowRuns, stepResults } from '#db/schema'
import { createStepExecutor } from '#engine/step'
// Error names checked via string comparison
import { truncateAll, TEST_SHOP } from '../helpers.ts'

const noopLogger = {
  info(_payload: Record<string, unknown>, _message?: string) {},
}

async function createRun(flowName = 'test-flow') {
  const db = getDb()
  const [run] = await db.insert(flowRuns).values({
    shop: TEST_SHOP,
    flowName,
    status: 'running',
  }).returning({ id: flowRuns.id })
  return run.id
}

test.group('step executor', (group) => {
  group.each.setup(() => truncateAll())

  test('executes step and stores result in DB', async ({ assert }) => {
    const db = getDb()
    const runId = await createRun()
    const step = createStepExecutor(db, runId, noopLogger)

    const result = await step('fetch-data', async () => ({ items: [1, 2, 3] }))

    assert.deepEqual(result, { items: [1, 2, 3] })

    const [stored] = await db.select()
      .from(stepResults)
      .where(eq(stepResults.flowRunId, runId))
      .limit(1)

    assert.equal(stored.stepName, 'fetch-data')
    assert.equal(stored.status, 'completed')
    assert.deepEqual(stored.output, { items: [1, 2, 3] })
    assert.isNotNull(stored.durationMs)
  })

  test('deterministic replay returns cached output', async ({ assert }) => {
    const db = getDb()
    const runId = await createRun()
    const step = createStepExecutor(db, runId, noopLogger)

    let callCount = 0
    const fn = async () => { callCount++; return 42 }

    const first = await step('compute', fn)
    const second = await step('compute', fn)

    assert.equal(first, 42)
    assert.equal(second, 42)
    assert.equal(callCount, 1) // fn only called once
  })

  test('deterministic replay skips completed step with null output', async ({ assert }) => {
    const db = getDb()
    const runId = await createRun()
    const step = createStepExecutor(db, runId, noopLogger)

    let callCount = 0
    const fn = async () => {
      callCount++
      return null
    }

    const first = await step('compute-null', fn)
    const second = await step('compute-null', fn)

    assert.isNull(first)
    assert.isNull(second)
    assert.equal(callCount, 1)
  })

  test('step timeout throws StepTimeoutError', async ({ assert }) => {
    const db = getDb()
    const runId = await createRun()
    const step = createStepExecutor(db, runId, noopLogger)

    try {
      await step('slow', () => new Promise((r) => setTimeout(r, 5000)), { timeout: 50 })
      assert.fail('Should have thrown')
    } catch (err) {
      assert.equal((err as Error).name, 'StepTimeoutError')
    }

    const [stored] = await db.select()
      .from(stepResults)
      .where(eq(stepResults.flowRunId, runId))
      .limit(1)

    assert.equal(stored.status, 'failed')
    assert.include(stored.error!, 'timed out')
  })

  test('cancellation via AbortSignal throws FlowCanceledError', async ({ assert }) => {
    const db = getDb()
    const runId = await createRun()
    const ctrl = new AbortController()
    const step = createStepExecutor(db, runId, noopLogger, ctrl.signal)

    ctrl.abort()

    try {
      await step('should-not-run', async () => 'nope')
      assert.fail('Should have thrown')
    } catch (err) {
      assert.equal((err as Error).name, 'FlowCanceledError')
    }
  })

  test('step records durationMs', async ({ assert }) => {
    const db = getDb()
    const runId = await createRun()
    const step = createStepExecutor(db, runId, noopLogger)

    await step('quick', async () => {
      await new Promise((r) => setTimeout(r, 20))
      return 'done'
    })

    const [stored] = await db.select()
      .from(stepResults)
      .where(eq(stepResults.flowRunId, runId))
      .limit(1)

    assert.isNotNull(stored.durationMs)
    assert.isAbove(stored.durationMs!, 10)
  })

  test('sleep throws SleepSignal on first call', async ({ assert }) => {
    const db = getDb()
    const runId = await createRun()
    const step = createStepExecutor(db, runId, noopLogger)

    try {
      await step.sleep('wait-a-bit', 60_000)
      assert.fail('Should have thrown SleepSignal')
    } catch (err) {
      assert.equal((err as Error).name, 'SleepSignal')
    }
  })

  test('step with failed status is fenced within the same attempt', async ({ assert }) => {
    const db = getDb()
    const runId = await createRun()
    const step = createStepExecutor(db, runId, noopLogger)

    // First call fails
    try {
      await step('flaky', async () => { throw new Error('fail-1') })
    } catch { /* expected */ }

    // Second call in the same attempt should not double-execute the step.
    await assert.rejects(
      () => step('flaky', async () => 'ok'),
      /fail-1/,
    )
  })

  test('step with failed status can run again in a new attempt', async ({ assert }) => {
    const db = getDb()
    const runId = await createRun()
    const attemptOne = createStepExecutor(db, runId, noopLogger, undefined, undefined, 1)

    try {
      await attemptOne('flaky', async () => { throw new Error('fail-1') })
    } catch { /* expected */ }

    const attemptTwo = createStepExecutor(db, runId, noopLogger, undefined, undefined, 2)
    const result = await attemptTwo('flaky', async () => 'ok')

    assert.equal(result, 'ok')
  })
})
