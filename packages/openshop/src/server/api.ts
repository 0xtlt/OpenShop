import { Hono } from 'hono'
import { eq, and, or, not, desc, asc, ilike, gte, lte, sql, inArray } from 'drizzle-orm'
import { getDb } from '#db/client'
import { flowRuns, stepResults, logs, providerConfigs, cronOverrides } from '#db/schema'
import { dispatchFlow } from '#engine/dispatch'
import { cancelRun } from '#engine/abort'
import { FlowConcurrencyError } from '#engine/errors'
import { getShop } from '#server/shop'
import { encryptConfig, decryptConfig } from '#server/crypto'
import type { FlowRunStatus, OpenShopConfig } from '#types'
import { parseLogQuery, matchesLogFilters, applyContextExpansion } from '#server/log-query'
import { parseProviderConfig, providerFieldsForResponse, publicProviderConfig } from '#server/provider-config'

// ─── Routes ──────────────────────────────────────────────────────────

export function createApiRoutes(getConfig: () => OpenShopConfig) {
  const api = new Hono()
  const activeRunStatuses = ['running', 'pending', 'sleeping'] as const satisfies readonly FlowRunStatus[]
  const allRunStatuses = ['pending', 'running', 'sleeping', 'completed', 'failed', 'canceled'] as const satisfies readonly FlowRunStatus[]

  // ─── Flows

  api.get('/flows', (c) => {
    const config = getConfig()
    const flows = Object.entries(config.flows).map(([name, flow]) => ({
      name,
      crons: config.crons?.filter((cr) => cr.flow === name) ?? [],
      inputSchema: flow.input?.json ?? null,
    }))
    return c.json(flows)
  })

  // ─── Crons

  api.get('/crons', async (c) => {
    const config = getConfig()
    const db = getDb()
    const shop = getShop(c)

    const overrides = await db.select().from(cronOverrides).where(eq(cronOverrides.shop, shop))
    const overrideMap = new Map(overrides.map((o) => [o.cronKey, o.enabled]))

    const crons = (config.crons ?? []).map((entry, i) => {
      const key = `${entry.flow}:${entry.schedule}`
      return {
        index: i,
        key,
        name: entry.name ?? null,
        flow: entry.flow,
        schedule: entry.schedule,
        input: entry.input ?? null,
        shops: entry.shops ?? 'global',
        enabled: overrideMap.get(key) ?? true,
      }
    })
    return c.json(crons)
  })

  api.post('/crons/toggle', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const body = await c.req.json<{ key: string; enabled: boolean }>()

    await db.insert(cronOverrides)
      .values({
        shop,
        cronKey: body.key,
        enabled: body.enabled,
      })
      .onConflictDoUpdate({
        target: [cronOverrides.shop, cronOverrides.cronKey],
        set: { enabled: body.enabled, updatedAt: new Date() },
      })

    return c.json({ ok: true, key: body.key, enabled: body.enabled })
  })

  // ─── Flow runs

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

  api.get('/runs', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const limit = Math.min(Math.max(1, Number(c.req.query('limit')) || 50), 200)
    const offset = Math.max(0, Number(c.req.query('offset')) || 0)

    const q = { search: c.req.query('search'), from: c.req.query('from'), to: c.req.query('to'), status: c.req.query('status') }
    const conditions = [eq(flowRuns.shop, shop), ...runSearchConditions(q)]

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
    const name = c.req.param('name')
    const limit = Math.min(Math.max(1, Number(c.req.query('limit')) || 50), 200)
    const offset = Math.max(0, Number(c.req.query('offset')) || 0)

    const q = { search: c.req.query('search'), from: c.req.query('from'), to: c.req.query('to'), status: c.req.query('status') }
    const conditions = [eq(flowRuns.shop, shop), eq(flowRuns.flowName, name), ...runSearchConditions(q)]

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
    const id = c.req.param('id')

    const [run] = await db.select().from(flowRuns).where(and(eq(flowRuns.id, id), eq(flowRuns.shop, shop))).limit(1)
    if (!run) return c.json({ error: 'Run not found' }, 404)

    const steps = await db.select().from(stepResults).where(eq(stepResults.flowRunId, id))
    return c.json({ ...run, steps })
  })

  api.get('/runs/:id/logs', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const id = c.req.param('id')
    const q = c.req.query('q') ?? ''
    const levelsParam = c.req.query('levels') ?? 'info,warn,error'
    const activeLevels = new Set(levelsParam.split(',').filter(Boolean))

    const [run] = await db.select({ id: flowRuns.id }).from(flowRuns).where(and(eq(flowRuns.id, id), eq(flowRuns.shop, shop))).limit(1)
    if (!run) return c.json({ error: 'Run not found' }, 404)

    const allLogs = await db.select().from(logs).where(eq(logs.flowRunId, id)).orderBy(desc(logs.createdAt))

    let filtered = allLogs.filter((l) => activeLevels.has(l.level))
    const parsed = parseLogQuery(q)

    if (parsed.time.from || parsed.time.to) {
      filtered = filtered.filter((l) => {
        const t = new Date(l.createdAt).getTime()
        if (parsed.time.from && t < parsed.time.from.getTime()) return false
        if (parsed.time.to && t > parsed.time.to.getTime()) return false
        return true
      })
    }

    if (parsed.filters.length === 0) {
      return c.json({ logs: filtered, total: allLogs.length })
    }

    const matchedIds = new Set<string>()
    for (const log of filtered) {
      if (matchesLogFilters(log, parsed.filters)) matchedIds.add(log.id)
    }

    const visibleIds = applyContextExpansion(filtered, matchedIds, parsed.context)
    const result = filtered
      .filter((l) => visibleIds.has(l.id))
      .map((l) => ({ ...l, _matched: matchedIds.has(l.id) }))

    return c.json({ logs: result, total: allLogs.length })
  })

  api.get('/runs/:id/logs/export', async (c) => {
    const db = getDb()
    const shop = getShop(c)
    const id = c.req.param('id')
    const format = c.req.query('format') ?? 'json'
    const q = c.req.query('q') ?? ''
    const levelsParam = c.req.query('levels') ?? 'info,warn,error'
    const activeLevels = new Set(levelsParam.split(',').filter(Boolean))

    const [run] = await db.select({ id: flowRuns.id }).from(flowRuns).where(and(eq(flowRuns.id, id), eq(flowRuns.shop, shop))).limit(1)
    if (!run) return c.json({ error: 'Run not found' }, 404)

    const allLogs = await db.select().from(logs).where(eq(logs.flowRunId, id)).orderBy(desc(logs.createdAt))

    let filtered = allLogs.filter((l) => activeLevels.has(l.level))
    const parsed = parseLogQuery(q)

    if (parsed.time.from || parsed.time.to) {
      filtered = filtered.filter((l) => {
        const t = new Date(l.createdAt).getTime()
        if (parsed.time.from && t < parsed.time.from.getTime()) return false
        if (parsed.time.to && t > parsed.time.to.getTime()) return false
        return true
      })
    }

    if (parsed.filters.length > 0) {
      filtered = filtered.filter((l) => matchesLogFilters(l, parsed.filters))
    }

    const filename = `run-${id}-logs.${format}`

    if (format === 'csv') {
      const header = 'id,level,message,payload,createdAt'
      const escape = (s: string) => `"${s.replace(/"/g, '""')}"`
      const rows = filtered.map((l) =>
        [l.id, l.level, escape(l.message ?? ''), escape(JSON.stringify(l.payload ?? '')), l.createdAt.toISOString()].join(','),
      )
      const csv = [header, ...rows].join('\n')
      return new Response(csv, {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` },
      })
    }

    return new Response(JSON.stringify(filtered, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"` },
    })
  })

  api.post('/flows/:name/run', async (c) => {
    const config = getConfig()
    const shop = getShop(c)
    const name = c.req.param('name')
    const body = await c.req.json().catch(() => ({}))

    try {
      const result = await dispatchFlow({
        flowName: name,
        input: body.input ?? {},
        config,
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
    const id = c.req.param('id')
    const mode = c.req.query('mode') ?? 'resume'

    const [run] = await db.select().from(flowRuns).where(and(eq(flowRuns.id, id), eq(flowRuns.shop, shop))).limit(1)
    if (!run) return c.json({ error: 'Run not found' }, 404)

    if (!['failed', 'completed', 'canceled'].includes(run.status)) {
      return c.json({ error: `Cannot retry a run with status "${run.status}"` }, 409)
    }

    // Recompute deadline from flow timeout
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
    const id = c.req.param('id')

    const [run] = await db.select().from(flowRuns).where(and(eq(flowRuns.id, id), eq(flowRuns.shop, shop))).limit(1)
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
    const id = c.req.param('id')

    const [run] = await db.select().from(flowRuns).where(and(eq(flowRuns.id, id), eq(flowRuns.shop, shop))).limit(1)
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
    const { ids } = await c.req.json<{ ids: string[] }>()

    if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: 'No IDs provided' }, 400)
    if (ids.length > 100) return c.json({ error: 'Max 100 runs per batch' }, 400)

    // Only delete non-active runs belonging to this shop
    const toDelete = await db.select({ id: flowRuns.id })
      .from(flowRuns)
      .where(and(eq(flowRuns.shop, shop), inArray(flowRuns.id, ids), not(inArray(flowRuns.status, activeRunStatuses))))

    const deleteIds = toDelete.map((r) => r.id)
    if (deleteIds.length === 0) return c.json({ deleted: 0, skipped: ids.length })

    await db.transaction(async (tx) => {
      await tx.delete(logs).where(inArray(logs.flowRunId, deleteIds))
      await tx.delete(stepResults).where(inArray(stepResults.flowRunId, deleteIds))
      await tx.delete(flowRuns).where(inArray(flowRuns.id, deleteIds))
    })

    return c.json({ deleted: deleteIds.length, skipped: ids.length - deleteIds.length })
  })

  // ─── Providers

  api.get('/providers', async (c) => {
    const config = getConfig()
    const db = getDb()
    const shop = getShop(c)

    const providers = await Promise.all(
      Object.entries(config.providers).map(async ([name, provider]) => {
        const [stored] = await db.select()
          .from(providerConfigs)
          .where(and(eq(providerConfigs.shop, shop), eq(providerConfigs.providerName, name)))
          .limit(1)

        const storedConfig = decryptConfig(stored?.config)

        return {
          name,
          fields: providerFieldsForResponse(provider, storedConfig),
          config: publicProviderConfig(provider, storedConfig),
          lastCheckedAt: stored?.lastCheckedAt ?? null,
          lastCheckOk: stored?.lastCheckOk ?? null,
        }
      }),
    )

    return c.json(providers)
  })

  api.put('/providers/:name', async (c) => {
    const config = getConfig()
    const db = getDb()
    const shop = getShop(c)
    const name = c.req.param('name')
    const body = await c.req.json()
    const provider = config.providers[name]

    if (!provider) return c.json({ error: 'Provider not found' }, 404)

    const [existing] = await db.select({ id: providerConfigs.id, config: providerConfigs.config })
      .from(providerConfigs)
      .where(and(eq(providerConfigs.shop, shop), eq(providerConfigs.providerName, name)))
      .limit(1)

    const parsed = parseProviderConfig(provider, body.config, decryptConfig(existing?.config))
    if (!parsed.ok) return c.json({ error: parsed.error }, 400)

    const encrypted = encryptConfig(parsed.config)

    await db.insert(providerConfigs)
      .values({ shop, providerName: name, config: encrypted })
      .onConflictDoUpdate({
        target: [providerConfigs.shop, providerConfigs.providerName],
        set: { config: encrypted, updatedAt: new Date() },
      })

    return c.json({ ok: true })
  })

  api.post('/providers/:name/check', async (c) => {
    const config = getConfig()
    const db = getDb()
    const shop = getShop(c)
    const name = c.req.param('name')
    const provider = config.providers[name]

    if (!provider) return c.json({ error: 'Provider not found' }, 404)
    if (!provider.checker) return c.json({ error: 'No checker defined' }, 400)

    const [stored] = await db.select()
      .from(providerConfigs)
      .where(and(eq(providerConfigs.shop, shop), eq(providerConfigs.providerName, name)))
      .limit(1)

    try {
      const configData = decryptConfig(stored?.config)
      const ok = await provider.checker({ config: configData })

      if (stored) {
        await db.update(providerConfigs)
          .set({ lastCheckedAt: new Date(), lastCheckOk: ok })
          .where(eq(providerConfigs.id, stored.id))
      }

      return c.json({ ok })
    } catch (error) {
      return c.json({ ok: false, error: String(error) }, 500)
    }
  })

  return api
}
