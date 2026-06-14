import { test } from '@japa/runner'
import { type } from 'arktype'
import { defineConfig, defineFlow, defineFunction, defineProvider } from '../../../src/index.ts'

const flow = defineFlow({
  name: 'sync',
  async run() {},
})

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

test.group('defineConfig validation', () => {
  test('accepts a valid config', ({ assert }) => {
    const config = defineConfig({
      providers: { warehouse: provider },
      flows: { sync: flow },
      crons: [{ schedule: '*/5 * * * *', flow: 'sync' }],
      worker: { concurrency: 2 },
      retryPolicy: { maxAttempts: 3 },
    })

    assert.equal(config.flows.sync.name, 'sync')
  })

  test('rejects crons that reference an unknown flow', ({ assert }) => {
    assert.throws(() => defineConfig({
      providers: {},
      flows: { sync: flow },
      crons: [{ schedule: '*/5 * * * *', flow: 'missing' }],
    }), /unknown flow "missing"/)
  })

  test('rejects duplicate Shopify Function handles', ({ assert }) => {
    const first = defineFunction({
      type: 'discount',
      handle: 'volume-discount',
      config: { threshold: { type: 'number', label: 'Threshold' } },
    })
    const second = defineFunction({
      type: 'discount',
      handle: 'volume-discount',
      config: { threshold: { type: 'number', label: 'Threshold' } },
    })

    assert.throws(() => defineConfig({
      providers: {},
      flows: { sync: flow },
      functions: { first, second },
    }), /duplicates "volume-discount"/)
  })

  test('rejects invalid worker numbers', ({ assert }) => {
    assert.throws(() => defineConfig({
      providers: {},
      flows: { sync: flow },
      worker: { concurrency: 0 },
    }), /worker\.concurrency must be a positive integer/)
  })
})
