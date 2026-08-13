import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { createServer } from '#server/index'
import { createConfig, TEST_SHOP } from './helpers.ts'

const SECRET = process.env.SHOPIFY_API_SECRET!

function createJwt(shop = TEST_SHOP): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: 'test-app',
    sub: '123',
    exp: now + 3600,
    nbf: now - 10,
    iat: now,
    jti: 'jti-test',
    sid: 'sid-test',
  })).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const simpleFlow = {
  name: 'test-flow',
  async run() {},
}

test.group('Admin page visibility', () => {
  const req = (app: Awaited<ReturnType<typeof createServer>>, path: string) => {
    return app.request(path, {
      headers: { Authorization: `Bearer ${createJwt()}` },
    })
  }

  test('GET /api/pages returns visible defaults', async ({ assert }) => {
    const app = await createServer(() => createConfig({ 'test-flow': simpleFlow }))
    const res = await req(app, '/api/pages')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      flows: 'visible',
      providers: 'visible',
      crons: 'visible',
      functions: 'visible',
      mcp: 'visible',
    })
  })

  test('hidden pages remain reachable on the admin API', async ({ assert }) => {
    const app = await createServer(() => createConfig({ 'test-flow': simpleFlow }, {
      pages: { functions: 'hidden', mcp: 'hidden' },
    }))

    const pages = await req(app, '/api/pages')
    assert.equal(pages.status, 200)
    assert.deepEqual(await pages.json(), {
      flows: 'visible',
      providers: 'visible',
      crons: 'visible',
      functions: 'hidden',
      mcp: 'hidden',
    })

    assert.equal((await req(app, '/api/functions')).status, 200)
    assert.equal((await req(app, '/api/mcp/capabilities')).status, 200)
    assert.equal((await req(app, '/api/flows')).status, 200)
  })

  test('disabled pages return 404 on their admin API group', async ({ assert }) => {
    const app = await createServer(() => createConfig({ 'test-flow': simpleFlow }, {
      pages: {
        flows: 'disabled',
        functions: 'disabled',
        mcp: 'disabled',
      },
    }))

    const pages = await req(app, '/api/pages')
    assert.equal(pages.status, 200)
    assert.equal((await pages.json()).flows, 'disabled')

    assert.equal((await req(app, '/api/flows')).status, 404)
    assert.equal((await req(app, '/api/runs?limit=10')).status, 404)
    assert.equal((await req(app, '/api/functions')).status, 404)
    assert.equal((await req(app, '/api/mcp/capabilities')).status, 404)

    assert.equal((await req(app, '/api/providers')).status, 200)
    assert.equal((await req(app, '/api/crons')).status, 200)
  })
})
