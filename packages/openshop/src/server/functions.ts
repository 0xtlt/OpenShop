import { Hono } from 'hono'
import { getShop } from '#server/shop'
import type { OpenShopConfig, FunctionDefinition, ShopifyFunctionType, DiscountMode } from '#types'
import { validateFunctionConfig } from '#server/function-config'

// ─── Mutation mapping ────────────────────────────────────────────────

interface MutationSet {
  list: string
  create: string
  update: string | null // null = no update (cart-transform, fulfillment-constraints)
  delete: string
  inputStyle: 'wrapped' | 'flat'
}

const DISCOUNT_MUTATIONS: Record<DiscountMode, MutationSet> = {
  automatic: {
    list: 'discountNodes',
    create: 'discountAutomaticAppCreate',
    update: 'discountAutomaticAppUpdate',
    delete: 'discountAutomaticDelete',
    inputStyle: 'wrapped',
  },
  code: {
    list: 'discountNodes',
    create: 'discountCodeAppCreate',
    update: 'discountCodeAppUpdate',
    delete: 'discountCodeDelete',
    inputStyle: 'wrapped',
  },
}

const FUNCTION_MUTATIONS: Record<Exclude<ShopifyFunctionType, 'discount' | 'order-routing'>, MutationSet> = {
  'cart-transform': {
    list: 'cartTransforms',
    create: 'cartTransformCreate',
    update: null, // no update mutation — must delete+recreate
    delete: 'cartTransformDelete',
    inputStyle: 'flat',
  },
  'delivery-customization': {
    list: 'deliveryCustomizations',
    create: 'deliveryCustomizationCreate',
    update: 'deliveryCustomizationUpdate',
    delete: 'deliveryCustomizationDelete',
    inputStyle: 'wrapped',
  },
  'payment-customization': {
    list: 'paymentCustomizations',
    create: 'paymentCustomizationCreate',
    update: 'paymentCustomizationUpdate',
    delete: 'paymentCustomizationDelete',
    inputStyle: 'wrapped',
  },
  'checkout-validation': {
    list: 'validations',
    create: 'validationCreate',
    update: 'validationUpdate',
    delete: 'validationDelete',
    inputStyle: 'wrapped',
  },
  'fulfillment-constraints': {
    list: 'fulfillmentConstraintRules',
    create: 'fulfillmentConstraintRuleCreate',
    update: null, // only deliveryMethodTypes can be updated, not config
    delete: 'fulfillmentConstraintRuleDelete',
    inputStyle: 'flat',
  },
}

const METAFIELD_NAMESPACE = '$app:openshop'

// ─── Helpers ─────────────────────────────────────────────────────────

/** Narrow unknown graphql result to indexable object */
function gql(data: unknown): Record<string, Record<string, unknown>> {
  if (typeof data === 'object' && data !== null) return data as Record<string, Record<string, unknown>>
  return {}
}

/** Extract userErrors from a mutation result */
function extractErrors(data: unknown): Array<{ field: string; message: string }> {
  const obj = gql(data)
  const mutationKey = Object.keys(obj).find((k) => k !== 'extensions')
  if (!mutationKey) return []
  const result = obj[mutationKey]
  return (Array.isArray(result?.userErrors) ? result.userErrors : []) as Array<{ field: string; message: string }>
}

/** Extract mutation result payload */
function extractPayload(data: unknown): Record<string, unknown> | null {
  const obj = gql(data)
  const mutationKey = Object.keys(obj).find((k) => k !== 'extensions')
  return mutationKey ? obj[mutationKey] : null
}

function resolveTitle(owner: FunctionDefinition['owner'], config: Record<string, unknown>): string {
  if (!owner) return 'Untitled'
  const title = owner.title
  return typeof title === 'function' ? title(config) : title
}

function getMutations(def: FunctionDefinition, mode?: DiscountMode): MutationSet | null {
  if (def.type === 'discount') {
    return DISCOUNT_MUTATIONS[mode ?? (def.modes?.[0] ?? 'automatic')]
  }
  return FUNCTION_MUTATIONS[def.type]
}

function buildMetafield(handle: string, config: Record<string, unknown>) {
  return {
    namespace: METAFIELD_NAMESPACE,
    key: handle,
    type: 'json',
    value: JSON.stringify(config),
  }
}

// ─── Routes ──────────────────────────────────────────────────────────

