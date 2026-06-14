import { test } from '@japa/runner'
import { ctx } from './bootstrap.ts'

test.group('Flows', (group) => {
  group.each.setup(() => ctx.resetFakes())

  test('list flows', async ({ client }) => {
    const res = await client
      .get('/api/flows')
      .header('Authorization', ctx.authorizationHeader())
    res.assertStatus(200)
  })

  test('run syncOrders with faked warehouse', async ({ assert }) => {
    ctx.fakes.warehouse.push.returns(false)

    const result = await ctx.runFlow('syncOrders', { limit: 5 })

    assert.equal(result.status, 'completed')
    assert.isTrue(ctx.fakes.warehouse.push.called)
    assert.equal(ctx.fakes.warehouse.push.callCount, 1)
  })

  test('handles warehouse failure', async ({ assert }) => {
    ctx.fakes.warehouse.push.rejects(new Error('503 Service Unavailable'))

    const result = await ctx.runFlow('syncOrders', { limit: 1 })

    assert.equal(result.status, 'failed')
  })

  test('rejects invalid input', async ({ assert }) => {
    const result = await ctx.runFlow('syncOrders', {})

    assert.equal(result.status, 'failed')
  })
})
