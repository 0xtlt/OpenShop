import type { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { cronOverrides } from '#db/schema'
import { getShop, getShopifyApp } from '#server/shop'
import type { OpenShopConfig } from '#types'

export function registerCronRoutes(api: Hono, getConfig: () => OpenShopConfig) {
  api.get('/crons', async (c) => {
    const config = getConfig()
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)

    const overrides = await db.select().from(cronOverrides)
      .where(and(eq(cronOverrides.appHandle, shopifyApp), eq(cronOverrides.shop, shop)))
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
    const shopifyApp = getShopifyApp(c)
    const body = await c.req.json<{ key: string; enabled: boolean }>()

    await db.insert(cronOverrides)
      .values({
        appHandle: shopifyApp,
        shop,
        cronKey: body.key,
        enabled: body.enabled,
      })
      .onConflictDoUpdate({
        target: [cronOverrides.appHandle, cronOverrides.shop, cronOverrides.cronKey],
        set: { enabled: body.enabled, updatedAt: new Date() },
      })

    return c.json({ ok: true, key: body.key, enabled: body.enabled })
  })
}
