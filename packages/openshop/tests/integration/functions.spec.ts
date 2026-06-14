import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { type } from 'arktype'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import { createServer } from '#server/index'
import type { FunctionDefinition } from '#types'
import { createConfig, TEST_SHOP, truncateAll } from './helpers.ts'

const SECRET = process.env.SHOPIFY_API_SECRET!

interface GraphqlCall {
  url: string
  accessToken: string | null
  query: string
  variables?: Record<string, unknown>
}

function createJwt(shop = TEST_SHOP): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: 'test-app',
    sub: '123',
    exp: now + 3600,
    nbf: now - 10,
    iat: now,
    jti: 'jti-test',
    sid: 'sid-test',
  })).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const functions = {
  discount: {
    type: 'discount',
    handle: 'volume-discount',
    modes: ['automatic', 'code'],
    owner: {
      title: (config) => `Volume ${config.percent}`,
      combinesWith: { productDiscounts: true },
    },
    config: {
      percent: { type: 'number', label: 'Percent', validate: type('number >= 0') },
    },
  },
  cartTransform: {
    type: 'cart-transform',
    handle: 'cart-transform',
    config: {
      message: { type: 'text', label: 'Message' },
    },
  },
  fulfillmentConstraints: {
    type: 'fulfillment-constraints',
    handle: 'fulfillment-rules',
    config: {
      message: { type: 'text', label: 'Message' },
    },
  },
  deliveryCustomization: {
    type: 'delivery-customization',
    handle: 'delivery-rules',
    owner: { title: 'Delivery rules' },
    config: {
      message: { type: 'text', label: 'Message' },
    },
  },
  paymentCustomization: {
    type: 'payment-customization',
    handle: 'payment-rules',
    owner: { title: 'Payment rules' },
    config: {
      message: { type: 'text', label: 'Message' },
    },
  },
  checkoutValidation: {
    type: 'checkout-validation',
    handle: 'checkout-validation',
    owner: { title: 'Checkout validation' },
    config: {
      message: { type: 'text', label: 'Message' },
    },
  },
} satisfies Record<string, FunctionDefinition<any>>

function mutationKey(query: string): string {
  const keys = [
    'discountAutomaticAppCreate',
    'discountCodeAppCreate',
    'cartTransformCreate',
    'fulfillmentConstraintRuleCreate',
    'deliveryCustomizationCreate',
    'paymentCustomizationCreate',
    'validationCreate',
    'discountAutomaticAppUpdate',
    'discountCodeAppUpdate',
    'deliveryCustomizationUpdate',
    'paymentCustomizationUpdate',
    'validationUpdate',
    'discountAutomaticDelete',
    'discountCodeDelete',
    'cartTransformDelete',
    'fulfillmentConstraintRuleDelete',
    'deliveryCustomizationDelete',
    'paymentCustomizationDelete',
    'validationDelete',
  ]
  return keys.find((key) => query.includes(key)) ?? 'unknownMutation'
}

