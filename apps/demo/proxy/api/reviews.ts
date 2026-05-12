import { defineProxy } from 'openshop'

export default defineProxy({
  type: 'json',

  async GET({ shop, query }) {
    const page = Number(query.page) || 1
    return {
      shop,
      page,
      reviews: [
        { id: 1, author: 'Alice', rating: 5, text: 'Great product!' },
        { id: 2, author: 'Bob', rating: 4, text: 'Very good quality.' },
      ],
    }
  },

  async POST({ shop, body, customerId }) {
    if (!customerId) {
      return { error: 'Must be logged in to submit a review' }
    }
    return { ok: true, shop, customerId, review: body }
  },
})
