import { test } from '@japa/runner'
import { type } from 'arktype'
import { defineOpenShop, defineProvider } from '../../../src/index.ts'

const provider = defineProvider({
  name: 'warehouse',
  ui: {
    fields: {
      apiUrl: { type: 'text', label: 'API URL', validate: type('string') },
    },
  },
  methods: {
    async push(_data: unknown[]) {},
  },
})

const app = defineOpenShop({ providers: { warehouse: provider } })
const emptyApp = defineOpenShop({ providers: {} })

const flow = app.defineFlow({
  name: 'sync',
  async run() {},
})

test.group('defineOpenShop config validation', () => {
  test('accepts a valid config', ({ assert }) => {
    const config = app.defineConfig({
      flows: { sync: flow },
      crons: [{ schedule: '*/5 * * * *', flow: 'sync' }],
      worker: { concurrency: 2 },
      retryPolicy: { maxAttempts: 3 },
    })

    assert.equal(config.flows.sync.name, 'sync')
  })

  test('rejects crons that reference an unknown flow', ({ assert }) => {
    assert.throws(() => emptyApp.defineConfig({
      flows: { sync: flow },
      crons: [{ schedule: '*/5 * * * *', flow: 'missing' }],
    }), /unknown flow "missing"/)
  })

  test('rejects duplicate Shopify Function handles', ({ assert }) => {
    const first = emptyApp.defineFunction({
      type: 'discount',
      handle: 'volume-discount',
      config: { threshold: { type: 'number', label: 'Threshold' } },
    })
    const second = emptyApp.defineFunction({
      type: 'discount',
      handle: 'volume-discount',
      config: { threshold: { type: 'number', label: 'Threshold' } },
    })

    assert.throws(() => emptyApp.defineConfig({
      flows: { sync: flow },
      functions: { first, second },
    }), /duplicates "volume-discount"/)
  })

  test('rejects invalid worker numbers', ({ assert }) => {
    assert.throws(() => emptyApp.defineConfig({
      flows: { sync: flow },
      worker: { concurrency: 0 },
    }), /worker\.concurrency must be a positive integer/)
  })
})
