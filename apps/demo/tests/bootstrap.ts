import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import { configure, processCLIArgs, run } from '@japa/runner'
import { createTestContext } from 'openshop/test'

// Boot test server + proxy client
export const ctx = await createTestContext({ accessToken: 'test-access-token' })

const originalFetch = globalThis.fetch

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  if (url.includes('/admin/api/') && url.endsWith('/graphql.json')) {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { query?: string } : {}
    const query = body.query ?? ''

    if (query.includes('GetRecentOrders')) {
      return Response.json({
        data: {
          orders: {
            edges: [
              {
                node: {
                  id: 'gid://shopify/Order/1',
                  name: '#1001',
                  customer: { displayName: 'Test Customer' },
                  totalPriceSet: { shopMoney: { amount: '42.00', currencyCode: 'EUR' } },
                  lineItems: { edges: [{ node: { title: 'Test product', quantity: 1 } }] },
                },
              },
            ],
          },
        },
      })
    }

    if (query.includes('GetProductFull')) {
      return Response.json({
        data: {
          product: {
            id: 'gid://shopify/Product/1',
            title: 'Test product',
            handle: 'test-product',
            descriptionHtml: '<p>Test</p>',
            productType: 'Demo',
            vendor: 'OpenShop',
            status: 'ACTIVE',
            tags: ['demo'],
            variantsCount: { count: 1 },
            totalInventory: 12,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            publishedAt: new Date().toISOString(),
            onlineStoreUrl: null,
            options: [{ name: 'Title', values: ['Default Title'] }],
            media: { edges: [] },
            variants: {
              edges: [
                {
                  node: {
                    id: 'gid://shopify/ProductVariant/1',
                    title: 'Default Title',
                    sku: 'SKU-1',
                    price: '42.00',
                    compareAtPrice: null,
                    inventoryQuantity: 12,
                    selectedOptions: [{ name: 'Title', value: 'Default Title' }],
                  },
                },
              ],
            },
            seo: { title: 'Test product', description: 'Test' },
          },
        },
      })
    }

    return Response.json({ data: {} })
  }

  return originalFetch(input, init)
}

processCLIArgs(process.argv.splice(2))

configure({
  files: ['tests/**/*.spec.ts'],
  plugins: [
    assert(),
    apiClient(ctx.url),
  ],
  setup: [
    () => async () => {
      globalThis.fetch = originalFetch
      await ctx.shutdown()
    },
  ],
})

run()
