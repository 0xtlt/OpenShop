import { defineModel, text, integer, boolean } from 'openshop/schema'

export const reviews = defineModel('reviews', {
  productId: text('product_id').notNull(),
  customerId: text('customer_id').notNull(),
  rating: integer('rating').notNull(),
  text: text('text').notNull(),
  approved: boolean('approved').default(false),
})
