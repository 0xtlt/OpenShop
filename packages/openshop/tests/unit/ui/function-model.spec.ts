import { test } from '@japa/runner'
import {
  canCreate,
  configurationSummary,
  defaultValues,
  getPath,
  hasConfigFields,
  payloadValues,
  resolveConfigurationPath,
  setPath,
} from '../../../src/ui/pages/functions/model.ts'
import type { FunctionDef, FunctionInstance } from '../../../src/ui/pages/functions/types.ts'

const cartDefinition: FunctionDef = {
  label: 'Bundle Builder',
  type: 'cart-transform',
  handle: 'bundle-builder',
  capabilities: { create: true, singleton: true, updateSettings: false, updateConfig: false, delete: true },
  settingsFields: {
    blockOnFailure: { type: 'checkbox', label: 'Block checkout on failure', defaultValue: true },
  },
  configFields: {},
}

const cartInstance: FunctionInstance = {
  id: 'gid://shopify/CartTransform/1',
  label: 'Bundle Builder',
  state: 'active',
  settings: { blockOnFailure: true },
  config: { state: 'missing' },
  operations: { updateSettings: false, updateConfig: false, delete: true },
}

test.group('Shopify Function UI model', () => {
  test('hides create once the singleton Cart Transform exists', ({ assert }) => {
    assert.isTrue(canCreate(cartDefinition, []))
    assert.isFalse(canCreate(cartDefinition, [cartInstance]))
  })

  test('suppresses the owner config panel when no config fields are declared', ({ assert }) => {
    assert.isFalse(hasConfigFields(cartDefinition))
    assert.isTrue(hasConfigFields({
      ...cartDefinition,
      configFields: { message: { type: 'text', label: 'Message' } },
    }))
  })

  test('resolves app-relative configuration links with encoded owner ids', ({ assert }) => {
    assert.equal(
      resolveConfigurationPath('/bundles/:id/settings', cartInstance.id),
      '/bundles/gid%3A%2F%2Fshopify%2FCartTransform%2F1/settings',
    )
    assert.isNull(resolveConfigurationPath('https://example.com/:id', cartInstance.id))
  })

  test('keeps missing and invalid metafields visible', ({ assert }) => {
    assert.equal(configurationSummary({ state: 'missing' }), 'Missing')
    assert.equal(configurationSummary({ state: 'invalid', raw: '{broken' }), 'Invalid JSON')
    assert.equal(configurationSummary({ state: 'valid', value: { threshold: 3 } }), 'threshold: 3')
  })

  test('maps dotted settings fields without flattening the HTTP payload', ({ assert }) => {
    const fields = {
      'combinesWith.productDiscounts': { type: 'checkbox', label: 'Products', defaultValue: false },
      'combinesWith.shippingDiscounts': { type: 'checkbox', label: 'Shipping', defaultValue: true },
    } as const
    const defaults = defaultValues(fields, true)
    const changed = setPath(defaults, 'combinesWith.productDiscounts', true)

    assert.isFalse(getPath(defaults, 'combinesWith.productDiscounts'))
    assert.isTrue(getPath(changed, 'combinesWith.productDiscounts'))
    assert.deepEqual(payloadValues(changed, fields, true), {
      combinesWith: { productDiscounts: true, shippingDiscounts: true },
    })
  })
})
