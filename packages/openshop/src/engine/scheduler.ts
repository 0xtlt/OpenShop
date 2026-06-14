import { Cron } from 'croner'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import { getDb } from '#db/client'
import { installations, cronOverrides } from '#db/schema'
import { dispatchFlow } from '#engine/dispatch'
import { getRuntimeLogger } from '../runtime/logger.ts'
import { DEFAULT_SHOPIFY_APP_HANDLE } from '#server/shopify-apps'
import type { OpenShopConfig, CronEntry } from '#types'

const activeCrons: Cron[] = []

interface CronTarget {
  shopifyApp: string
  shop: string
}

function inputRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

async function resolveInstalledTargets(shops: string[]): Promise<CronTarget[]> {
  if (shops.length === 0) return []
  const db = getDb()
  const rows = await db.select({ shopifyApp: installations.appHandle, shop: installations.shop })
    .from(installations)
    .where(and(isNull(installations.uninstalledAt), inArray(installations.shop, shops)))

  if (shops.length === 1) return rows.length ? rows : [{ shopifyApp: DEFAULT_SHOPIFY_APP_HANDLE, shop: shops[0]! }]

  const results: CronTarget[] = []
  for (const shop of shops) {
    const matches = rows.filter((row) => row.shop === shop)
    if (matches.length) results.push(...matches)
    else results.push({ shopifyApp: DEFAULT_SHOPIFY_APP_HANDLE, shop })
  }
  return results
}

async function resolveTargets(entry: Pick<CronEntry, 'shops'>): Promise<CronTarget[]> {
  const mode = entry.shops ?? 'global'

  if (mode === 'global') return [{ shopifyApp: DEFAULT_SHOPIFY_APP_HANDLE, shop: '__global__' }]

  if (mode === 'all') {
    const db = getDb()
    const rows = await db.select({ shopifyApp: installations.appHandle, shop: installations.shop })
      .from(installations)
      .where(isNull(installations.uninstalledAt))
    return rows
  }

  if (Array.isArray(mode)) return resolveInstalledTargets(mode)

  return resolveInstalledTargets([mode])
}

export function startScheduler(config: OpenShopConfig) {
  if (!config.crons?.length) return
  const logger = getRuntimeLogger()

  for (const entry of config.crons) {
    const { schedule, flow } = entry

    if (!config.flows[flow]) {
      logger.warn(`[openshop] Cron references unknown flow "${flow}", skipping`)
      continue
    }

    // Validate cron expression format (croner: 5 fields standard, 6 with seconds)
    const fields = schedule.trim().split(/\s+/)
    if (fields.length !== 5 && fields.length !== 6) {
      throw new Error(`[openshop] Invalid cron schedule "${schedule}" for flow "${flow}": expected 5 or 6 fields, got ${fields.length}`)
    }

    const cronKey = `${flow}:${schedule}`

    const job = new Cron(schedule, async () => {
      const targets = await resolveTargets(entry)

      if (targets.length === 0) {
        logger.info(`[openshop] Cron "${flow}": no shops to run for, skipping`)
        return
      }

      logger.info(`[openshop] Cron triggered: ${flow} → ${targets.length} target(s)`)

      const db = getDb()
      for (const { shopifyApp, shop } of targets) {
        try {
          // Check if cron is disabled for this shop
          const [override] = await db.select({ enabled: cronOverrides.enabled })
            .from(cronOverrides)
            .where(and(eq(cronOverrides.appHandle, shopifyApp), eq(cronOverrides.cronKey, cronKey), eq(cronOverrides.shop, shop)))
            .limit(1)

          if (override && !override.enabled) {
            logger.info(`[openshop] Cron "${flow}" disabled for ${shop}, skipping`)
            continue
          }

          await dispatchFlow({ flowName: flow, input: inputRecord(entry.input), config, shopifyApp, shop })
        } catch (error) {
          logger.error(`[openshop] Cron flow "${flow}" failed for ${shop}`, { error })
        }
      }
    })

    activeCrons.push(job)
    const mode = entry.shops ?? 'global'
    const label = entry.name ?? flow
    logger.info(`[openshop] Cron registered: "${label}" → ${schedule} (${mode})`)
  }
}

export function stopScheduler() {
  for (const job of activeCrons) {
    job.stop()
  }
  activeCrons.length = 0
}
