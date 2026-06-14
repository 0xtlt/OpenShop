import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defineOpenShop } from '../../../src/index.ts'
import {
  DEFAULT_SHOPIFY_APP_HANDLE,
  resolveShopifyAppByApiKey,
  resolveShopifyAppByHandle,
  resolveShopifyAppBySignedQuery,
  resolveShopifyAppByWebhookHmac,
  resolveShopifyApps,
} from '../../../src/server/shopify-apps.ts'

const app = defineOpenShop({ providers: {} })
const flow = app.defineFlow({ name: 'noop', async run() {} })

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'openshop-apps-'))
}

function signQuery(params: Record<string, string>, secret: string): Record<string, string> {
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
  return { ...params, hmac: createHmac('sha256', secret).update(message).digest('hex') }
}

test.group('shopify app resolver', () => {
  test('resolves legacy env-based app when shopify.apps is absent', ({ assert }) => {
    const previousKey = process.env.SHOPIFY_API_KEY
    const previousSecret = process.env.SHOPIFY_API_SECRET
    process.env.SHOPIFY_API_KEY = 'legacy-key'
    process.env.SHOPIFY_API_SECRET = 'legacy-secret'

    try {
      const config = app.defineConfig({ flows: { noop: flow } })
      const [resolvedApp] = resolveShopifyApps(config)
      assert.equal(resolvedApp.handle, DEFAULT_SHOPIFY_APP_HANDLE)
      assert.equal(resolvedApp.apiKey, 'legacy-key')
      assert.equal(resolvedApp.apiSecret, 'legacy-secret')
    } finally {
      process.env.SHOPIFY_API_KEY = previousKey
      process.env.SHOPIFY_API_SECRET = previousSecret
    }
  })

  test('resolves TOML and config-only apps', ({ assert }) => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'shopify.app.client-a.toml'), `
client_id = "client-a-key"
application_url = "https://client-a.example.com"

[access_scopes]
scopes = "read_products,read_orders"
`)

      const config = app.defineConfig({
        shopify: {
          apps: {
            clientA: { toml: 'shopify.app.client-a.toml', apiSecret: 'secret-a' },
            clientB: { apiKey: 'client-b-key', apiSecret: 'secret-b', appUrl: 'https://client-b.example.com' },
          },
          scopes: 'read_products,read_orders',
        },
        flows: { noop: flow },
      })

      const apps = resolveShopifyApps(config, dir)
      assert.lengthOf(apps, 2)
      assert.equal(resolveShopifyAppByHandle(config, 'clientA', dir).apiKey, 'client-a-key')
      assert.equal(resolveShopifyAppByApiKey(config, 'client-b-key', dir).handle, 'clientB')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('rejects app-level scopes', ({ assert }) => {
    assert.throws(() => app.defineConfig({
      shopify: {
        apps: {
          bad: {
            apiKey: 'key',
            apiSecret: 'secret',
            scopes: 'read_products',
          } as never,
        },
      },
      flows: { noop: flow },
    }), /shopify\.apps\.bad\.scopes is not supported/)
  })

  test('resolves signed OAuth and webhook requests against the matching app secret', ({ assert }) => {
    const config = app.defineConfig({
      shopify: {
        scopes: 'read_products',
        apps: {
          clientA: { apiKey: 'client-a-key', apiSecret: 'secret-a', appUrl: 'https://client-a.example.com' },
          clientB: { apiKey: 'client-b-key', apiSecret: 'secret-b', appUrl: 'https://client-b.example.com' },
        },
      },
      flows: { noop: flow },
    })

    const query = signQuery({ shop: 'x.myshopify.com', timestamp: '1780000000' }, 'secret-b')
    assert.equal(resolveShopifyAppBySignedQuery(config, query).handle, 'clientB')

    const body = '{"id":1}'
    const hmac = createHmac('sha256', 'secret-a').update(body, 'utf8').digest('base64')
    assert.equal(resolveShopifyAppByWebhookHmac(config, body, hmac).handle, 'clientA')
  })

  test('throws explicit errors when no app or multiple apps match', ({ assert }) => {
    const config = app.defineConfig({
      shopify: {
        scopes: 'read_products',
        apps: {
          clientA: { apiKey: 'duplicate-key', apiSecret: 'shared-secret', appUrl: 'https://client-a.example.com' },
          clientB: { apiKey: 'duplicate-key', apiSecret: 'shared-secret', appUrl: 'https://client-b.example.com' },
        },
      },
      flows: { noop: flow },
    })

    assert.throws(() => resolveShopifyAppByApiKey(config, 'missing-key'), /No Shopify app matches/)
    assert.throws(() => resolveShopifyAppByApiKey(config, 'duplicate-key'), /Multiple Shopify apps use apiKey/)

    const query = signQuery({ shop: 'x.myshopify.com', timestamp: '1780000000' }, 'shared-secret')
    assert.throws(() => resolveShopifyAppBySignedQuery(config, query), /Multiple Shopify apps matched/)
  })

  test('does not resolve legacy signed requests when SHOPIFY_API_SECRET is missing', ({ assert }) => {
    const previousSecret = process.env.SHOPIFY_API_SECRET
    delete process.env.SHOPIFY_API_SECRET

    try {
      const config = app.defineConfig({ flows: { noop: flow } })
      const query = signQuery({ shop: 'x.myshopify.com', timestamp: '1780000000' }, '')
      const body = '{"id":1}'
      const hmac = createHmac('sha256', '').update(body, 'utf8').digest('base64')

      assert.throws(() => resolveShopifyAppBySignedQuery(config, query), /No Shopify app matched/)
      assert.throws(() => resolveShopifyAppByWebhookHmac(config, body, hmac), /No Shopify app matched/)
    } finally {
      process.env.SHOPIFY_API_SECRET = previousSecret
    }
  })
})
