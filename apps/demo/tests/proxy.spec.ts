import { test } from '@japa/runner'
import { type } from 'arktype'
import { ctx } from './bootstrap.js'

test.group('Proxy routes', () => {
  test('GET /reviews returns liquid', async ({ assert }) => {
    const res = await ctx.proxy.get('/reviews').send()

    assert.equal(res.status, 200)
    assert.include(res.contentType, 'application/liquid')
    assert.include(res.text, 'Reviews')
  })

  test('GET /api/reviews returns json', async ({ assert }) => {
    const res = await ctx.proxy.get('/api/reviews')
      .expect(type({ shop: 'string', page: 'number', reviews: 'unknown[]' }))
      .send()

    assert.equal(res.status, 200)
    assert.isArray(res.body.reviews)
    assert.equal(res.body.page, 1)
  })

  test('GET /api/reviews with query params', async ({ assert }) => {
    const res = await ctx.proxy.get('/api/reviews')
      .qs({ page: '2' })
      .expect(type({ page: 'number', 'reviews': 'unknown[]' }))
      .send()

    assert.equal(res.body.page, 2)
  })

  test('POST /api/reviews as anonymous returns error', async ({ assert }) => {
    const res = await ctx.proxy.post('/api/reviews')
      .json({ text: 'Spam', rating: 1 })
      .expect(type({ error: 'string' }))
      .send()

    assert.include(res.body.error, 'logged in')
  })

  test('POST /api/reviews as authenticated customer', async ({ assert }) => {
    const res = await ctx.proxy.post('/api/reviews')
      .asCustomer('789456')
      .json({ text: 'Great product!', rating: 5 })
      .expect(type({ ok: 'boolean', customerId: 'string', shop: 'string', review: 'unknown' }))
      .send()

    assert.equal(res.body.ok, true)
    assert.equal(res.body.customerId, '789456')
  })
})
