import { test } from '@japa/runner'
import { startApiServer } from '#server/index'
import { closeHttpServer } from '#server/http'
import { createConfig, truncateAll } from './helpers.ts'

const simpleFlow = {
  name: 'test-flow',
  async run() {},
}

test.group('server startup', (group) => {
  group.each.setup(() => truncateAll())

  test('startApiServer returns a closable server handle that can rebind the same port', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const port = 45_000 + Math.floor(Math.random() * 5_000)

    const firstServer = await startApiServer(config, port)

    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`)
      assert.equal(health.status, 200)
    } finally {
      await closeHttpServer(firstServer)
    }

    const secondServer = await startApiServer(config, port)
    await closeHttpServer(secondServer)
  }).timeout(10_000)
})
