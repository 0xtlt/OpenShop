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

const optionalMessage = {
  message: { type: 'text', label: 'Message', required: false },
} as const

const functions = {
  discount: {
    type: 'discount',
    handle: 'volume-discount',
    modes: ['automatic', 'code'],
    defaults: {
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
    label: 'Bundle Builder',
    defaults: { blockOnFailure: false },
  },
  fulfillmentConstraints: {
    type: 'fulfillment-constraints',
    handle: 'fulfillment-rules',
    defaults: { deliveryMethodTypes: ['SHIPPING'] },
    config: optionalMessage,
    ui: { configurationPath: '/bundles/:id', configurationLabel: 'Configure bundle' },
  },
  deliveryCustomization: {
    type: 'delivery-customization',
    handle: 'delivery-rules',
    defaults: { title: 'Delivery rules', enabled: true },
    config: optionalMessage,
  },
  paymentCustomization: {
    type: 'payment-customization',
    handle: 'payment-rules',
    defaults: { title: 'Payment rules', enabled: true },
    config: optionalMessage,
  },
  checkoutValidation: {
    type: 'checkout-validation',
    handle: 'checkout-validation',
    defaults: { title: 'Checkout validation', enabled: true, blockOnFailure: false },
    config: optionalMessage,
  },
} satisfies Record<string, FunctionDefinition<any>>

function mutationKey(query: string): string {
  const keys = [
    'discountAutomaticAppCreate', 'discountCodeAppCreate',
    'cartTransformCreate', 'fulfillmentConstraintRuleCreate',
    'deliveryCustomizationCreate', 'paymentCustomizationCreate', 'validationCreate',
    'discountAutomaticAppUpdate', 'discountCodeAppUpdate',
    'fulfillmentConstraintRuleUpdate', 'deliveryCustomizationUpdate',
    'paymentCustomizationUpdate', 'validationUpdate', 'metafieldsSet',
    'discountAutomaticDelete', 'discountCodeDelete', 'cartTransformDelete',
    'fulfillmentConstraintRuleDelete', 'deliveryCustomizationDelete',
    'paymentCustomizationDelete', 'validationDelete',
  ]
  return keys.find((key) => query.includes(key)) ?? 'unknownMutation'
}

test.group('API Shopify functions', (group) => {
  let app: Awaited<ReturnType<typeof createServer>>
  let originalFetch: typeof globalThis.fetch
  let graphqlCalls: GraphqlCall[] = []
  let nextUserErrors: Array<{ field: string[]; message: string }> | null = null
  let failTransport = false
  let cartExists = true

  group.setup(async () => {
    app = await createServer(() => createConfig({}, { functions }))
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
    failTransport = false
    cartExists = true
    originalFetch = globalThis.fetch
    globalThis.fetch = async (_input, init) => {
      if (failTransport) return new Response('Shopify unavailable', { status: 503 })

      const body = JSON.parse(String(init?.body ?? '{}')) as Omit<GraphqlCall, 'url' | 'accessToken'>
      const headers = new Headers(init?.headers)
      graphqlCalls.push({
        url: String(_input),
        accessToken: headers.get('X-Shopify-Access-Token'),
        ...body,
      })

      if (body.query.includes('ListDiscountOwners')) {
        return Response.json({ data: {
          shopifyFunctions: { nodes: [{ id: 'function-discount', handle: 'volume-discount' }] },
          discountNodes: { nodes: [{
            id: 'gid://shopify/DiscountNode/1',
            discount: {
              __typename: 'DiscountCodeApp',
              appDiscountType: { functionId: 'function-discount' },
              title: 'Volume 10',
              status: 'SCHEDULED',
              startsAt: '2026-09-01T00:00:00Z',
              endsAt: null,
              usageLimit: 10,
              combinesWith: { productDiscounts: true, orderDiscounts: false, shippingDiscounts: false },
              codes: { nodes: [{ code: 'VOLUME10' }] },
            },
            metafield: { value: '{"percent":10}' },
          }] },
        } })
      }

      if (body.query.includes('ListCartTransformOwners')) {
        return Response.json({ data: {
          shopifyFunctions: { nodes: [
            { id: 'function-cart', handle: 'cart-transform' },
            { id: 'function-other', handle: 'other-cart-transform' },
          ] },
          cartTransforms: { nodes: cartExists ? [
            { id: 'gid://shopify/CartTransform/1', functionId: 'function-cart', blockOnFailure: true, metafield: null },
            { id: 'gid://shopify/CartTransform/2', functionId: 'function-other', blockOnFailure: false, metafield: null },
          ] : [] },
        } })
      }

      if (body.query.includes('ListTitledFunctionOwners')) {
        const delivery = body.query.includes('deliveryCustomizations')
        const key = delivery ? 'deliveryCustomizations' : 'paymentCustomizations'
        const handle = delivery ? 'delivery-rules' : 'payment-rules'
        const title = delivery ? 'Delivery rules' : 'Payment rules'
        return Response.json({ data: {
          [key]: { nodes: [{
            id: `${delivery ? 'delivery' : 'payment'}-1`, title, enabled: delivery,
            shopifyFunction: { handle }, metafield: { value: '{"message":"configured"}' },
          }] },
        } })
      }

      if (body.query.includes('ListValidationOwners')) {
        return Response.json({ data: { validations: { nodes: [{
          id: 'validation-1', title: 'Checkout validation', enabled: true, blockOnFailure: true,
          shopifyFunction: { handle: 'checkout-validation' }, metafield: null,
        }] } } })
      }

      if (body.query.includes('ListFulfillmentConstraintOwners')) {
        return Response.json({ data: { fulfillmentConstraintRules: [
          {
            id: 'fulfillment-1', deliveryMethodTypes: ['SHIPPING', 'PICK_UP'],
            function: { handle: 'fulfillment-rules' }, metafield: { value: '{"message":"ship"}' },
          },
          {
            id: 'fulfillment-other', deliveryMethodTypes: ['LOCAL'],
            function: { handle: 'other-rules' }, metafield: null,
          },
        ] } })
      }

      const key = mutationKey(body.query)
      const userErrors = nextUserErrors ?? []
      nextUserErrors = null
      if (key === 'cartTransformCreate') cartExists = true
      return Response.json({ data: { [key]: {
        userErrors,
        automaticAppDiscount: { discountId: 'discount-automatic' },
        codeAppDiscount: { discountId: 'discount-code' },
        cartTransform: { id: 'cart-created' },
        fulfillmentConstraintRule: { id: 'fulfillment-created' },
        deliveryCustomization: { id: 'delivery-created' },
        paymentCustomization: { id: 'payment-created' },
        validation: { id: 'validation-created' },
        metafields: [{ id: 'metafield-1' }],
      } } })
    }

    return () => {
      globalThis.fetch = originalFetch
    }
  })

  const request = (path: string, options: RequestInit = {}, shop = TEST_SHOP) => {
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${createJwt(shop)}`)
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    return app.request(path, { ...options, headers })
  }

  const jsonRequest = (method: string, path: string, body: Record<string, unknown>, shop = TEST_SHOP) => {
    return request(path, { method, body: JSON.stringify(body) }, shop)
  }

  const lastCall = () => graphqlCalls[graphqlCalls.length - 1]

  test('returns capability-driven definitions without calling Shopify', async ({ assert }) => {
    const response = await request('/api/functions')
    const data = await response.json()
    const cart = data.find((definition: { handle: string }) => definition.handle === 'cart-transform')
    const fulfillment = data.find((definition: { handle: string }) => definition.handle === 'fulfillment-rules')

    assert.equal(response.status, 200)
    assert.lengthOf(data, 6)
    assert.deepInclude(cart, {
      label: 'Bundle Builder',
      capabilities: { create: true, updateSettings: false, updateConfig: false, delete: true, singleton: true },
    })
    assert.deepEqual(cart.settingsFields.blockOnFailure.defaultValue, false)
    assert.deepEqual(fulfillment.ui, { configurationPath: '/bundles/:id', configurationLabel: 'Configure bundle' })
    assert.notProperty(cart, 'title')
    assert.notProperty(cart, 'supportsUpdate')
    assert.lengthOf(graphqlCalls, 0)
  })

  test('returns normalized instances without untitled or false inactive fallbacks', async ({ assert }) => {
    const cartResponse = await request('/api/functions/cart-transform/instances')
    const [cart] = await cartResponse.json()
    const discountResponse = await request('/api/functions/volume-discount/instances')
    const [discount] = await discountResponse.json()

    assert.deepEqual(cart, {
      id: 'gid://shopify/CartTransform/1',
      label: 'Bundle Builder',
      state: 'active',
      settings: { blockOnFailure: true },
      config: { state: 'missing' },
      operations: { updateSettings: false, updateConfig: false, delete: true },
    })
    assert.equal(discount.label, 'Volume 10')
    assert.equal(discount.state, 'scheduled')
    assert.deepEqual(discount.config, { state: 'valid', value: { percent: 10 } })
    assert.notProperty(cart, 'title')
    assert.notProperty(cart, 'enabled')
  })

  test('uses the JWT shop installation and filters fulfillment owners by handle', async ({ assert }) => {
    await getDb().insert(installations).values({
      shop: 'functions-shop-b.myshopify.com',
      accessToken: 'token-b',
      scopes: 'write_discounts',
    })

    const response = await request(
      '/api/functions/fulfillment-rules/instances',
      {},
      'functions-shop-b.myshopify.com',
    )
    const data = await response.json()

    assert.equal(response.status, 200)
    assert.deepEqual(data.map((owner: { id: string }) => owner.id), ['fulfillment-1'])
    assert.include(lastCall().url, 'https://functions-shop-b.myshopify.com/admin/api/2026-04/graphql.json')
    assert.equal(lastCall().accessToken, 'token-b')
  })

  test('creates all six owner types from settings and config', async ({ assert }) => {
    const automatic = await jsonRequest('POST', '/api/functions/volume-discount/instances', {
      settings: { mode: 'automatic', startsAt: '2026-09-01T00:00:00Z' },
      config: { percent: 10 },
    })
    assert.equal(automatic.status, 201)
    assert.include(lastCall().query, 'discountAutomaticAppCreate')
    assert.deepInclude((lastCall().variables as { input: Record<string, unknown> }).input, {
      functionHandle: 'volume-discount', title: 'Volume 10', combinesWith: { productDiscounts: true },
    })

    const code = await jsonRequest('POST', '/api/functions/volume-discount/instances', {
      settings: { mode: 'code', code: 'SAVE10', usageLimit: 5 }, config: { percent: 10 },
    })
    assert.equal(code.status, 201)
    assert.include(lastCall().query, 'discountCodeAppCreate')

    cartExists = false
    const cart = await jsonRequest('POST', '/api/functions/cart-transform/instances', {
      settings: { blockOnFailure: true },
    })
    assert.equal(cart.status, 201)
    assert.deepEqual(lastCall().variables, { functionHandle: 'cart-transform', blockOnFailure: true, metafields: [] })

    const fulfillment = await jsonRequest('POST', '/api/functions/fulfillment-rules/instances', {
      settings: { deliveryMethodTypes: ['SHIPPING', 'PICK_UP'] }, config: { message: 'fulfillment' },
    })
    assert.equal(fulfillment.status, 201)
    assert.include(lastCall().query, 'fulfillmentConstraintRuleCreate')

    const delivery = await jsonRequest('POST', '/api/functions/delivery-rules/instances', {
      settings: { title: 'Delivery rules', enabled: false }, config: { message: 'delivery' },
    })
    assert.equal(delivery.status, 201)
    assert.deepInclude((lastCall().variables as { input: Record<string, unknown> }).input, { enabled: false })

    const payment = await jsonRequest('POST', '/api/functions/payment-rules/instances', {
      settings: { title: 'Payment rules', enabled: true }, config: { message: 'payment' },
    })
    assert.equal(payment.status, 201)
    assert.include(lastCall().query, 'paymentCustomizationCreate')

    const validation = await jsonRequest('POST', '/api/functions/checkout-validation/instances', {
      settings: { title: 'Checkout validation', enabled: true, blockOnFailure: true },
      config: { message: 'validation' },
    })
    assert.equal(validation.status, 201)
    assert.deepInclude((lastCall().variables as { input: Record<string, unknown> }).input, {
      enable: true, blockOnFailure: true,
    })
  })

  test('updates native fulfillment settings and owner config separately', async ({ assert }) => {
    const response = await jsonRequest('PUT', '/api/functions/fulfillment-rules/instances/fulfillment-1', {
      settings: { deliveryMethodTypes: ['LOCAL'] },
      config: { message: 'updated' },
    })

    assert.equal(response.status, 200)
    assert.equal(graphqlCalls.length, 3)
    assert.include(graphqlCalls[1].query, 'fulfillmentConstraintRuleUpdate')
    assert.deepEqual(graphqlCalls[1].variables, { id: 'fulfillment-1', deliveryMethodTypes: ['LOCAL'] })
    assert.include(graphqlCalls[2].query, 'metafieldsSet')
  })

  test('rejects Cart Transform settings updates and a second instance', async ({ assert }) => {
    const [cart] = await (await request('/api/functions/cart-transform/instances')).json()
    graphqlCalls = []
    const update = await jsonRequest('PUT', `/api/functions/cart-transform/instances/${encodeURIComponent(cart.id)}`, {
      settings: { blockOnFailure: false },
    })
    const updateBody = await update.json()

    assert.equal(update.status, 405)
    assert.equal(updateBody.error.code, 'operation_not_supported')
    assert.lengthOf(graphqlCalls, 1)
    assert.include(graphqlCalls[0].query, 'ListCartTransformOwners')

    graphqlCalls = []
    const create = await jsonRequest('POST', '/api/functions/cart-transform/instances', {
      settings: { blockOnFailure: false },
    })
    const createBody = await create.json()
    assert.equal(create.status, 409)
    assert.equal(createBody.error.code, 'instance_limit_reached')
    assert.lengthOf(graphqlCalls, 1)
  })

  test('deletes only an instance belonging to the selected function', async ({ assert }) => {
    const response = await request('/api/functions/delivery-rules/instances/delivery-1', { method: 'DELETE' })

    assert.equal(response.status, 200)
    assert.include(lastCall().query, 'deliveryCustomizationDelete')
    assert.deepEqual(lastCall().variables, { id: 'delivery-1' })
  })

  test('returns stable errors for invalid input, Shopify errors, and transport failures', async ({ assert }) => {
    const missing = await request('/api/functions/missing/instances')
    assert.deepEqual(await missing.json(), {
      error: { code: 'function_not_found', message: 'Function "missing" not found' },
    })

    const legacy = await jsonRequest('POST', '/api/functions/delivery-rules/instances', {
      title: 'Legacy flat field', config: { message: 'delivery' },
    })
    assert.equal((await legacy.json()).error.code, 'invalid_request')

    const invalid = await jsonRequest('POST', '/api/functions/volume-discount/instances', {
      settings: { mode: 'automatic' }, config: { percent: -1 },
    })
    const invalidBody = await invalid.json()
    assert.equal(invalid.status, 400)
    assert.equal(invalidBody.error.code, 'invalid_request')
    assert.include(invalidBody.error.message, 'Field "percent"')

    nextUserErrors = [{ field: ['title'], message: 'Title is invalid' }]
    const rejected = await jsonRequest('POST', '/api/functions/delivery-rules/instances', {
      settings: { title: 'Delivery rules', enabled: true }, config: { message: 'delivery' },
    })
    assert.deepEqual(await rejected.json(), {
      error: {
        code: 'shopify_user_error',
        message: 'Title is invalid',
        details: [{ field: ['title'], message: 'Title is invalid' }],
      },
    })

    failTransport = true
    const unavailable = await request('/api/functions/delivery-rules/instances')
    const unavailableBody = await unavailable.json()
    assert.equal(unavailable.status, 502)
    assert.equal(unavailableBody.error.code, 'shopify_error')
  })
})
