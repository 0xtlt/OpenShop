import { test } from '@japa/runner'
import {
  canCreateInstance,
  hasConfigFields,
  instanceIsActive,
  instanceLabel,
  instanceState,
} from '../../../src/ui/pages/functions/model.ts'
import type { FunctionDef, FunctionInstance } from '../../../src/ui/pages/functions/types.ts'

const cartTransform: FunctionDef = {
  key: 'cartTransform',
  label: 'Bundle cart transform',
  type: 'cart-transform',
  handle: 'cart-transform',
  supportsUpdate: false,
  singleton: true,
  fields: {},
}

const instance: FunctionInstance = {
  id: 'gid://shopify/CartTransform/1',
  label: 'Bundle cart transform',
  state: 'active',
  blockOnFailure: true,
  config: {},
}

test.group('Function UI model', () => {
  test('renders Cart Transform semantics without Shopify title or enabled fields', ({ assert }) => {
    assert.equal(instanceLabel(instance), 'Bundle cart transform')
    assert.equal(instanceState(instance), 'Active')
    assert.isTrue(instanceIsActive(instance))
  })

  test('hides singleton creation and empty configuration', ({ assert }) => {
    assert.isTrue(canCreateInstance(cartTransform, []))
    assert.isFalse(canCreateInstance(cartTransform, [instance]))
    assert.isFalse(hasConfigFields(cartTransform))
  })
})
