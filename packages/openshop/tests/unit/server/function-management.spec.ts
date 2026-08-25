import { test } from '@japa/runner'
import { FunctionManagement, FunctionManagementError } from '#server/function-management/index'
import { InMemoryShopifyAdminPort } from '#server/function-management/in-memory-port'
import { ShopifyAdminUserError } from '#server/function-management/shopify-admin-adapter'

test.group('FunctionManagement', () => {
  test('represents an existing cart transform as a named active instance', async ({ assert }) => {
    const shopify = new InMemoryShopifyAdminPort([{
      id: 'gid://shopify/CartTransform/1',
      type: 'cart-transform',
      functionHandle: 'bundle-cart-transform',
      blockOnFailure: true,
      metafieldValue: null,
    }])
    const management = new FunctionManagement({
      bundleBuilder: {
        type: 'cart-transform',
        handle: 'bundle-cart-transform',
        defaults: { blockOnFailure: false },
      },
    }, shopify)

    const instances = await management.inspect('bundle-cart-transform')

    assert.deepEqual(instances, [{
      id: 'gid://shopify/CartTransform/1',
      label: 'Bundle Builder',
      state: 'active',
      settings: { blockOnFailure: true },
      config: { state: 'missing' },
      operations: {
        updateSettings: false,
        updateConfig: false,
        delete: true,
      },
    }])
  })

  test('publishes type-specific capabilities and fields for every function definition', ({ assert }) => {
    const management = new FunctionManagement({
      discountRules: {
        type: 'discount',
        handle: 'discount-rules',
        modes: ['automatic', 'code'],
        defaults: { title: 'Discount rules', combinesWith: { productDiscounts: true } },
      },
      cartTransform: {
        type: 'cart-transform',
        handle: 'cart-transform',
        defaults: { blockOnFailure: true },
      },
      delivery: {
        type: 'delivery-customization',
        handle: 'delivery',
        defaults: { title: 'Delivery', enabled: true },
      },
      payment: {
        type: 'payment-customization',
        handle: 'payment',
        defaults: { title: 'Payment', enabled: true },
      },
      validation: {
        type: 'checkout-validation',
        handle: 'validation',
        defaults: { title: 'Validation', enabled: true, blockOnFailure: false },
      },
      fulfillment: {
        type: 'fulfillment-constraints',
        handle: 'fulfillment',
        defaults: { deliveryMethodTypes: ['SHIPPING'] },
        config: { message: { type: 'text', label: 'Message' } },
        ui: { configurationPath: '/bundles/:id', configurationLabel: 'Configure bundle' },
      },
    }, new InMemoryShopifyAdminPort())

    const catalogue = management.catalogue()
    const cart = catalogue.find((definition) => definition.handle === 'cart-transform')!
    const fulfillment = catalogue.find((definition) => definition.handle === 'fulfillment')!

    assert.lengthOf(catalogue, 6)
    assert.equal(cart.label, 'Cart Transform')
    assert.deepEqual(cart.capabilities, {
      create: true,
      updateSettings: false,
      updateConfig: false,
      delete: true,
      singleton: true,
    })
    assert.deepEqual(cart.settingsFields.blockOnFailure, {
      type: 'checkbox',
      label: 'Block checkout on failure',
      required: true,
      defaultValue: true,
    })
    assert.isTrue(fulfillment.capabilities.updateSettings)
    assert.isTrue(fulfillment.capabilities.updateConfig)
    assert.deepEqual(fulfillment.configFields.message, { type: 'text', label: 'Message' })
    assert.deepEqual(fulfillment.ui, {
      configurationPath: '/bundles/:id',
      configurationLabel: 'Configure bundle',
    })
  })

  test('normalizes settings, states, and metafield health for all six owner types', async ({ assert }) => {
    const definitions = {
      discount: { type: 'discount', handle: 'discount', modes: ['automatic', 'code'] },
      cart: { type: 'cart-transform', handle: 'cart' },
      delivery: { type: 'delivery-customization', handle: 'delivery' },
      payment: { type: 'payment-customization', handle: 'payment' },
      validation: { type: 'checkout-validation', handle: 'validation' },
      fulfillment: { type: 'fulfillment-constraints', handle: 'fulfillment' },
    } as const
    const shopify = new InMemoryShopifyAdminPort([
      {
        id: 'discount-1', type: 'discount', functionHandle: 'discount', mode: 'code', title: 'VIP',
        status: 'SCHEDULED', startsAt: '2026-09-01T00:00:00Z', endsAt: null, usageLimit: 50,
        code: 'VIP50', combinesWith: { productDiscounts: true }, metafieldValue: '{"percent":50}',
      },
      { id: 'cart-1', type: 'cart-transform', functionHandle: 'cart', blockOnFailure: false, metafieldValue: '{broken' },
      { id: 'delivery-1', type: 'delivery-customization', functionHandle: 'delivery', title: 'Delivery', enabled: false },
      { id: 'payment-1', type: 'payment-customization', functionHandle: 'payment', title: 'Payment', enabled: true },
      { id: 'validation-1', type: 'checkout-validation', functionHandle: 'validation', title: 'Validation', enabled: true, blockOnFailure: true },
      { id: 'fulfillment-1', type: 'fulfillment-constraints', functionHandle: 'fulfillment', deliveryMethodTypes: ['SHIPPING', 'PICK_UP'] },
    ])
    const management = new FunctionManagement(definitions, shopify)

    const [discount] = await management.inspect('discount')
    const [cart] = await management.inspect('cart')
    const [delivery] = await management.inspect('delivery')
    const [payment] = await management.inspect('payment')
    const [validation] = await management.inspect('validation')
    const [fulfillment] = await management.inspect('fulfillment')

    assert.equal(discount.state, 'scheduled')
    assert.equal(discount.label, 'VIP')
    assert.deepEqual(discount.config, { state: 'valid', value: { percent: 50 } })
    assert.deepInclude(discount.settings, { mode: 'code', code: 'VIP50', usageLimit: 50 })
    assert.deepEqual(cart.config, { state: 'invalid', raw: '{broken' })
    assert.equal(delivery.state, 'inactive')
    assert.equal(payment.state, 'active')
    assert.deepEqual(validation.settings, { title: 'Validation', enabled: true, blockOnFailure: true })
    assert.deepEqual(fulfillment.settings, { deliveryMethodTypes: ['SHIPPING', 'PICK_UP'] })
  })

  test('never treats an invalid stored config as an empty object during settings updates', async ({ assert }) => {
    const shopify = new InMemoryShopifyAdminPort([{
      id: 'delivery-1',
      type: 'delivery-customization',
      functionHandle: 'delivery',
      title: 'Delivery',
      enabled: true,
      metafieldValue: '',
    }])
    const management = new FunctionManagement({
      delivery: {
        type: 'delivery-customization',
        handle: 'delivery',
        config: { suffix: { type: 'text', label: 'Suffix', required: false } },
        defaults: { title: (config) => `Delivery ${String(config.suffix ?? '')}` },
      },
    }, shopify)

    await assert.rejects(
      () => management.execute('delivery', {
        action: 'update',
        id: 'delivery-1',
        input: { settings: { enabled: false } },
      }),
      /stored config is invalid JSON/,
    )
  })

  test('normalizes dynamic title failures as invalid requests', async ({ assert }) => {
    const management = new FunctionManagement({
      delivery: {
        type: 'delivery-customization',
        handle: 'delivery',
        config: { suffix: { type: 'text', label: 'Suffix', required: false } },
        defaults: { title: () => { throw new Error('application callback failed') } },
      },
    }, new InMemoryShopifyAdminPort())

    let error: unknown
    try {
      await management.execute('delivery', { action: 'create', input: { settings: {}, config: {} } })
    } catch (caught) {
      error = caught
    }

    assert.deepInclude(error as FunctionManagementError, {
      code: 'invalid_request',
      status: 400,
      message: 'defaults.title could not be resolved from function config',
    })
  })

  test('creates one cart transform and rejects a second instance with a conflict', async ({ assert }) => {
    const shopify = new InMemoryShopifyAdminPort()
    const management = new FunctionManagement({
      cart: {
        type: 'cart-transform',
        handle: 'cart',
        defaults: { blockOnFailure: false },
        config: { message: { type: 'text', label: 'Message' } },
      },
    }, shopify)

    await management.execute('cart', {
      action: 'create',
      input: { settings: { blockOnFailure: true }, config: { message: 'Bundle ready' } },
    })

    const [created] = await management.inspect('cart')
    assert.deepEqual(created.settings, { blockOnFailure: true })
    assert.deepEqual(created.config, { state: 'valid', value: { message: 'Bundle ready' } })

    let error: unknown
    try {
      await management.execute('cart', {
        action: 'create',
        input: { settings: { blockOnFailure: false }, config: { message: 'Second' } },
      })
    } catch (caught) {
      error = caught
    }
    assert.instanceOf(error, FunctionManagementError)
    assert.equal((error as FunctionManagementError).status, 409)
    assert.equal((error as FunctionManagementError).code, 'instance_limit_reached')
    assert.lengthOf(shopify.owners, 1)
  })

  test('executes the supported create, update, config, and delete matrix', async ({ assert }) => {
    const optionalConfig = { note: { type: 'text', label: 'Note', required: false } } as const
    const definitions = {
      discount: {
        type: 'discount', handle: 'discount', modes: ['automatic', 'code'],
        defaults: { title: 'Discount', combinesWith: { productDiscounts: true } }, config: optionalConfig,
      },
      cart: { type: 'cart-transform', handle: 'cart' },
      delivery: { type: 'delivery-customization', handle: 'delivery', defaults: { title: 'Delivery', enabled: true }, config: optionalConfig },
      payment: { type: 'payment-customization', handle: 'payment', defaults: { title: 'Payment', enabled: true }, config: optionalConfig },
      validation: { type: 'checkout-validation', handle: 'validation', defaults: { title: 'Validation', enabled: true, blockOnFailure: false }, config: optionalConfig },
      fulfillment: { type: 'fulfillment-constraints', handle: 'fulfillment', defaults: { deliveryMethodTypes: ['SHIPPING'] }, config: optionalConfig },
    } as const
    const shopify = new InMemoryShopifyAdminPort()
    const management = new FunctionManagement(definitions, shopify)

    const discount = await management.execute('discount', {
      action: 'create',
      input: { settings: { mode: 'code', title: 'VIP', code: 'VIP20' }, config: { note: 'discount' } },
    })
    await management.execute('cart', { action: 'create', input: { settings: { blockOnFailure: true } } })
    const delivery = await management.execute('delivery', {
      action: 'create', input: { settings: { title: 'Delivery', enabled: false }, config: { note: 'delivery' } },
    })
    const payment = await management.execute('payment', {
      action: 'create', input: { settings: { title: 'Payment', enabled: true }, config: { note: 'payment' } },
    })
    const validation = await management.execute('validation', {
      action: 'create', input: { settings: { title: 'Validation', enabled: true, blockOnFailure: true }, config: { note: 'validation' } },
    })
    const fulfillment = await management.execute('fulfillment', {
      action: 'create', input: { settings: { deliveryMethodTypes: ['SHIPPING', 'PICK_UP'] }, config: { note: 'fulfillment' } },
    })

    await management.execute('discount', {
      action: 'update', id: discount.id!,
      input: { settings: { mode: 'code', title: 'VIP updated', code: 'VIP20', usageLimit: 20 }, config: { note: 'discount updated' } },
    })
    await management.execute('delivery', {
      action: 'update', id: delivery.id!, input: { settings: { title: 'Delivery updated', enabled: true } },
    })
    await management.execute('payment', {
      action: 'update', id: payment.id!, input: { settings: { title: 'Payment updated', enabled: false } },
    })
    await management.execute('validation', {
      action: 'update', id: validation.id!, input: { settings: { title: 'Validation updated', enabled: false, blockOnFailure: false } },
    })
    await management.execute('fulfillment', {
      action: 'update', id: fulfillment.id!,
      input: { settings: { deliveryMethodTypes: ['LOCAL'] }, config: { note: 'fulfillment updated' } },
    })

    const [updatedFulfillment] = await management.inspect('fulfillment')
    assert.deepEqual(updatedFulfillment.settings, { deliveryMethodTypes: ['LOCAL'] })
    assert.deepEqual(updatedFulfillment.config, { state: 'valid', value: { note: 'fulfillment updated' } })

    let unsupported: unknown
    const [cart] = await management.inspect('cart')
    try {
      await management.execute('cart', {
        action: 'update', id: cart.id, input: { settings: { blockOnFailure: false } },
      })
    } catch (caught) {
      unsupported = caught
    }
    assert.equal((unsupported as FunctionManagementError).status, 405)

    await management.execute('fulfillment', { action: 'delete', id: fulfillment.id! })
    assert.deepEqual(await management.inspect('fulfillment'), [])
    assert.lengthOf(shopify.owners, 5)
  })

  test('normalizes Shopify user and transport failures at the Module interface', async ({ assert }) => {
    const definition = { delivery: { type: 'delivery-customization', handle: 'delivery' } } as const
    const userErrorPort = new InMemoryShopifyAdminPort()
    userErrorPort.createOwner = async () => {
      throw new ShopifyAdminUserError([{ field: ['title'], message: 'Title is invalid' }])
    }
    const transportPort = new InMemoryShopifyAdminPort()
    transportPort.listOwners = async () => {
      throw new Error('GraphQL connection failed')
    }

    let userFailure: unknown
    try {
      await new FunctionManagement(definition, userErrorPort).execute('delivery', {
        action: 'create', input: { settings: { title: 'Delivery', enabled: true } },
      })
    } catch (caught) {
      userFailure = caught
    }
    let transportFailure: unknown
    try {
      await new FunctionManagement(definition, transportPort).inspect('delivery')
    } catch (caught) {
      transportFailure = caught
    }

    assert.deepInclude(userFailure as FunctionManagementError, {
      code: 'shopify_user_error',
      status: 400,
      details: [{ field: ['title'], message: 'Title is invalid' }],
    })
    assert.deepInclude(transportFailure as FunctionManagementError, {
      code: 'shopify_error',
      status: 502,
    })
  })
})
