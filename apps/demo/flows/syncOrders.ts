import { type } from 'arktype'
import { app } from '#app'

type RecentOrder = {
  node: {
    id: string
    name: string
    totalPriceSet: { shopMoney: { currencyCode: string } }
    lineItems: { edges: unknown[] }
  }
}

type WarehouseOrder = {
  id: string
  name: string
  total: string
  items: number
}

export const syncOrders = app.defineFlow({
  name: 'syncOrders',
  input: type({ limit: 'number.integer > 0' }),

  async run({ input, shopify, connectors, step, logger }) {
    // input.limit is typed as number
    const orders = await step('fetch-orders', async () => {
      logger.info({ limit: input.limit }, 'Fetching latest orders from Shopify...')

      const data = await shopify.graphql(`#graphql
        query GetRecentOrders($first: Int!) {
          orders(first: $first, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                id
                customer {
                  displayName
                }
                name
                totalPriceSet { shopMoney { amount currencyCode } }
                lineItems(first: 5) { edges { node { title quantity } } }
              }
            }
          }
        }
      `, { variables: { first: input.limit } })

      return data.orders.edges.map((edge: RecentOrder): WarehouseOrder => ({
        id: edge.node.id,
        name: edge.node.name,
        total: edge.node.totalPriceSet.shopMoney.currencyCode,
        items: edge.node.lineItems.edges.length,
      }))
    })

    logger.info({ count: orders.length }, `Fetched ${orders.length} orders`)

    const transformed = await step('transform-data', async () => {
      return orders.map((order: WarehouseOrder) => ({
        ref: order.name,
        amount: order.total,
        lineCount: order.items,
        exportedAt: new Date().toISOString(),
      }))
    })

    await step('send-to-warehouse', async () => {
      logger.info({ records: transformed.length }, 'Sending to warehouse API...')
      await connectors.warehouse.push(transformed)
      logger.info({}, 'Successfully sent to warehouse')
    })
  },
})
