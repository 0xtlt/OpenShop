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

  test('accepts MCP custom permissions, tools and resources', ({ assert }) => {
    const config = emptyApp.defineConfig({
      flows: { sync: flow },
      mcp: {
        permissions: {
          custom: {
            'warehouse:read_inventory': { label: 'Read inventory' },
          },
        },
        tools: {
          'warehouse.inventory.list': {
            description: 'List inventory',
            requiredPermissions: ['warehouse:read_inventory'],
            run: () => 'ok',
          },
        },
        resources: {
          'openshop://warehouse/inventory': {
            name: 'Inventory help',
            requiredPermissions: ['warehouse:read_inventory'],
            read: () => 'ok',
          },
        },
      },
    })

    assert.equal(config.mcp?.tools?.['warehouse.inventory.list'].description, 'List inventory')
  })

  test('rejects invalid MCP custom permission keys', ({ assert }) => {
    assert.throws(() => emptyApp.defineConfig({
      flows: { sync: flow },
      mcp: {
        permissions: {
          custom: {
            admin: { label: 'Everything' },
          },
        },
      },
    }), /custom permission "admin" must use namespace:action_resource|permission "admin" is not allowed/)
  })

  test('rejects MCP custom permissions that collide with core permissions', ({ assert }) => {
    assert.throws(() => emptyApp.defineConfig({
      flows: { sync: flow },
      mcp: {
        permissions: {
          custom: {
            read_logs: { label: 'Shadow logs' },
          },
        },
      },
    }), /custom permission "read_logs" must use namespace:action_resource/)
  })

  test('rejects MCP tools that collide with core tools', ({ assert }) => {
    assert.throws(() => emptyApp.defineConfig({
      flows: { sync: flow },
      mcp: {
        tools: {
          'openshop.logs.search': {
            description: 'Shadow log search',
            requiredPermissions: ['read_logs'],
            run: () => 'ok',
          },
        },
      },
    }), /conflicts with a core tool/)
  })

  test('rejects MCP resources that collide with core resources', ({ assert }) => {
    assert.throws(() => emptyApp.defineConfig({
      flows: { sync: flow },
      mcp: {
        resources: {
          'openshop://permissions': {
            name: 'Shadow permissions',
            requiredPermissions: [],
            read: () => 'ok',
          },
        },
      },
    }), /conflicts with a core resource/)
  })

  test('rejects MCP wildcard permission keys', ({ assert }) => {
    assert.throws(() => emptyApp.defineConfig({
      flows: { sync: flow },
      mcp: {
        permissions: {
          custom: {
            '*': { label: 'Everything' },
          },
        },
      },
    }), /permission "\*" is not allowed/)
  })

  test('rejects MCP tools that reference unknown permissions', ({ assert }) => {
    assert.throws(() => emptyApp.defineConfig({
      flows: { sync: flow },
      mcp: {
        tools: {
          'warehouse.inventory.list': {
            description: 'List inventory',
            requiredPermissions: ['warehouse:read_inventory'],
            run: () => 'ok',
          },
        },
      },
    }), /references unknown permission "warehouse:read_inventory"/)
  })
})
