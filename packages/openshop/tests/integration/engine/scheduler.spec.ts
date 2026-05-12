import { test } from '@japa/runner'
import { eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { flowRuns, installations, cronOverrides } from '#db/schema'
import { startScheduler, stopScheduler } from '#engine/scheduler'
import { truncateAll, createConfig } from '../helpers.js'

const quickFlow = {
  name: 'quick-flow',
  async run() {},
}

test.group('scheduler', (group) => {
  group.each.setup(async () => {
    stopScheduler()
    await truncateAll()
  })
  group.teardown(() => stopScheduler())

  test('registers cron and triggers flow dispatch', async ({ assert }) => {
    const config = {
      ...createConfig({ 'quick-flow': quickFlow }),
      crons: [{ schedule: '* * * * * *', flow: 'quick-flow' }], // every second (croner supports 6 fields)
    }

    startScheduler(config)

    // Wait for cron to fire
    await new Promise((r) => setTimeout(r, 1500))
    stopScheduler()

    const db = getDb()
    const runs = await db.select().from(flowRuns).where(eq(flowRuns.flowName, 'quick-flow'))
    assert.isAbove(runs.length, 0)
    assert.equal(runs[0].shop, '__global__')
  }).timeout(5000)

  test('skips unknown flow without crashing', async ({ assert }) => {
    const config = {
      ...createConfig({ 'quick-flow': quickFlow }),
      crons: [{ schedule: '* * * * *', flow: 'nonexistent' }],
    }

    // Should not throw
    startScheduler(config)
    stopScheduler()
    assert.isTrue(true)
  })

  test('resolves shops=all from installations', async ({ assert }) => {
    const db = getDb()
    await db.insert(installations).values([
      { shop: 'shop-a.myshopify.com', accessToken: 'tok-a', scopes: 'read_products' },
      { shop: 'shop-b.myshopify.com', accessToken: 'tok-b', scopes: 'read_products' },
    ])

    const config = {
      ...createConfig({ 'quick-flow': { ...quickFlow, concurrency: 'allow' as const } }),
      crons: [{ schedule: '* * * * * *', flow: 'quick-flow', shops: 'all' as const }],
    }

    startScheduler(config)
    await new Promise((r) => setTimeout(r, 1500))
    stopScheduler()

    const runs = await db.select().from(flowRuns).where(eq(flowRuns.flowName, 'quick-flow'))
    const shops = [...new Set(runs.map((r) => r.shop))]
    assert.includeMembers(shops, ['shop-a.myshopify.com', 'shop-b.myshopify.com'])
  }).timeout(5000)

  test('respects cron override (disabled)', async ({ assert }) => {
    const db = getDb()
    await db.insert(cronOverrides).values({
      shop: '__global__',
      cronKey: 'quick-flow:* * * * * *',
      enabled: false,
    })

    const config = {
      ...createConfig({ 'quick-flow': quickFlow }),
      crons: [{ schedule: '* * * * * *', flow: 'quick-flow' }],
    }

    startScheduler(config)
    await new Promise((r) => setTimeout(r, 1500))
    stopScheduler()

    const runs = await db.select().from(flowRuns).where(eq(flowRuns.flowName, 'quick-flow'))
    assert.equal(runs.length, 0) // Should not have dispatched
  }).timeout(5000)

  test('stopScheduler clears all crons', async ({ assert }) => {
    const config = {
      ...createConfig({ 'quick-flow': quickFlow }),
      crons: [{ schedule: '* * * * * *', flow: 'quick-flow' }],
    }

    startScheduler(config)
    stopScheduler()

    // Wait to make sure no cron fires after stop
    await new Promise((r) => setTimeout(r, 1500))

    const db = getDb()
    const runs = await db.select().from(flowRuns).where(eq(flowRuns.flowName, 'quick-flow'))
    assert.equal(runs.length, 0)
  }).timeout(5000)

  test('resolves shops as string (single shop)', async ({ assert }) => {
    const config = {
      ...createConfig({ 'quick-flow': quickFlow }),
      crons: [{ schedule: '* * * * * *', flow: 'quick-flow', shops: 'specific.myshopify.com' }],
    }

    startScheduler(config)
    await new Promise((r) => setTimeout(r, 1500))
    stopScheduler()

    const db = getDb()
    const runs = await db.select().from(flowRuns).where(eq(flowRuns.flowName, 'quick-flow'))
    assert.isAbove(runs.length, 0)
    assert.equal(runs[0].shop, 'specific.myshopify.com')
  }).timeout(5000)

  test('resolves shops as array', async ({ assert }) => {
    const config = {
      ...createConfig({ 'quick-flow': { ...quickFlow, concurrency: 'allow' as const } }),
      crons: [{ schedule: '* * * * * *', flow: 'quick-flow', shops: ['shop-x.myshopify.com', 'shop-y.myshopify.com'] }],
    }

    startScheduler(config)
    await new Promise((r) => setTimeout(r, 1500))
    stopScheduler()

    const db = getDb()
    const runs = await db.select().from(flowRuns).where(eq(flowRuns.flowName, 'quick-flow'))
    const shops = [...new Set(runs.map((r) => r.shop))]
    assert.includeMembers(shops, ['shop-x.myshopify.com', 'shop-y.myshopify.com'])
  }).timeout(5000)
})
