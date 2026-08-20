import { and, eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { providerConfigs } from '#db/schema'
import { decryptConfig } from '#server/crypto'
import type { OpenShopConfig } from '#types'

export type RuntimeConnectors = Record<string, Record<string, (...args: unknown[]) => unknown>>
type RuntimeProviderMethod = (config: Record<string, unknown>, ...args: unknown[]) => unknown

function isRuntimeProviderMethod(value: unknown): value is RuntimeProviderMethod {
  return typeof value === 'function'
}

export async function buildConnectors(
  config: OpenShopConfig,
  shop: string,
  shopifyApp: string,
): Promise<RuntimeConnectors> {
  const connectors: RuntimeConnectors = {}
  const db = getDb()

  for (const [name, provider] of Object.entries(config.providers)) {
    const [stored] = await db.select({ config: providerConfigs.config })
      .from(providerConfigs)
      .where(and(
        eq(providerConfigs.appHandle, shopifyApp),
        eq(providerConfigs.shop, shop),
        eq(providerConfigs.providerName, name),
      ))
      .limit(1)
    const providerConfig = decryptConfig(stored?.config)

    const connector: Record<string, (...args: unknown[]) => unknown> = {}
    for (const methodName of Object.keys(provider.methods)) {
      const methodFn = provider.methods[methodName]
      if (!isRuntimeProviderMethod(methodFn)) continue
      connector[methodName] = (...args: unknown[]) => methodFn(providerConfig, ...args)
    }
    connectors[name] = connector
  }

  return connectors
}
