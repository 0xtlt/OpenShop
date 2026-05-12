import { defineFlow } from 'openshop'
import { type } from 'arktype'

export const countVariants = defineFlow({
  name: 'countVariants',
  input: type({ productId: 'string' }),

  async run({ input, shopify, step, logger }) {
    const product = await step('fetch-product', async () => {
      logger.info({ productId: input.productId }, 'Fetching full product details...')

      const data = await shopify.graphql(`#graphql
        query GetProductFull($id: ID!) {
          product(id: $id) {
            id
            title
            handle
            descriptionHtml
            productType
            vendor
            status
            tags
            variantsCount {
              count
            }
            totalInventory
            createdAt
            updatedAt
            publishedAt
            onlineStoreUrl
            options {
              name
              values
            }
            media(first: 10) {
              edges {
                node {
                  ... on MediaImage {
                    id
                    image {
                      url
                      altText
                      width
                      height
                    }
                  }
                }
              }
            }
            variants(first: 20) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  compareAtPrice
                  inventoryQuantity
                  selectedOptions {
                    name
                    value
                  }
                }
              }
            }
            seo {
              title
              description
            }
          }
        }
      `, { variables: { id: input.productId } })

      return data.product
    })

    logger.info({ title: product?.title, variants: product?.variantsCount?.count, inventory: product?.totalInventory }, 'Product fetched')

    const summary = await step('build-summary', async () => {
      return {
        id: product?.id,
        title: product?.title,
        handle: product?.handle,
        vendor: product?.vendor,
        type: product?.productType,
        status: product?.status,
        tags: product?.tags,
        totalVariants: product?.variantsCount?.count,
        totalInventory: product?.totalInventory,
        options: product?.options,
        imageCount: product?.media?.edges?.length ?? 0,
        variantSkus: product?.variants?.edges?.map((e) => ({
          title: e.node.title,
          sku: e.node.sku,
          price: e.node.price,
          inventory: e.node.inventoryQuantity,
        })),
        seo: product?.seo,
        createdAt: product?.createdAt,
        updatedAt: product?.updatedAt,
      }
    })

    logger.info({ variantCount: summary.totalVariants, imageCount: summary.imageCount }, `Product "${summary.title}" has ${summary.totalVariants} variant(s)`)
  },
})
