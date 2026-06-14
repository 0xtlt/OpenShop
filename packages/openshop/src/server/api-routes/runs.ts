import type { Hono } from 'hono'
import { eq, and, or, not, desc, ilike, gte, lte, sql, inArray } from 'drizzle-orm'
import { getDb } from '#db/client'
import { flowRuns, stepResults, logs } from '#db/schema'
import { dispatchFlow } from '#engine/dispatch'
import { cancelRun } from '#engine/abort'
import { FlowConcurrencyError } from '#engine/errors'
import { getShop, getShopifyApp } from '#server/shop'
import type { FlowRunStatus, OpenShopConfig } from '#types'
import { createLogExportResponse, getFilteredRunLogs } from './run-logs.ts'

const activeRunStatuses = ['running', 'pending', 'sleeping'] as const satisfies readonly FlowRunStatus[]
const allRunStatuses = ['pending', 'running', 'sleeping', 'completed', 'failed', 'canceled'] as const satisfies readonly FlowRunStatus[]

function runSearchConditions(queries: { search?: string; from?: string; to?: string; status?: string }) {
  const conditions = []

  if (queries.search) {
    const s = queries.search
    conditions.push(or(
      ilike(flowRuns.flowName, `%${s}%`),
      ilike(flowRuns.status, `%${s}%`),
      sql`${flowRuns.id}::text ILIKE ${'%' + s + '%'}`,
    )!)
  }
  if (queries.status && allRunStatuses.includes(queries.status as FlowRunStatus)) {
    conditions.push(eq(flowRuns.status, queries.status as FlowRunStatus))
  }
  if (queries.from) {
    const d = new Date(queries.from)
    if (!isNaN(d.getTime())) conditions.push(gte(flowRuns.createdAt, d))
  }
  if (queries.to) {
    const d = new Date(queries.to)
    if (!isNaN(d.getTime())) conditions.push(lte(flowRuns.createdAt, d))
  }

  return conditions
}

