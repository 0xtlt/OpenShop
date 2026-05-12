import { Cron } from 'croner'
import { eq, and, isNull } from 'drizzle-orm'
import { getDb } from '#db/client'
import { installations, cronOverrides } from '#db/schema'
import { dispatchFlow } from '#engine/dispatch'
import type { OpenShopConfig, CronEntry } from '#types'

const activeCrons: Cron[] = []

async function resolveShops(entry: CronEntry): Promise<string[]> {
  const mode = entry.shops ?? 'global'

  if (mode === 'global') return ['__global__']

  if (mode === 'all') {
    const db = getDb()
    const rows = await db.select({ shop: installations.shop })
      .from(installations)
      .where(isNull(installations.uninstalledAt))
    return rows.map((r) => r.shop)
  }

  if (Array.isArray(mode)) return mode

  return [mode]
}

export function startScheduler(config: OpenShopConfig) {
  if (!config.crons?.length) return

  for (const entry of config.crons) {
    const { schedule, flow } = entry

    if (!config.flows[flow]) {
      console.warn(`[openshop] Cron references unknown flow "${flow}", skipping`)
      continue
    }

    // Validate cron expression format (croner: 5 fields standard, 6 with seconds)
    const fields = schedule.trim().split(/\s+/)
    if (fields.length !== 5 && fields.length !== 6) {
      throw new Error(`[openshop] Invalid cron schedule "${schedule}" for flow "${flow}": expected 5 or 6 fields, got ${fields.length}`)
    }

    const cronKey = `${flow}:${schedule}`

    const job = new Cron(schedule, async () => {
      const shops = await resolveShops(entry)

      if (shops.length === 0) {
        console.log(`[openshop] Cron "${flow}": no shops to run for, skipping`)
        return
      }

      console.log(`[openshop] Cron triggered: ${flow} → ${shops.length} shop(s)`)

      const db = getDb()
      for (const shop of shops) {
        try {
          // Check if cron is disabled for this shop
          const [override] = await db.select({ enabled: cronOverrides.enabled })
            .from(cronOverrides)
            .where(and(eq(cronOverrides.cronKey, cronKey), eq(cronOverrides.shop, shop)))
            .limit(1)

          if (override && !override.enabled) {
            console.log(`[openshop] Cron "${flow}" disabled for ${shop}, skipping`)
            continue
          }

          await dispatchFlow({ flowName: flow, input: entry.input, config, shop })
        } catch (error) {
          console.error(`[openshop] Cron flow "${flow}" failed for ${shop}:`, error)
        }
      }
    })

    activeCrons.push(job)
    const mode = entry.shops ?? 'global'
    const label = entry.name ?? flow
    console.log(`[openshop] Cron registered: "${label}" → ${schedule} (${mode})`)
  }
}

export function stopScheduler() {
  for (const job of activeCrons) {
    job.stop()
  }
  activeCrons.length = 0
}
