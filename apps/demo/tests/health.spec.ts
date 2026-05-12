import { test } from '@japa/runner'

test.group('Health', () => {
  test('GET /health returns ok', async ({ client, assert }) => {
    const res = await client.get('/health')

    res.assertStatus(200)
    assert.property(res.body(), 'status')
    assert.equal(res.body().status, 'ok')
  })
})
