import { Hono } from 'hono'
import { getShop, getShopifyApp } from '#server/shop'
import type { OpenShopConfig, DiscountMode } from '#types'
import { validateFunctionConfig } from '#server/function-config'
import {
  METAFIELD_NAMESPACE,
  buildCreateMutation,
  buildDeleteMutation,
  buildUpdateMutation,
  extractErrors,
  extractPayload,
  getMutations,
  gql,
  resolveTitle,
} from '#server/function-mutations'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonBody(req: { json: <T>() => Promise<T> }): Promise<Record<string, unknown>> {
  const body = await req.json<unknown>().catch(() => ({}))
  return isRecord(body) ? body : {}
}

function discountModeFromBody(body: Record<string, unknown>, fallback: DiscountMode): DiscountMode {
  return body.mode === 'automatic' || body.mode === 'code' ? body.mode : fallback
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
    const shopifyApp = getShopifyApp(c)
    const handle = c.req.param('handle')
    const def = config.functions ? Object.values(config.functions).find((f) => f.handle === handle) : undefined
    if (!def) return c.json({ error: 'Function not found' }, 404)

    const mutations = getMutations(def)
    if (!mutations) return c.json({ error: `Function type "${def.type}" has no GraphQL API` }, 400)

    const { createShopifyClient } = await import('../shopify/client.ts')
    const shopify = await createShopifyClient(shop, shopifyApp)

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
    const shopifyApp = getShopifyApp(c)
    const handle = c.req.param('handle')
    const def = config.functions ? Object.values(config.functions).find((f) => f.handle === handle) : undefined
    if (!def) return c.json({ error: 'Function not found' }, 404)

    const mutations = getMutations(def)
    if (!mutations) return c.json({ error: `Function type "${def.type}" has no GraphQL API` }, 400)

    const body = await readJsonBody(c.req)
    const parsedConfig = validateFunctionConfig(def, body.config)
    if (!parsedConfig.ok) return c.json({ error: parsedConfig.error }, 400)
    const fnConfig = parsedConfig.config
    const mode = discountModeFromBody(body, def.modes?.[0] ?? 'automatic')

    const { createShopifyClient } = await import('../shopify/client.ts')
    const shopify = await createShopifyClient(shop, shopifyApp)

    const title = resolveTitle(def.owner, fnConfig)
    const request = buildCreateMutation(def, handle, mode, title, fnConfig, body)
    if (!request) {
      return c.json({ error: `Unsupported function type: ${def.type}` }, 400)
    }

    const result = await shopify.graphql(request.mutation, { variables: request.variables })
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
    const shopifyApp = getShopifyApp(c)
    const handle = c.req.param('handle')
    const id = c.req.param('id')
    const def = config.functions ? Object.values(config.functions).find((f) => f.handle === handle) : undefined
    if (!def) return c.json({ error: 'Function not found' }, 404)

    const body = await readJsonBody(c.req)
    const mode = discountModeFromBody(body, def.modes?.[0] ?? 'automatic')
    const mutations = getMutations(def, mode)
    if (!mutations?.update) {
      return c.json({ error: `Function type "${def.type}" does not support update. Delete and recreate instead.` }, 400)
    }

    const parsedConfig = validateFunctionConfig(def, body.config)
    if (!parsedConfig.ok) return c.json({ error: parsedConfig.error }, 400)
    const fnConfig = parsedConfig.config

    const { createShopifyClient } = await import('../shopify/client.ts')
    const shopify = await createShopifyClient(shop, shopifyApp)

    const title = resolveTitle(def.owner, fnConfig)
    const request = buildUpdateMutation(def, handle, mode, id, title, fnConfig, body)
    if (!request) {
      return c.json({ error: `Unsupported function type for update: ${def.type}` }, 400)
    }

    const result = await shopify.graphql(request.mutation, { variables: request.variables })
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
    const shopifyApp = getShopifyApp(c)
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

    const { createShopifyClient } = await import('../shopify/client.ts')
    const shopify = await createShopifyClient(shop, shopifyApp)

    const request = buildDeleteMutation(mutations.delete, id)
    const result = await shopify.graphql(request.mutation, { variables: request.variables })
    const errors = extractErrors(result)

    if (errors.length) {
      return c.json({ error: errors.map((e) => e.message).join(', '), userErrors: errors }, 400)
    }

    return c.json({ ok: true })
  })

  return api
}
