import { test } from '@japa/runner'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServerRoutes } from '../../../src/server/routes.ts'

const config = () => ({ providers: {}, flows: {} })

test.group('public server route HTTP contract', (group) => {
  let routesDir: string

  group.each.setup(() => {
    routesDir = mkdtempSync(join(tmpdir(), 'openshop-route-unit-'))
    return () => rmSync(routesDir, { recursive: true, force: true })
  })

  test('discovers index, dynamic, and ignores underscore files', async ({ assert }) => {
    writeFileSync(join(routesDir, 'index.ts'), "export default { auth: 'none', GET: () => Response.json({ root: true }) }", 'utf8')
    writeFileSync(join(routesDir, '_private.ts'), "export default { auth: 'none', GET: () => new Response() }", 'utf8')
    mkdirSync(join(routesDir, 'orders'))
    writeFileSync(join(routesDir, 'orders', '[id].ts'), "export default { auth: 'none', GET: ({ params }) => Response.json(params) }", 'utf8')

    const app = await createServerRoutes(routesDir, config)
    assert.deepEqual(await (await app.request('http://localhost/')).json(), { root: true })
    assert.deepEqual(await (await app.request('http://localhost/orders/42')).json(), { id: '42' })
    assert.equal((await app.request('http://localhost/_private')).status, 404)
  })

  test('returns 405 with the declared methods', async ({ assert }) => {
    writeFileSync(join(routesDir, 'callback.ts'), "export default { auth: 'none', GET: () => new Response(), POST: () => new Response() }", 'utf8')

    const app = await createServerRoutes(routesDir, config)
    const response = await app.request('http://localhost/callback', { method: 'PUT' })
    const headResponse = await app.request('http://localhost/callback', { method: 'HEAD' })
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET, POST')
    assert.equal(headResponse.status, 405)
  })

  test('auth reads a cloned body and passes its result to the handler', async ({ assert }) => {
    writeFileSync(join(routesDir, 'callback.ts'), `
export default {
  auth: async ({ request }) => {
    const body = await request.json()
    return body.token === 'valid' ? { subject: 'signed-hook' } : null
  },
  POST: async ({ request, auth }) => Response.json({ auth, body: await request.json() }),
}
`.trimStart(), 'utf8')

    const app = await createServerRoutes(routesDir, config)
    const accepted = await app.request('http://localhost/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'valid', event: 'created' }),
    })
    const rejected = await app.request('http://localhost/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'invalid' }),
    })

    assert.equal(accepted.status, 200)
    assert.deepEqual(await accepted.json(), {
      auth: { subject: 'signed-hook' },
      body: { token: 'valid', event: 'created' },
    })
    assert.equal(rejected.status, 401)
  })

  test('auth Response short-circuits and handler failures return 500', async ({ assert }) => {
    writeFileSync(join(routesDir, 'forbidden.ts'), "export default { auth: () => new Response('Forbidden', { status: 403 }), POST: () => new Response('unreachable') }", 'utf8')
    writeFileSync(join(routesDir, 'auth-throws.ts'), "export default { auth: () => { throw new Error('auth failed') }, POST: () => new Response('unreachable') }", 'utf8')
    writeFileSync(join(routesDir, 'throws.ts'), "export default { auth: 'none', GET: () => { throw new Error('failed') } }", 'utf8')
    writeFileSync(join(routesDir, 'invalid.ts'), "export default { auth: 'none', GET: () => ({ ok: true }) }", 'utf8')

    const app = await createServerRoutes(routesDir, config)
    assert.equal((await app.request('http://localhost/forbidden', { method: 'POST' })).status, 403)
    assert.equal((await app.request('http://localhost/auth-throws', { method: 'POST' })).status, 500)
    assert.equal((await app.request('http://localhost/throws')).status, 500)
    assert.equal((await app.request('http://localhost/invalid')).status, 500)
  })

  test('fails startup when auth or handlers are missing', async ({ assert }) => {
    writeFileSync(join(routesDir, 'invalid.ts'), 'export default { GET: () => new Response() }', 'utf8')
    await assert.rejects(() => createServerRoutes(routesDir, config), /auth must be "none" or a function/)

    rmSync(join(routesDir, 'invalid.ts'))
    writeFileSync(join(routesDir, 'empty.ts'), "export default { auth: 'none' }", 'utf8')
    await assert.rejects(() => createServerRoutes(routesDir, config), /define at least one HTTP method/)

    rmSync(join(routesDir, 'empty.ts'))
    writeFileSync(join(routesDir, 'broken.ts'), 'export default {', 'utf8')
    await assert.rejects(() => createServerRoutes(routesDir, config), /Failed to load server route/)
  })
})
