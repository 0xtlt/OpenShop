import type { Database } from '#db/client'
import { stepResults } from '#db/schema'
import { and, eq } from 'drizzle-orm'
import type { StepFn, StepOptions } from '#types'
import { FlowCanceledError, StepTimeoutError, SleepSignal } from '#engine/errors'

export function createStepExecutor(
  db: Database,
  flowRunId: string,
  logger: { info: (payload: Record<string, unknown>, message?: string) => void },
  signal?: AbortSignal,
  defaultTimeout?: number,
): StepFn {
  const stepFn = async function step<T>(name: string, fn: () => Promise<T> | T, options?: StepOptions): Promise<T> {
    if (signal?.aborted) throw new FlowCanceledError()

    // Deterministic replay: return cached result
    const [existing] = await db.select()
      .from(stepResults)
      .where(and(
        eq(stepResults.flowRunId, flowRunId),
        eq(stepResults.stepName, name),
        eq(stepResults.status, 'completed'),
      ))
      .limit(1)

    if (existing) {
      logger.info({ step: name }, `Step "${name}" skipped (cached)`)
      return existing.output as T
    }

    logger.info({ step: name }, `Step "${name}" started`)

    const [stepRow] = await db.insert(stepResults).values({
      flowRunId,
      stepName: name,
      status: 'running',
    }).returning({ id: stepResults.id })

    if (!stepRow) throw new Error(`Failed to create step record for "${name}"`)

    const start = performance.now()
    const timeout = options?.timeout ?? defaultTimeout

    try {
      let result: T

      if (timeout) {
        result = await Promise.race([
          Promise.resolve(fn()),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new StepTimeoutError(name, timeout)), timeout),
          ),
        ])
      } else {
        result = await fn()
      }

      if (signal?.aborted) {
        await db.update(stepResults)
          .set({ status: 'canceled', durationMs: Math.round(performance.now() - start) })
          .where(eq(stepResults.id, stepRow.id))
        throw new FlowCanceledError()
      }

      const durationMs = Math.round(performance.now() - start)
      await db.update(stepResults)
        .set({ status: 'completed', output: JSON.parse(JSON.stringify(result ?? null)), durationMs })
        .where(eq(stepResults.id, stepRow.id))

      logger.info({ step: name, durationMs }, `Step "${name}" completed (${durationMs}ms)`)
      return result
    } catch (error) {
      const durationMs = Math.round(performance.now() - start)

      if (error instanceof FlowCanceledError) {
        await db.update(stepResults)
          .set({ status: 'canceled', durationMs })
          .where(eq(stepResults.id, stepRow.id))
        throw error
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      await db.update(stepResults)
        .set({ status: 'failed', error: errorMessage, durationMs })
        .where(eq(stepResults.id, stepRow.id))
      logger.info({ step: name, durationMs, error: errorMessage }, `Step "${name}" failed (${durationMs}ms)`)
      throw error
    }
  } as StepFn

  stepFn.sleep = async function sleep(name: string, durationMs: number): Promise<void> {
    if (signal?.aborted) throw new FlowCanceledError()

    const [existing] = await db.select()
      .from(stepResults)
      .where(and(
        eq(stepResults.flowRunId, flowRunId),
        eq(stepResults.stepName, name),
        eq(stepResults.status, 'completed'),
      ))
      .limit(1)
    if (existing) return

    const [sleeping] = await db.select()
      .from(stepResults)
      .where(and(
        eq(stepResults.flowRunId, flowRunId),
        eq(stepResults.stepName, name),
        eq(stepResults.status, 'sleeping'),
      ))
      .limit(1)

    const resumeAt = new Date(Date.now() + durationMs)

    if (sleeping) {
      const storedResumeAt = sleeping.output ? new Date(String(sleeping.output)) : resumeAt
      if (storedResumeAt <= new Date()) {
        await db.update(stepResults)
          .set({ status: 'completed', durationMs })
          .where(eq(stepResults.id, sleeping.id))
        return
      }
      throw new SleepSignal(storedResumeAt)
    }

    await db.insert(stepResults).values({
      flowRunId,
      stepName: name,
      status: 'sleeping',
      output: resumeAt.toISOString(),
    })
    throw new SleepSignal(resumeAt)
  }

  return stepFn
}