export function createFunctionRoutes(getConfig: () => OpenShopConfig) {
  const api = new Hono()

  // List all function definitions
  api.get('/functions', (c) => {
    const config = getConfig()
    if (!config.functions) return c.json([])
    const functions = Object.entries(config.functions).map(([key, def]) => {
      const fields: Record<string, Record<string, unknown>> = {}
      for (const fieldName of Object.keys(def.config)) {
        const { validate: _validate, ...rest } = def.config[fieldName]
        fields[fieldName] = rest
      }
      return {
        key,
        type: def.type,
        handle: def.handle,
        modes: def.type === 'discount' ? (def.modes ?? ['automatic']) : undefined,
        supportsUpdate: def.type !== 'cart-transform' && def.type !== 'fulfillment-constraints',
        fields,
      }
    })
    return c.json(functions)
  })

  // List instances of a function (queries Shopify live)
  api.get('/functions/:handle/instances', async (c) => {
    const config = getConfig()
    const shop = getShop(c)
    const handle = c.req.param('handle')
    const def = config.functions ? Object.values(config.functions).find((f) => f.handle === handle) : undefined
    if (!def) return c.json({ error: 'Function not found' }, 404)

    const mutations = getMutations(def)
    if (!mutations) return c.json({ error: `Function type "${def.type}" has no GraphQL API` }, 400)

    const { createShopifyClient } = await import('../shopify/client.js')
    const shopify = await createShopifyClient(shop)

    if (def.type === 'discount') {
      const query = `#graphql
        query ListDiscountInstances($query: String!) {
          discountNodes(first: 50, query: $query) {
            nodes {
              id
              discount {
                ... on DiscountAutomaticApp {
                  title status startsAt endsAt
                  combinesWith { productDiscounts orderDiscounts shippingDiscounts }
                }
                ... on DiscountCodeApp {
                  title status startsAt endsAt usageLimit
                  combinesWith { productDiscounts orderDiscounts shippingDiscounts }
                  codes(first: 1) { nodes { code } }
                }
              }
              metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${def.handle}") { value }
            }
          }
        }`
      const data = await shopify.graphql(query, { variables: { query: `function_handle:${handle}` } })
      const discountData = gql(data)
      const nodes = (Array.isArray(discountData.discountNodes?.nodes) ? discountData.discountNodes.nodes : []) as Array<Record<string, Record<string, unknown>>>
      return c.json(nodes.map((node) => ({
        id: node.id,
        title: node.discount?.title,
        status: node.discount?.status,
        startsAt: node.discount?.startsAt,
        endsAt: node.discount?.endsAt,
        config: node.metafield?.value ? JSON.parse(String(node.metafield.value)) : {},
      })))
    }

    // Generic list for non-discount types
    const query = `#graphql
      query ListInstances {
        ${mutations.list}(first: 50) {
          nodes {
            id
            ${def.type !== 'cart-transform' ? 'title enabled' : 'blockOnFailure'}
            metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${handle}") { value }
          }
        }
      }`
    const data = await shopify.graphql(query)
    const listData = gql(data)
    const nodes = (Array.isArray(listData[mutations.list]?.nodes) ? listData[mutations.list].nodes : []) as Array<Record<string, Record<string, unknown>>>
    return c.json(nodes.map((node) => ({
      id: node.id,
      title: node.title,
      enabled: node.enabled,
      config: node.metafield?.value ? JSON.parse(String(node.metafield.value)) : {},
    })))
  })

  // Create a function instance
  api.post('/functions/:handle/instances', async (c) => {
    const config = getConfig()
    const shop = getShop(c)
    const handle = c.req.param('handle')
    const def = config.functions ? Object.values(config.functions).find((f) => f.handle === handle) : undefined
    if (!def) return c.json({ error: 'Function not found' }, 404)

    const mutations = getMutations(def)
    if (!mutations) return c.json({ error: `Function type "${def.type}" has no GraphQL API` }, 400)

    const body = await c.req.json()
    const parsedConfig = validateFunctionConfig(def, body.config)
    if (!parsedConfig.ok) return c.json({ error: parsedConfig.error }, 400)
    const fnConfig = parsedConfig.config
    const mode: DiscountMode = body.mode ?? def.modes?.[0] ?? 'automatic'

    const { createShopifyClient } = await import('../shopify/client.js')
    const shopify = await createShopifyClient(shop)

    const title = resolveTitle(def.owner, fnConfig)
    const metafield = buildMetafield(handle, fnConfig)

    let mutation: string
    let variables: Record<string, unknown>

    if (def.type === 'discount') {
      const owner = def.owner
      if (mode === 'automatic') {
        mutation = `#graphql
          mutation CreateAutoDiscount($input: DiscountAutomaticAppInput!) {
            discountAutomaticAppCreate(automaticAppDiscount: $input) {
              automaticAppDiscount { discountId }
              userErrors { field message }
            }
          }`
        variables = {
          input: {
            functionHandle: handle,
            title,
            startsAt: body.startsAt ?? new Date().toISOString(),
            endsAt: body.endsAt ?? null,
            combinesWith: owner?.combinesWith ?? {},
            metafields: [metafield],
          },
        }
      } else {
        mutation = `#graphql
          mutation CreateCodeDiscount($input: DiscountCodeAppInput!) {
            discountCodeAppCreate(codeAppDiscount: $input) {
              codeAppDiscount { discountId }
              userErrors { field message }
            }
          }`
        variables = {
          input: {
            functionHandle: handle,
            title,
            code: body.code,
            startsAt: body.startsAt ?? new Date().toISOString(),
            endsAt: body.endsAt ?? null,
            usageLimit: body.usageLimit ?? null,
            combinesWith: owner?.combinesWith ?? {},
            metafields: [metafield],
          },
        }
      }
    } else if (def.type === 'cart-transform') {
      // Flat args
      mutation = `#graphql
        mutation CreateCartTransform($functionHandle: String!, $blockOnFailure: Boolean, $metafields: [MetafieldInput!]) {
          cartTransformCreate(functionHandle: $functionHandle, blockOnFailure: $blockOnFailure, metafields: $metafields) {
            cartTransform { id }
            userErrors { field message }
          }
        }`
      variables = {
        functionHandle: handle,
        blockOnFailure: body.blockOnFailure ?? false,
        metafields: [metafield],
      }
    } else if (def.type === 'fulfillment-constraints') {
      // Flat args
      mutation = `#graphql
        mutation CreateFulfillmentConstraint($functionHandle: String!, $deliveryMethodTypes: [DeliveryMethodType!]!, $metafields: [MetafieldInput!]) {
          fulfillmentConstraintRuleCreate(functionHandle: $functionHandle, deliveryMethodTypes: $deliveryMethodTypes, metafields: $metafields) {
            fulfillmentConstraintRule { id }
            userErrors { field message }
          }
        }`
      variables = {
        functionHandle: handle,
        deliveryMethodTypes: body.deliveryMethodTypes ?? ['SHIPPING'],
        metafields: [metafield],
      }
    } else if (def.type === 'delivery-customization') {
      mutation = `#graphql
        mutation CreateDeliveryCustomization($input: DeliveryCustomizationInput!) {
          deliveryCustomizationCreate(deliveryCustomization: $input) {
            deliveryCustomization { id }
            userErrors { field message }
          }
        }`
      variables = {
        input: { functionHandle: handle, title, enabled: true, metafields: [metafield] },
      }
    } else if (def.type === 'payment-customization') {
      mutation = `#graphql
        mutation CreatePaymentCustomization($input: PaymentCustomizationInput!) {
          paymentCustomizationCreate(paymentCustomization: $input) {
            paymentCustomization { id }
            userErrors { field message }
          }
        }`
      variables = {
        input: { functionHandle: handle, title, enabled: true, metafields: [metafield] },
      }
    } else if (def.type === 'checkout-validation') {
      mutation = `#graphql
        mutation CreateValidation($input: ValidationCreateInput!) {
          validationCreate(validation: $input) {
            validation { id }
            userErrors { field message }
          }
        }`
      variables = {
        input: { functionHandle: handle, title, enable: true, blockOnFailure: body.blockOnFailure ?? false, metafields: [metafield] },
      }
    } else {
      return c.json({ error: `Unsupported function type: ${def.type}` }, 400)
    }

    const result = await shopify.graphql(mutation, { variables })
    const errors = extractErrors(result)

    if (errors.length) {
      return c.json({ error: errors.map((e) => e.message).join(', '), userErrors: errors }, 400)
    }

    return c.json({ ok: true, data: extractPayload(result) }, 201)
  })

  // Update a function instance
  api.put('/functions/:handle/instances/:id', async (c) => {
    const config = getConfig()
    const shop = getShop(c)
    const handle = c.req.param('handle')
    const id = c.req.param('id')
    const def = config.functions ? Object.values(config.functions).find((f) => f.handle === handle) : undefined
    if (!def) return c.json({ error: 'Function not found' }, 404)

    const body = await c.req.json().catch(() => ({}))
    const mode: DiscountMode = body.mode ?? def.modes?.[0] ?? 'automatic'
    const mutations = getMutations(def, mode)
    if (!mutations?.update) {
      return c.json({ error: `Function type "${def.type}" does not support update. Delete and recreate instead.` }, 400)
    }

    const parsedConfig = validateFunctionConfig(def, body.config)
    if (!parsedConfig.ok) return c.json({ error: parsedConfig.error }, 400)
    const fnConfig = parsedConfig.config

    const { createShopifyClient } = await import('../shopify/client.js')
    const shopify = await createShopifyClient(shop)

    const title = resolveTitle(def.owner, fnConfig)
    const metafield = buildMetafield(handle, fnConfig)

    let mutation: string
    let variables: Record<string, unknown>

    if (def.type === 'discount' && mode === 'automatic') {
      mutation = `#graphql
        mutation UpdateAutoDiscount($id: ID!, $input: DiscountAutomaticAppInput!) {
          discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $input) {
            userErrors { field message }
          }
        }`
      variables = {
        id,
        input: {
          title,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          combinesWith: def.owner?.combinesWith,
          metafields: [metafield],
        },
      }
    } else if (def.type === 'discount' && mode === 'code') {
      mutation = `#graphql
        mutation UpdateCodeDiscount($id: ID!, $input: DiscountCodeAppInput!) {
          discountCodeAppUpdate(id: $id, codeAppDiscount: $input) {
            userErrors { field message }
          }
        }`
      variables = {
        id,
        input: {
          title,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          usageLimit: body.usageLimit,
          combinesWith: def.owner?.combinesWith,
          metafields: [metafield],
        },
      }
    } else if (def.type === 'delivery-customization') {
      mutation = `#graphql
        mutation UpdateDeliveryCustomization($id: ID!, $input: DeliveryCustomizationInput!) {
          deliveryCustomizationUpdate(id: $id, deliveryCustomization: $input) {
            userErrors { field message }
          }
        }`
      variables = { id, input: { title, enabled: body.enabled, metafields: [metafield] } }
    } else if (def.type === 'payment-customization') {
      mutation = `#graphql
        mutation UpdatePaymentCustomization($id: ID!, $input: PaymentCustomizationInput!) {
          paymentCustomizationUpdate(id: $id, paymentCustomization: $input) {
            userErrors { field message }
          }
        }`
      variables = { id, input: { title, enabled: body.enabled, metafields: [metafield] } }
    } else if (def.type === 'checkout-validation') {
      mutation = `#graphql
        mutation UpdateValidation($id: ID!, $input: ValidationUpdateInput!) {
          validationUpdate(id: $id, validation: $input) {
            userErrors { field message }
          }
        }`
      variables = { id, input: { title, enable: body.enabled, blockOnFailure: body.blockOnFailure, metafields: [metafield] } }
    } else {
      return c.json({ error: `Unsupported function type for update: ${def.type}` }, 400)
    }

    const result = await shopify.graphql(mutation, { variables })
    const errors = extractErrors(result)

    if (errors.length) {
      return c.json({ error: errors.map((e) => e.message).join(', '), userErrors: errors }, 400)
    }

    return c.json({ ok: true })
  })

  // Delete a function instance
  api.delete('/functions/:handle/instances/:id', async (c) => {
    const config = getConfig()
    const shop = getShop(c)
    const handle = c.req.param('handle')
    const id = c.req.param('id')
    const def = config.functions ? Object.values(config.functions).find((f) => f.handle === handle) : undefined
    if (!def) return c.json({ error: 'Function not found' }, 404)

    const rawMode = c.req.query('mode')
    if (def.type === 'discount' && (def.modes?.length ?? 0) > 1 && rawMode !== 'automatic' && rawMode !== 'code') {
      return c.json({ error: 'mode query parameter is required for discount functions with multiple modes' }, 400)
    }
    const mode: DiscountMode = rawMode === 'automatic' || rawMode === 'code' ? rawMode : def.modes?.[0] ?? 'automatic'
    const mutations = getMutations(def, mode)
    if (!mutations) return c.json({ error: `Function type "${def.type}" has no GraphQL API` }, 400)

    const { createShopifyClient } = await import('../shopify/client.js')
    const shopify = await createShopifyClient(shop)

    const mutation = `#graphql
      mutation DeleteFunctionInstance($id: ID!) {
        ${mutations.delete}(id: $id) {
          userErrors { field message }
        }
      }`

    const result = await shopify.graphql(mutation, { variables: { id } })
    const errors = extractErrors(result)

    if (errors.length) {
      return c.json({ error: errors.map((e) => e.message).join(', '), userErrors: errors }, 400)
    }

    return c.json({ ok: true })
  })

  return api
}
