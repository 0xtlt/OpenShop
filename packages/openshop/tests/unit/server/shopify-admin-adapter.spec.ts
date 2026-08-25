import { test } from '@japa/runner'
import { ShopifyGraphqlAdminAdapter } from '#server/function-management/shopify-admin-adapter'
import type { ShopifyClient } from '#shopify/client'

interface Call {
  query: string
  variables?: Record<string, unknown>
}

function recordingClient(respond: (query: string) => unknown) {
  const calls: Call[] = []
  const client = {
    shop: 'test.myshopify.com',
    shopifyApp: 'default',
    async graphql(query: string, options?: { variables?: Record<string, unknown> }) {
      calls.push({ query, variables: options?.variables })
      return respond(query)
    },
  } as ShopifyClient
  return { client, calls }
}

test.group('ShopifyGraphqlAdminAdapter', () => {
  test('filters discount owners by the resolved deployed function handle', async ({ assert }) => {
    const { client } = recordingClient(() => ({
      shopifyFunctions: { nodes: [
        { id: 'function-target', handle: 'target' },
        { id: 'function-other', handle: 'other' },
      ] },
      discountNodes: { nodes: [
        {
          id: 'discount-target',
          discount: {
            __typename: 'DiscountAutomaticApp',
            appDiscountType: { functionId: 'function-target' },
            title: 'Target', status: 'ACTIVE', startsAt: '2026-08-25T00:00:00Z', endsAt: null,
            combinesWith: {},
          },
          metafield: null,
        },
        {
          id: 'discount-other',
          discount: {
            __typename: 'DiscountAutomaticApp',
            appDiscountType: { functionId: 'function-other' },
            title: 'Other', status: 'ACTIVE', startsAt: '2026-08-25T00:00:00Z', endsAt: null,
            combinesWith: {},
          },
          metafield: null,
        },
      ] },
    }))
    const adapter = new ShopifyGraphqlAdminAdapter(client)

    const discounts = await adapter.listOwners({ type: 'discount', handle: 'target' })

    assert.deepEqual(discounts.map((owner) => owner.id), ['discount-target'])
  })

  test('filters Cart Transform and Fulfillment owners by deployed function handle', async ({ assert }) => {
    const { client, calls } = recordingClient((query) => {
      if (query.includes('ListCartTransformOwners')) {
        return {
          shopifyFunctions: { nodes: [{ id: 'fn-1', handle: 'target' }, { id: 'fn-2', handle: 'other' }] },
          cartTransforms: { nodes: [
            { id: 'cart-1', functionId: 'fn-1', blockOnFailure: true, metafield: null },
            { id: 'cart-2', functionId: 'fn-2', blockOnFailure: false, metafield: null },
          ] },
        }
      }
      return {
        fulfillmentConstraintRules: [
          { id: 'rule-1', deliveryMethodTypes: ['SHIPPING'], function: { handle: 'target' }, metafield: null },
          { id: 'rule-2', deliveryMethodTypes: ['LOCAL'], function: { handle: 'other' }, metafield: null },
        ],
      }
    })
    const adapter = new ShopifyGraphqlAdminAdapter(client)

    const cart = await adapter.listOwners({ type: 'cart-transform', handle: 'target' })
    const fulfillment = await adapter.listOwners({ type: 'fulfillment-constraints', handle: 'target' })

    assert.deepEqual(cart.map((owner) => owner.id), ['cart-1'])
    assert.deepEqual(fulfillment.map((owner) => owner.id), ['rule-1'])
    assert.include(calls[0].query, 'shopifyFunctions(first: 100)')
    assert.include(calls[1].query, 'fulfillmentConstraintRules {')
    assert.notInclude(calls[1].query, 'fulfillmentConstraintRules(first:')
  })

  test('uses the exact flat mutations for Cart Transform and Fulfillment updates', async ({ assert }) => {
    const { client, calls } = recordingClient((query) => {
      if (query.includes('cartTransformCreate')) {
        return { cartTransformCreate: { cartTransform: { id: 'cart-1' }, userErrors: [] } }
      }
      if (query.includes('fulfillmentConstraintRuleUpdate')) {
        return { fulfillmentConstraintRuleUpdate: { fulfillmentConstraintRule: { id: 'rule-1' }, userErrors: [] } }
      }
      return { metafieldsSet: { metafields: [{ id: 'metafield-1' }], userErrors: [] } }
    })
    const adapter = new ShopifyGraphqlAdminAdapter(client)

    await adapter.createOwner({
      definition: { type: 'cart-transform', handle: 'cart' },
      handle: 'cart',
      settings: { blockOnFailure: true },
      config: { message: 'bundle' },
    })
    await adapter.updateOwnerSettings({
      definition: { type: 'fulfillment-constraints', handle: 'fulfillment' },
      id: 'rule-1',
      settings: { deliveryMethodTypes: ['LOCAL', 'PICK_UP'] },
    })
    await adapter.setOwnerConfig({ id: 'rule-1', handle: 'fulfillment', config: { message: 'updated' } })

    assert.deepEqual(calls[0].variables, {
      functionHandle: 'cart',
      blockOnFailure: true,
      metafields: [{ namespace: '$app:openshop', key: 'cart', type: 'json', value: '{"message":"bundle"}' }],
    })
    assert.deepEqual(calls[1].variables, { id: 'rule-1', deliveryMethodTypes: ['LOCAL', 'PICK_UP'] })
    assert.deepEqual(calls[2].variables, {
      metafields: [{ ownerId: 'rule-1', namespace: '$app:openshop', key: 'fulfillment', type: 'json', value: '{"message":"updated"}' }],
    })
  })
})
