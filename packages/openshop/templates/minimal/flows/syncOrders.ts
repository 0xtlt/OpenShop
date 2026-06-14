import { type } from 'arktype'
import { app } from '../openshop.app.ts'

export const syncOrders = app.defineFlow({
  name: 'syncOrders',
  input: type({ limit: 'number.integer > 0' }),

  async run({ input, connectors, logger, shopify, step }) {
    const orders = await step('fetch-orders', async () => {
      logger.info({ limit: input.limit }, 'Fetching latest orders from Shopify...')

      const data = await shopify.graphql(`#graphql
        query GetRecentOrders($first: Int!) {
          orders(first: $first, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      `, { variables: { first: input.limit } })

      return data.orders.edges.map((edge) => ({
        id: edge.node.id,
        name: edge.node.name,
      }))
    })

    await step('send-to-warehouse', async () => {
      await connectors.warehouse.push(orders)
      logger.info({ count: orders.length }, 'Orders synced')
    })
  },
})