export function registerRunRoutes(api: Hono, getConfig: () => OpenShopConfig) {
  api.get('/runs', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)
    const limit = Math.min(Math.max(1, Number(c.req.query('limit')) || 50), 200)
    const offset = Math.max(0, Number(c.req.query('offset')) || 0)

    const q = { search: c.req.query('search'), from: c.req.query('from'), to: c.req.query('to'), status: c.req.query('status') }
    const conditions = [eq(flowRuns.appHandle, shopifyApp), eq(flowRuns.shop, shop), ...runSearchConditions(q)]

    const runs = await db.select()
      .from(flowRuns)
      .where(and(...conditions))
      .orderBy(desc(flowRuns.createdAt))
      .limit(limit)
      .offset(offset)

    return c.json(runs)
  })

  api.get('/flows/:name/runs', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)
    const name = c.req.param('name')
    const limit = Math.min(Math.max(1, Number(c.req.query('limit')) || 50), 200)
    const offset = Math.max(0, Number(c.req.query('offset')) || 0)

    const q = { search: c.req.query('search'), from: c.req.query('from'), to: c.req.query('to'), status: c.req.query('status') }
    const conditions = [eq(flowRuns.appHandle, shopifyApp), eq(flowRuns.shop, shop), eq(flowRuns.flowName, name), ...runSearchConditions(q)]

    const runs = await db.select()
      .from(flowRuns)
      .where(and(...conditions))
      .orderBy(desc(flowRuns.createdAt))
      .limit(limit)
      .offset(offset)

    return c.json(runs)
  })

  api.get('/runs/:id', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)
    const id = c.req.param('id')

    const [run] = await db.select().from(flowRuns).where(and(eq(flowRuns.id, id), eq(flowRuns.appHandle, shopifyApp), eq(flowRuns.shop, shop))).limit(1)
    if (!run) return c.json({ error: 'Run not found' }, 404)

    const steps = await db.select().from(stepResults).where(eq(stepResults.flowRunId, id))
    return c.json({ ...run, steps })
  })

  api.get('/runs/:id/logs', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)
    const id = c.req.param('id')
    const q = c.req.query('q') ?? ''
    const levelsParam = c.req.query('levels') ?? 'info,warn,error'

    const [run] = await db.select({ id: flowRuns.id }).from(flowRuns).where(and(eq(flowRuns.id, id), eq(flowRuns.appHandle, shopifyApp), eq(flowRuns.shop, shop))).limit(1)
    if (!run) return c.json({ error: 'Run not found' }, 404)

    return c.json(await getFilteredRunLogs(id, {
      query: q,
      levelsParam,
      includeContext: true,
    }))
  })

  api.get('/runs/:id/logs/export', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)
    const id = c.req.param('id')
    const format = c.req.query('format') ?? 'json'
    const q = c.req.query('q') ?? ''
    const levelsParam = c.req.query('levels') ?? 'info,warn,error'

    const [run] = await db.select({ id: flowRuns.id }).from(flowRuns).where(and(eq(flowRuns.id, id), eq(flowRuns.appHandle, shopifyApp), eq(flowRuns.shop, shop))).limit(1)
    if (!run) return c.json({ error: 'Run not found' }, 404)

    const result = await getFilteredRunLogs(id, {
      query: q,
      levelsParam,
      includeContext: false,
    })
    return createLogExportResponse(id, format, result.logs)
  })

  api.post('/flows/:name/run', async (c) => {
    const config = getConfig()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)
    const name = c.req.param('name')
    const body = await c.req.json().catch(() => ({}))

    try {
      const result = await dispatchFlow({
        flowName: name,
        input: body.input ?? {},
        config,
        shopifyApp,
        shop,
      })
      return c.json(result, 202)
    } catch (error) {
      if (error instanceof FlowConcurrencyError) {
        return c.json({ error: error.message, existingRunId: error.existingRunId }, 409)
      }
      throw error
    }
  })

  api.post('/runs/:id/retry', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)
    const id = c.req.param('id')
    const mode = c.req.query('mode') ?? 'resume'

    const [run] = await db.select().from(flowRuns).where(and(eq(flowRuns.id, id), eq(flowRuns.appHandle, shopifyApp), eq(flowRuns.shop, shop))).limit(1)
    if (!run) return c.json({ error: 'Run not found' }, 404)

    if (!['failed', 'completed', 'canceled'].includes(run.status)) {
      return c.json({ error: `Cannot retry a run with status "${run.status}"` }, 409)
    }

    const config = getConfig()
    const flow = config.flows?.[run.flowName]
    const deadlineAt = flow?.timeout ? new Date(Date.now() + flow.timeout) : null

    await db.transaction(async (tx) => {
      if (mode === 'reset') {
        await tx.delete(stepResults).where(eq(stepResults.flowRunId, id))
      } else {
        await tx.delete(stepResults).where(and(eq(stepResults.flowRunId, id), sql`${stepResults.status} != 'completed'`))
      }

      await tx.update(flowRuns)
        .set({ status: 'pending', error: null, availableAt: new Date(), completedAt: null, workerId: null, attempts: 0, deadlineAt, startedAt: null, retryPolicy: null })
        .where(eq(flowRuns.id, id))

      await tx.insert(logs).values({
        flowRunId: id, level: 'info',
        message: `Run retried (${mode === 'reset' ? 'restart — all steps discarded' : 'resume — completed steps kept'})`,
        payload: { mode, flowName: run.flowName },
      })
    })

    return c.json({ ok: true, runId: id, mode })
  })

  api.post('/runs/:id/cancel', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)
    const id = c.req.param('id')

    const [run] = await db.select().from(flowRuns).where(and(eq(flowRuns.id, id), eq(flowRuns.appHandle, shopifyApp), eq(flowRuns.shop, shop))).limit(1)
    if (!run) return c.json({ error: 'Run not found' }, 404)

    if (!['pending', 'running', 'sleeping'].includes(run.status)) {
      return c.json({ error: `Cannot cancel a run with status "${run.status}"` }, 409)
    }

    cancelRun(id)

    await db.update(flowRuns)
      .set({ status: 'canceled', completedAt: new Date() })
      .where(eq(flowRuns.id, id))

    return c.json({ ok: true })
  })

  api.delete('/runs/:id', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)
    const id = c.req.param('id')

    const [run] = await db.select().from(flowRuns).where(and(eq(flowRuns.id, id), eq(flowRuns.appHandle, shopifyApp), eq(flowRuns.shop, shop))).limit(1)
    if (!run) return c.json({ error: 'Run not found' }, 404)

    if (['running', 'pending', 'sleeping'].includes(run.status)) {
      return c.json({ error: 'Cannot delete an active run — cancel it first' }, 409)
    }

    await db.transaction(async (tx) => {
      await tx.delete(logs).where(eq(logs.flowRunId, id))
      await tx.delete(stepResults).where(eq(stepResults.flowRunId, id))
      await tx.delete(flowRuns).where(eq(flowRuns.id, id))
    })

    return c.json({ ok: true })
  })

  api.post('/runs/bulk-delete', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)
    const { ids } = await c.req.json<{ ids: string[] }>()

    if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: 'No IDs provided' }, 400)
    if (ids.length > 100) return c.json({ error: 'Max 100 runs per batch' }, 400)

    const toDelete = await db.select({ id: flowRuns.id })
      .from(flowRuns)
      .where(and(eq(flowRuns.appHandle, shopifyApp), eq(flowRuns.shop, shop), inArray(flowRuns.id, ids), not(inArray(flowRuns.status, activeRunStatuses))))

    const deleteIds = toDelete.map((r) => r.id)
    if (deleteIds.length === 0) return c.json({ deleted: 0, skipped: ids.length })

    await db.transaction(async (tx) => {
      await tx.delete(logs).where(inArray(logs.flowRunId, deleteIds))
      await tx.delete(stepResults).where(inArray(stepResults.flowRunId, deleteIds))
      await tx.delete(flowRuns).where(inArray(flowRuns.id, deleteIds))
    })

    return c.json({ deleted: deleteIds.length, skipped: ids.length - deleteIds.length })
  })
}
