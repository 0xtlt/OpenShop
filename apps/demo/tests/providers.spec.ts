import { test } from '@japa/runner'
import { ctx } from './bootstrap.js'

test.group('Providers API', () => {
  test('list providers', async ({ client, assert }) => {
    const res = await client
      .get('/api/providers')
      .header('Authorization', ctx.authorizationHeader())

    res.assertStatus(200)
    const body = res.body()
    assert.isArray(body)
    assert.isAbove(body.length, 0)
  })

  test('each provider has fields', async ({ client, assert }) => {
    const res = await client
      .get('/api/providers')
      .header('Authorization', ctx.authorizationHeader())

    for (const provider of res.body()) {
      assert.property(provider, 'name')
      assert.property(provider, 'fields')
      assert.property(provider, 'config')
    }
  })
})
