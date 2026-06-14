import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { createServer } from '#server/index'
import { truncateAll, createConfig } from './helpers.ts'

const SECRET = process.env.SHOPIFY_API_SECRET!
const MULTI_SHOPIFY = {
  scopes: 'read_products',
  apps: {
    clientA: {
      apiKey: 'client-a-key',
      apiSecret: 'client-a-secret',
      appUrl: 'https://client-a.example.test',
    },
    clientB: {
      apiKey: 'client-b-key',
      apiSecret: 'client-b-secret',
      appUrl: 'https://client-b.example.test',
    },
  },
}

const simpleFlow = { name: 'wh-flow', async run() {} }

function signBody(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64')
}

test.group('Webhooks HTTP', (group) => {
  let app: Awaited<ReturnType<typeof createServer>>
  let handlerCalls = 0

  group.setup(async () => {
    const config = createConfig({ 'wh-flow': simpleFlow }, {
      webhooks: {
        ORDERS_CREATE: {
          run: async () => {
            handlerCalls += 1
          },
        },
      },
    })
    app = await createServer(() => config)
  })

  group.each.setup(async () => {
    await truncateAll()
    handlerCalls = 0
  })

  test('POST /webhooks with invalid HMAC returns 401', async ({ assert }) => {
    const body = '{}'
    const res = await app.request('http://localhost/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shopify-hmac-sha256': 'invalid',
        'x-shopify-topic': 'orders/create',
        'x-shopify-shop-domain': 'test.myshopify.com',
        'x-shopify-api-version': '2024-01',
      },
      body,
    })
    assert.equal(res.status, 401)
    assert.equal(handlerCalls, 0)
  })

  test('POST /webhooks with unknown topic returns 200 without invoking handler', async ({ assert }) => {
    const body = '{"id":1}'
    const res = await app.request('http://localhost/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shopify-hmac-sha256': signBody(body),
        'x-shopify-topic': 'products/update',
        'x-shopify-shop-domain': 'test.myshopify.com',
        'x-shopify-api-version': '2024-01',
      },
      body,
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ok, true)
    assert.equal(handlerCalls, 0)
  })

  test('POST /webhooks invokes handler for registered topic', async ({ assert }) => {
    const body = '{"id":999,"name":"order"}'
    const res = await app.request('http://localhost/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shopify-hmac-sha256': signBody(body),
        'x-shopify-topic': 'orders/create',
        'x-shopify-shop-domain': 'shop-hooks.myshopify.com',
        'x-shopify-api-version': '2024-01',
      },
      body,
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ok, true)
    assert.equal(handlerCalls, 1)
  })

  test('POST /webhooks resolves the matching Shopify app from HMAC', async ({ assert }) => {
    let receivedShopifyApp: string | null = null
    const multiApp = await createServer(() => createConfig({ 'wh-flow': simpleFlow }, {
      shopify: MULTI_SHOPIFY,
      webhooks: {
        ORDERS_CREATE: {
          run: async ({ shopifyApp }) => {
            receivedShopifyApp = shopifyApp
          },
        },
      },
    }))

    const body = '{"id":1000,"name":"order"}'
    const res = await multiApp.request('http://localhost/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shopify-hmac-sha256': signBody(body, 'client-b-secret'),
        'x-shopify-topic': 'orders/create',
        'x-shopify-shop-domain': 'client-b-shop.myshopify.com',
        'x-shopify-api-version': '2026-04',
      },
      body,
    })
    assert.equal(res.status, 200)
    assert.equal(receivedShopifyApp, 'clientB')
  })

  test('POST /webhooks without SHOPIFY_API_SECRET returns 500', async ({ assert }) => {
    const previous = process.env.SHOPIFY_API_SECRET
    delete process.env.SHOPIFY_API_SECRET
    try {
      const missingSecretApp = await createServer(() => createConfig({ 'wh-flow': simpleFlow }))
      const res = await missingSecretApp.request('http://localhost/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shopify-hmac-sha256': 'anything',
          'x-shopify-topic': 'orders/create',
          'x-shopify-shop-domain': 'test.myshopify.com',
          'x-shopify-api-version': '2024-01',
        },
        body: '{}',
      })
      assert.equal(res.status, 500)
    } finally {
      process.env.SHOPIFY_API_SECRET = previous
    }
  })
})
