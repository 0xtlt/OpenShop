import { randomUUID } from 'node:crypto'
import { type } from 'arktype'
import { eq, and, inArray, lte, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '#db/client'
import { flowRuns } from '#db/schema'
import { runFlow } from '#engine/runner'
import type { OpenShopConfig, WorkerConfig } from '#types'

const inputSchema = type('Record<string, unknown>')

const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  concurrency: 5,
  pollIntervalMs: 1_000,
  pollMaxIntervalMs: 5_000,
  pollBackoffCoefficient: 1.5,
  leaseDurationMs: 30_000,
}

export class Worker {
  #config: Required<WorkerConfig>
  #openshopConfig: OpenShopConfig
  #workerId: string
  #running = false
  #loopPromise: Promise<void> | null = null
  #activeRuns = new Map<string, Promise<void>>()

  constructor(openshopConfig: OpenShopConfig, overrides?: Partial<WorkerConfig>) {
    this.#config = { ...DEFAULT_WORKER_CONFIG, ...openshopConfig.worker, ...overrides }
    this.#openshopConfig = openshopConfig
    this.#workerId = randomUUID()
  }

  get isRunning() { return this.#running }
  get activeCount() { return this.#activeRuns.size }

  async start(): Promise<void> {
    this.#running = true
    console.log(`[openshop] Worker started (id=${this.#workerId.slice(0, 8)}, concurrency=${this.#config.concurrency})`)
    this.#loopPromise = this.#runLoop()
  }

  async stop(): Promise<void> {
    this.#running = false
    console.log('[openshop] Worker stopping...')
    if (this.#loopPromise) await this.#loopPromise
    const deadline = Date.now() + this.#config.leaseDurationMs
    while (this.#activeRuns.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200))
    }
    console.log('[openshop] Worker stopped')
  }

  updateConfig(config: OpenShopConfig): void {
    this.#openshopConfig = config
  }

  async #runLoop(): Promise<void> {
    let consecutiveEmpty = 0

    while (this.#running) {
      const slots = this.#config.concurrency - this.#activeRuns.size
      if (slots <= 0) {
        await this.#sleep(this.#config.pollIntervalMs)
        continue
      }

      const claimed = await this.#claimOne()
      if (claimed) {
        consecutiveEmpty = 0
        this.#processRun(claimed)
      } else {
        consecutiveEmpty++
        const delay = this.#backoffDelay(consecutiveEmpty)
        await this.#sleep(delay)
      }
    }
  }

  async #claimOne() {
    const db = getDb()
    const now = new Date()
    const leaseUntil = new Date(Date.now() + this.#config.leaseDurationMs)

    // Expire deadline-exceeded runs
    await db.update(flowRuns)
      .set({ status: 'failed', error: 'Flow timed out — exceeded maximum allowed duration', workerId: null, availableAt: null, completedAt: now })
      .where(and(
        inArray(flowRuns.status, ['pending', 'running', 'sleeping']),
        isNotNull(flowRuns.deadlineAt),
        lte(flowRuns.deadlineAt, now),
      ))

    // Atomic claim using FOR UPDATE SKIP LOCKED
    const claimed = await db.execute<{ id: string; flow_name: string; shop: string; input: unknown }>(sql`
      WITH candidate AS (
        SELECT id FROM flow_runs
        WHERE (
          (status IN ('pending', 'sleeping') AND available_at <= ${now})
          OR (status = 'running' AND available_at <= ${now})
        )
        ORDER BY available_at ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE flow_runs
      SET
        status = 'running',
        attempts = attempts + 1,
        worker_id = ${this.#workerId},
        available_at = ${leaseUntil},
        started_at = COALESCE(started_at, ${now})
      WHERE id = (SELECT id FROM candidate)
      RETURNING id, flow_name, shop, input
    `)

    const rows = claimed.rows ?? claimed
    if (!rows || (Array.isArray(rows) && rows.length === 0)) return null

    const row = Array.isArray(rows) ? rows[0] : rows
    return {
      id: row.id,
      flowName: row.flow_name,
      shop: row.shop,
      input: row.input,
    }
  }

  #processRun(claimed: { id: string; flowName: string; shop: string; input: unknown }): void {
    const promise = this.#executeAndCleanup(claimed)
    this.#activeRuns.set(claimed.id, promise)
  }

  async #executeAndCleanup(claimed: { id: string; flowName: string; shop: string; input: unknown }): Promise<void> {
    const db = getDb()
    try {
      const flow = this.#openshopConfig.flows[claimed.flowName]
      if (!flow) {
        await db.update(flowRuns)
          .set({ status: 'failed', error: `Flow "${claimed.flowName}" not registered`, workerId: null, completedAt: new Date() })
          .where(eq(flowRuns.id, claimed.id))
        return
      }

      const parsedInput = inputSchema(claimed.input)
      const input = parsedInput instanceof type.errors ? {} : parsedInput

      await runFlow({
        runId: claimed.id,
        flowName: claimed.flowName,
        input,
        config: this.#openshopConfig,
        shop: claimed.shop,
        onHeartbeat: async () => {
          const leaseUntil = new Date(Date.now() + this.#config.leaseDurationMs)
          await db.update(flowRuns)
            .set({ availableAt: leaseUntil })
            .where(eq(flowRuns.id, claimed.id))
        },
      })
    } catch (error) {
      try {
        await db.update(flowRuns)
          .set({ status: 'failed', error: `Worker error: ${error instanceof Error ? error.message : String(error)}`, workerId: null, completedAt: new Date() })
          .where(eq(flowRuns.id, claimed.id))
      } catch { /* lease will expire */ }
    } finally {
      this.#activeRuns.delete(claimed.id)
    }
  }

  #backoffDelay(consecutive: number): number {
    const base = this.#config.pollIntervalMs * Math.pow(this.#config.pollBackoffCoefficient, consecutive - 1)
    const capped = Math.min(base, this.#config.pollMaxIntervalMs)
    return Math.round(capped * (0.5 + Math.random() * 0.5))
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }
}
