import type { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { getDb } from '#db/client'
import { providerConfigs } from '#db/schema'
import { getShop, getShopifyApp } from '#server/shop'
import { encryptConfig, decryptConfig } from '#server/crypto'
import { parseProviderConfig, providerFieldsForResponse, publicProviderConfig } from '#server/provider-config'
import type { OpenShopConfig } from '#types'

export function registerProviderRoutes(api: Hono, getConfig: () => OpenShopConfig) {
  api.get('/providers', async (c) => {
    const config = getConfig()
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)

    const storedRows = await db.select()
      .from(providerConfigs)
      .where(and(eq(providerConfigs.appHandle, shopifyApp), eq(providerConfigs.shop, shop)))
    const storedByProvider = new Map(storedRows.map((row) => [row.providerName, row]))

    const providers = Object.entries(config.providers).map(([name, provider]) => {
      const stored = storedByProvider.get(name)
      const storedConfig = decryptConfig(stored?.config)

      return {
        name,
        fields: providerFieldsForResponse(provider, storedConfig),
        config: publicProviderConfig(provider, storedConfig),
        lastCheckedAt: stored?.lastCheckedAt ?? null,
        lastCheckOk: stored?.lastCheckOk ?? null,
      }
    })

    return c.json(providers)
  })

  api.put('/providers/:name', async (c) => {
    const config = getConfig()
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)
    const name = c.req.param('name')
    const body = await c.req.json()
    const provider = config.providers[name]

    if (!provider) return c.json({ error: 'Provider not found' }, 404)

    const [existing] = await db.select({ id: providerConfigs.id, config: providerConfigs.config })
      .from(providerConfigs)
      .where(and(eq(providerConfigs.appHandle, shopifyApp), eq(providerConfigs.shop, shop), eq(providerConfigs.providerName, name)))
      .limit(1)

    const parsed = parseProviderConfig(provider, body.config, decryptConfig(existing?.config))
    if (!parsed.ok) return c.json({ error: parsed.error }, 400)

    const encrypted = encryptConfig(parsed.config)

    await db.insert(providerConfigs)
      .values({ appHandle: shopifyApp, shop, providerName: name, config: encrypted })
      .onConflictDoUpdate({
        target: [providerConfigs.appHandle, providerConfigs.shop, providerConfigs.providerName],
        set: { config: encrypted, updatedAt: new Date() },
      })

    return c.json({ ok: true })
  })

  api.post('/providers/:name/check', async (c) => {
    const config = getConfig()
    const db = getDb()
    const shop = getShop(c)
    const shopifyApp = getShopifyApp(c)
    const name = c.req.param('name')
    const provider = config.providers[name]

    if (!provider) return c.json({ error: 'Provider not found' }, 404)
    if (!provider.checker) return c.json({ error: 'No checker defined' }, 400)

    const [stored] = await db.select()
      .from(providerConfigs)
      .where(and(eq(providerConfigs.appHandle, shopifyApp), eq(providerConfigs.shop, shop), eq(providerConfigs.providerName, name)))
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
}