test.group('API Shopify functions', (group) => {
  let app: Awaited<ReturnType<typeof createServer>>
  let originalFetch: typeof globalThis.fetch
  let graphqlCalls: GraphqlCall[] = []
  let nextUserErrors: Array<{ field: string; message: string }> | null = null

  group.setup(async () => {
    const config = createConfig({}, { functions })
    app = await createServer(() => config)
  })

  group.each.setup(async () => {
    await truncateAll()
    await getDb().insert(installations).values({
      shop: TEST_SHOP,
      accessToken: 'test-access-token',
      scopes: 'read_products,write_discounts',
    })

    graphqlCalls = []
    nextUserErrors = null
    originalFetch = globalThis.fetch
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Omit<GraphqlCall, 'url' | 'accessToken'>
      const headers = new Headers(init?.headers)
      graphqlCalls.push({
        url: String(_input),
        accessToken: headers.get('X-Shopify-Access-Token'),
        ...body,
      })

      if (body.query.includes('ListDiscountInstances')) {
        return Response.json({
          data: {
            discountNodes: {
              nodes: [{
                id: 'gid://shopify/DiscountNode/1',
                discount: {
                  title: 'Volume 10',
                  status: 'ACTIVE',
                  startsAt: '2026-01-01T00:00:00Z',
                  endsAt: null,
                },
                metafield: { value: JSON.stringify({ percent: 10 }) },
              }],
            },
          },
        })
      }

      if (body.query.includes('deliveryCustomizations')) {
        return Response.json({
          data: {
            deliveryCustomizations: {
              nodes: [{
                id: 'gid://shopify/DeliveryCustomization/1',
                title: 'Delivery rules',
                enabled: true,
                metafield: { value: JSON.stringify({ message: 'ship it' }) },
              }],
            },
          },
        })
      }

      const key = mutationKey(body.query)
      const userErrors = nextUserErrors ?? []
      nextUserErrors = null

      return Response.json({
        data: {
          [key]: {
            userErrors,
            automaticAppDiscount: { discountId: 'gid://shopify/Discount/automatic' },
            codeAppDiscount: { discountId: 'gid://shopify/Discount/code' },
            cartTransform: { id: 'gid://shopify/CartTransform/1' },
            fulfillmentConstraintRule: { id: 'gid://shopify/FulfillmentConstraintRule/1' },
            deliveryCustomization: { id: 'gid://shopify/DeliveryCustomization/1' },
            paymentCustomization: { id: 'gid://shopify/PaymentCustomization/1' },
            validation: { id: 'gid://shopify/Validation/1' },
          },
        },
      })
    }

    return () => {
      globalThis.fetch = originalFetch
    }
  })

  const req = (path: string, opts: RequestInit = {}) => {
    const headers = new Headers(opts.headers)
    headers.set('Authorization', `Bearer ${createJwt()}`)
    if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    return app.request(path, { ...opts, headers })
  }

  const reqAs = (shop: string, path: string, opts: RequestInit = {}) => {
    const headers = new Headers(opts.headers)
    headers.set('Authorization', `Bearer ${createJwt(shop)}`)
    if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    return app.request(path, { ...opts, headers })
  }

  const jsonReq = (method: string, path: string, body: Record<string, unknown>) => {
    return req(path, { method, body: JSON.stringify(body) })
  }

  const lastCall = () => graphqlCalls[graphqlCalls.length - 1]

  test('lists function definitions without calling Shopify', async ({ assert }) => {
    const res = await req('/api/functions')

    assert.equal(res.status, 200)
    const data = await res.json()
    assert.isArray(data)
    assert.lengthOf(data, 6)
    assert.equal(data.find((def: { handle: string }) => def.handle === 'cart-transform').supportsUpdate, false)
    assert.equal(data.find((def: { handle: string }) => def.handle === 'delivery-rules').supportsUpdate, true)
    assert.notProperty(data.find((def: { handle: string }) => def.handle === 'volume-discount').fields.percent, 'validate')
    assert.lengthOf(graphqlCalls, 0)
  })

  test('lists discount instances from Shopify', async ({ assert }) => {
    const res = await req('/api/functions/volume-discount/instances')

    assert.equal(res.status, 200)
    const data = await res.json()
    assert.deepInclude(data, {
      id: 'gid://shopify/DiscountNode/1',
      title: 'Volume 10',
      status: 'ACTIVE',
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: null,
      config: { percent: 10 },
    })
    assert.include(lastCall().query, 'ListDiscountInstances')
    assert.deepEqual(lastCall().variables, { query: 'function_handle:volume-discount' })
  })

  test('lists generic non-discount instances from Shopify', async ({ assert }) => {
    const res = await req('/api/functions/delivery-rules/instances')

    assert.equal(res.status, 200)
    const data = await res.json()
    assert.deepInclude(data, {
      id: 'gid://shopify/DeliveryCustomization/1',
      title: 'Delivery rules',
      enabled: true,
      config: { message: 'ship it' },
    })
    assert.include(lastCall().query, 'deliveryCustomizations')
  })

  test('uses the JWT shop installation for Shopify function reads and writes', async ({ assert }) => {
    await getDb().insert(installations).values({
      shop: 'functions-shop-b.myshopify.com',
      accessToken: 'token-b',
      scopes: 'write_discounts',
    })

    const list = await reqAs('functions-shop-b.myshopify.com', '/api/functions/volume-discount/instances')
    assert.equal(list.status, 200)
    assert.include(lastCall().url, 'https://functions-shop-b.myshopify.com/admin/api/')
    assert.equal(lastCall().accessToken, 'token-b')

    const foreignId = encodeURIComponent('gid://shopify/DiscountNode/other-shop')
    const update = await reqAs('functions-shop-b.myshopify.com', `/api/functions/volume-discount/instances/${foreignId}?mode=code`, {
      method: 'PUT',
      body: JSON.stringify({ mode: 'code', config: { percent: 20 } }),
    })
    assert.equal(update.status, 200)
    assert.include(lastCall().query, 'discountCodeAppUpdate')
    assert.include(lastCall().url, 'https://functions-shop-b.myshopify.com/admin/api/')
    assert.equal(lastCall().accessToken, 'token-b')
    assert.deepInclude(lastCall().variables ?? {}, { id: 'gid://shopify/DiscountNode/other-shop' })

    const del = await reqAs('functions-shop-b.myshopify.com', `/api/functions/volume-discount/instances/${foreignId}?mode=code`, {
      method: 'DELETE',
    })
    assert.equal(del.status, 200)
    assert.include(lastCall().query, 'discountCodeDelete')
    assert.include(lastCall().url, 'https://functions-shop-b.myshopify.com/admin/api/')
    assert.equal(lastCall().accessToken, 'token-b')
    assert.deepEqual(lastCall().variables, { id: 'gid://shopify/DiscountNode/other-shop' })
  })

  test('creates discount instances for automatic and code modes', async ({ assert }) => {
    const automatic = await jsonReq('POST', '/api/functions/volume-discount/instances', {
      mode: 'automatic',
      startsAt: '2026-01-01T00:00:00Z',
      config: { percent: 10 },
    })
    assert.equal(automatic.status, 201)
    assert.include(lastCall().query, 'discountAutomaticAppCreate')
    assert.deepInclude((lastCall().variables as { input: Record<string, unknown> }).input, {
      functionHandle: 'volume-discount',
      title: 'Volume 10',
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: null,
      combinesWith: { productDiscounts: true },
    })

    const code = await jsonReq('POST', '/api/functions/volume-discount/instances', {
      mode: 'code',
      code: 'SAVE10',
      usageLimit: 5,
      config: { percent: 10 },
    })
    assert.equal(code.status, 201)
    assert.include(lastCall().query, 'discountCodeAppCreate')
    assert.deepInclude((lastCall().variables as { input: Record<string, unknown> }).input, {
      functionHandle: 'volume-discount',
      title: 'Volume 10',
      code: 'SAVE10',
      usageLimit: 5,
      combinesWith: { productDiscounts: true },
    })
  })

  test('creates flat and wrapped non-discount instances', async ({ assert }) => {
    const cart = await jsonReq('POST', '/api/functions/cart-transform/instances', {
      blockOnFailure: true,
      config: { message: 'cart' },
    })
    assert.equal(cart.status, 201)
    assert.include(lastCall().query, 'cartTransformCreate')
    assert.deepEqual(lastCall().variables, {
      functionHandle: 'cart-transform',
      blockOnFailure: true,
      metafields: [{ namespace: '$app:openshop', key: 'cart-transform', type: 'json', value: JSON.stringify({ message: 'cart' }) }],
    })

    const fulfillment = await jsonReq('POST', '/api/functions/fulfillment-rules/instances', {
      deliveryMethodTypes: ['SHIPPING', 'PICK_UP'],
      config: { message: 'fulfillment' },
    })
    assert.equal(fulfillment.status, 201)
    assert.include(lastCall().query, 'fulfillmentConstraintRuleCreate')
    assert.deepInclude(lastCall().variables ?? {}, {
      functionHandle: 'fulfillment-rules',
      deliveryMethodTypes: ['SHIPPING', 'PICK_UP'],
    })

    const delivery = await jsonReq('POST', '/api/functions/delivery-rules/instances', {
      config: { message: 'delivery' },
    })
    assert.equal(delivery.status, 201)
    assert.include(lastCall().query, 'deliveryCustomizationCreate')
    assert.deepInclude((lastCall().variables as { input: Record<string, unknown> }).input, {
      functionHandle: 'delivery-rules',
      title: 'Delivery rules',
      enabled: true,
    })

    const payment = await jsonReq('POST', '/api/functions/payment-rules/instances', {
      config: { message: 'payment' },
    })
    assert.equal(payment.status, 201)
    assert.include(lastCall().query, 'paymentCustomizationCreate')

    const validation = await jsonReq('POST', '/api/functions/checkout-validation/instances', {
      blockOnFailure: true,
      config: { message: 'validation' },
    })
    assert.equal(validation.status, 201)
    assert.include(lastCall().query, 'validationCreate')
    assert.deepInclude((lastCall().variables as { input: Record<string, unknown> }).input, {
      functionHandle: 'checkout-validation',
      title: 'Checkout validation',
      enable: true,
      blockOnFailure: true,
    })
  })

  test('updates supported instances from a single parsed body', async ({ assert }) => {
    const automatic = await jsonReq('PUT', '/api/functions/volume-discount/instances/discount-1', {
      mode: 'automatic',
      startsAt: '2026-01-01T00:00:00Z',
      config: { percent: 15 },
    })
    assert.equal(automatic.status, 200)
    assert.include(lastCall().query, 'discountAutomaticAppUpdate')
    assert.deepInclude((lastCall().variables as { input: Record<string, unknown> }).input, {
      title: 'Volume 15',
      startsAt: '2026-01-01T00:00:00Z',
      combinesWith: { productDiscounts: true },
    })

    const code = await jsonReq('PUT', '/api/functions/volume-discount/instances/discount-2', {
      mode: 'code',
      usageLimit: 12,
      config: { percent: 20 },
    })
    assert.equal(code.status, 200)
    assert.include(lastCall().query, 'discountCodeAppUpdate')
    assert.deepInclude((lastCall().variables as { input: Record<string, unknown> }).input, {
      title: 'Volume 20',
      usageLimit: 12,
    })

    const delivery = await jsonReq('PUT', '/api/functions/delivery-rules/instances/delivery-1', {
      enabled: false,
      config: { message: 'delivery' },
    })
    assert.equal(delivery.status, 200)
    assert.include(lastCall().query, 'deliveryCustomizationUpdate')
    assert.deepInclude((lastCall().variables as { input: Record<string, unknown> }).input, {
      title: 'Delivery rules',
      enabled: false,
    })

    const payment = await jsonReq('PUT', '/api/functions/payment-rules/instances/payment-1', {
      enabled: true,
      config: { message: 'payment' },
    })
    assert.equal(payment.status, 200)
    assert.include(lastCall().query, 'paymentCustomizationUpdate')

    const validation = await jsonReq('PUT', '/api/functions/checkout-validation/instances/validation-1', {
      enabled: true,
      blockOnFailure: true,
      config: { message: 'validation' },
    })
    assert.equal(validation.status, 200)
    assert.include(lastCall().query, 'validationUpdate')
    assert.deepInclude((lastCall().variables as { input: Record<string, unknown> }).input, {
      title: 'Checkout validation',
      enable: true,
      blockOnFailure: true,
    })
  })

  test('rejects unsupported updates', async ({ assert }) => {
    const res = await jsonReq('PUT', '/api/functions/cart-transform/instances/cart-1', {
      config: { message: 'cart' },
    })
    const body = await res.json()

    assert.equal(res.status, 400)
    assert.include(body.error, 'does not support update')
    assert.lengthOf(graphqlCalls, 0)
  })

  test('deletes mapped function instances', async ({ assert }) => {
    const delivery = await req('/api/functions/delivery-rules/instances/delivery-1', {
      method: 'DELETE',
    })
    assert.equal(delivery.status, 200)
    assert.include(lastCall().query, 'deliveryCustomizationDelete')
    assert.deepEqual(lastCall().variables, { id: 'delivery-1' })

    const codeDiscount = await req('/api/functions/volume-discount/instances/discount-2?mode=code', {
      method: 'DELETE',
    })
    assert.equal(codeDiscount.status, 200)
    assert.include(lastCall().query, 'discountCodeDelete')
  })

  test('requires mode when deleting multi-mode discounts', async ({ assert }) => {
    const res = await req('/api/functions/volume-discount/instances/discount-2', {
      method: 'DELETE',
    })
    const body = await res.json()

    assert.equal(res.status, 400)
    assert.include(body.error, 'mode')
    assert.lengthOf(graphqlCalls, 0)
  })

  test('returns errors for unknown functions and invalid config', async ({ assert }) => {
    const missing = await req('/api/functions/missing/instances')
    assert.equal(missing.status, 404)

    const invalid = await jsonReq('POST', '/api/functions/volume-discount/instances', {
      config: { percent: -1 },
    })
    const body = await invalid.json()
    assert.equal(invalid.status, 400)
    assert.include(body.error, 'Field "percent"')
  })

  test('surfaces Shopify userErrors', async ({ assert }) => {
    nextUserErrors = [{ field: 'title', message: 'Title is invalid' }]

    const res = await jsonReq('POST', '/api/functions/delivery-rules/instances', {
      config: { message: 'delivery' },
    })
    const body = await res.json()

    assert.equal(res.status, 400)
    assert.equal(body.error, 'Title is invalid')
    assert.deepEqual(body.userErrors, [{ field: 'title', message: 'Title is invalid' }])
  })
})
