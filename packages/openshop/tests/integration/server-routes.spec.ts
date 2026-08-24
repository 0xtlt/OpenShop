import { test } from '@japa/runner'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb } from '#db/client'
import { installations, providerConfigs } from '#db/schema'
import { encryptConfig } from '#server/crypto'
import { createServer } from '#server/index'
import { createServerRoutes } from '#server/routes'
import type { OpenShopConfig } from '#types'
import { truncateAll } from './helpers.ts'

const openRoute = `
export default {
  auth: 'none',
  GET: ({ params }) => Response.json({ route: 'open', params }, {
    status: 201,
    headers: { 'x-server-route': 'open' },
  }),
}
`

const authenticatedRoute = `
export default {
  auth: async ({ request }) => {
    const body = await request.json()
    return body.token === 'valid' ? { subject: 'provider-webhook' } : null
  },
  POST: async ({ request, auth }) => {
    const body = await request.json()
    return Response.json({ auth, body })
  },
}
`

const staticRoute = `
export default {
  auth: 'none',
  GET: () => Response.json({ route: 'new' }),
}
`

const providerRoute = `
export default {
  auth: async ({ request, forShop }) => {
    const url = new URL(request.url)
    try {
      const shopContext = await forShop({
        shop: url.searchParams.get('shop') ?? '',
        shopifyApp: url.searchParams.get('app') ?? undefined,
      })
      if (url.searchParams.get('token') !== 'valid') return null
      return {
        shop: shopContext.shop,
        shopifyApp: shopContext.shopifyApp,
        value: await shopContext.connectors.vault.reveal('value'),
        contextKeys: Object.keys(shopContext).sort(),
      }
    } catch {
      return null
    }
  },
  POST: ({ auth }) => Response.json(auth),
}
`

const MULTI_SHOPIFY = {
  scopes: 'read_products',
  apps: {
    clientA: {
      apiKey: 'client-a-key',
      apiSecret: 'client-a-secret',
      appUrl: 'https://client-a.example.test',
    },
    clientB: {
      apiKey: 'client-b-key',
      apiSecret: 'client-b-secret',
      appUrl: 'https://client-b.example.test',
    },
  },
}

const vaultProvider = {
  name: 'Vault',
  ui: { fields: { secret: { type: 'password' as const, label: 'Secret' } } },
  methods: {
    reveal(config: Record<string, unknown>, prefix: string) {
      return `${prefix}:${String(config.secret)}`
    },
  },
}

function config(): OpenShopConfig {
  return {
    shopify: MULTI_SHOPIFY,
    providers: { vault: vaultProvider },
    flows: {},
  }
}

test.group('Public server routes', (group) => {
  let routesDir: string

  group.setup(() => {
    routesDir = mkdtempSync(join(tmpdir(), 'openshop-server-routes-'))
    writeFileSync(join(routesDir, 'index.ts'), openRoute.trimStart(), 'utf8')
    writeFileSync(join(routesDir, 'authenticated.ts'), authenticatedRoute.trimStart(), 'utf8')
    writeFileSync(join(routesDir, 'provider.ts'), providerRoute.trimStart(), 'utf8')
    writeFileSync(join(routesDir, '_private.ts'), openRoute.trimStart(), 'utf8')
    mkdirSync(join(routesDir, '_shared'))
    writeFileSync(join(routesDir, '_shared', 'hidden.ts'), openRoute.trimStart(), 'utf8')
    mkdirSync(join(routesDir, 'orders'))
    writeFileSync(join(routesDir, 'orders', '[id].ts'), openRoute.trimStart(), 'utf8')
    writeFileSync(join(routesDir, 'orders', 'new.ts'), staticRoute.trimStart(), 'utf8')
    writeFileSync(join(routesDir, 'forbidden.ts'), `
export default {
  auth: () => new Response('Forbidden', { status: 403 }),
  POST: () => new Response('unreachable'),
}
`.trimStart(), 'utf8')
    writeFileSync(join(routesDir, 'throws.ts'), `
export default {
  auth: 'none',
  GET: () => { throw new Error('route failure') },
}
`.trimStart(), 'utf8')
    writeFileSync(join(routesDir, 'auth-throws.ts'), `
export default {
  auth: () => { throw new Error('authentication failure') },
  POST: () => new Response('unreachable'),
}
`.trimStart(), 'utf8')
    writeFileSync(join(routesDir, 'invalid-response.ts'), `
export default {
  auth: 'none',
  GET: () => ({ ok: true }),
}
`.trimStart(), 'utf8')
  })

  group.each.setup(async () => {
    await truncateAll()
  })

  group.teardown(() => {
    rmSync(routesDir, { recursive: true, force: true })
  })

  test('mounts index and dynamic files under /routes', async ({ assert }) => {
    const app = await createServer(config, { routesDir })

    const root = await app.request('http://localhost/routes')
    assert.equal(root.status, 201)
    assert.equal(root.headers.get('x-server-route'), 'open')

    const dynamic = await app.request('http://localhost/routes/orders/123')
    assert.equal(dynamic.status, 201)
    assert.deepEqual((await dynamic.json()).params, { id: '123' })

    const staticRouteResponse = await app.request('http://localhost/routes/orders/new')
    assert.equal(staticRouteResponse.status, 200)
    assert.deepEqual(await staticRouteResponse.json(), { route: 'new' })

    assert.equal((await app.request('http://localhost/routes/_private')).status, 404)
    assert.equal((await app.request('http://localhost/routes/_shared/hidden')).status, 404)
  })

  test('returns 405 and Allow for a method without a handler', async ({ assert }) => {
    const app = await createServerRoutes(routesDir, config)
    const response = await app.request('http://localhost/', { method: 'POST' })
    const headResponse = await app.request('http://localhost/', { method: 'HEAD' })

    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET')
    assert.equal(headResponse.status, 405)
  })

  test('auth can read a cloned body and passes typed data to the handler', async ({ assert }) => {
    const app = await createServerRoutes(routesDir, config)
    const response = await app.request('http://localhost/authenticated', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'valid', event: 'created' }),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      auth: { subject: 'provider-webhook' },
      body: { token: 'valid', event: 'created' },
    })
  })

  test('auth null returns 401 and an auth Response short-circuits', async ({ assert }) => {
    const app = await createServerRoutes(routesDir, config)
    const unauthorized = await app.request('http://localhost/authenticated', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'invalid' }),
    })
    const forbidden = await app.request('http://localhost/forbidden', { method: 'POST' })

    assert.equal(unauthorized.status, 401)
    assert.equal(forbidden.status, 403)
    assert.equal(await forbidden.text(), 'Forbidden')
  })

  test('authentication and handler exceptions, and non-Response values, fail with 500', async ({ assert }) => {
    const app = await createServerRoutes(routesDir, config)
    const authThrown = await app.request('http://localhost/auth-throws', { method: 'POST' })
    const thrown = await app.request('http://localhost/throws')
    const invalid = await app.request('http://localhost/invalid-response')

    assert.equal(authThrown.status, 500)
    assert.equal(thrown.status, 500)
    assert.equal(invalid.status, 500)
    assert.deepEqual(await thrown.json(), { error: 'Internal server route error' })
  })

  test('forShop loads only the active app and shop connectors', async ({ assert }) => {
    const db = getDb()
    await db.insert(installations).values([
      { appHandle: 'clientA', shop: 'a.myshopify.com', accessToken: 'token-a' },
      { appHandle: 'clientB', shop: 'b.myshopify.com', accessToken: 'token-b' },
      { appHandle: 'clientB', shop: 'inactive.myshopify.com', accessToken: null, uninstalledAt: new Date() },
    ])
    await db.insert(providerConfigs).values([
      { appHandle: 'clientA', shop: 'a.myshopify.com', providerName: 'vault', config: encryptConfig({ secret: 'secret-a' }) },
      { appHandle: 'clientB', shop: 'b.myshopify.com', providerName: 'vault', config: encryptConfig({ secret: 'secret-b' }) },
      { appHandle: 'clientB', shop: 'inactive.myshopify.com', providerName: 'vault', config: encryptConfig({ secret: 'stale' }) },
    ])

    const app = await createServerRoutes(routesDir, config)
    const active = await app.request('http://localhost/provider?shop=b.myshopify.com&app=clientB&token=valid', { method: 'POST' })
    const inactive = await app.request('http://localhost/provider?shop=inactive.myshopify.com&app=clientB&token=valid', { method: 'POST' })
    const invalidShop = await app.request('http://localhost/provider?shop=not-a-shop&app=clientB&token=valid', { method: 'POST' })
    const unknownApp = await app.request('http://localhost/provider?shop=b.myshopify.com&app=unknown&token=valid', { method: 'POST' })

    assert.equal(active.status, 200)
    assert.deepEqual(await active.json(), {
      shop: 'b.myshopify.com',
      shopifyApp: 'clientB',
      value: 'value:secret-b',
      contextKeys: ['connectors', 'shop', 'shopifyApp'],
    })
    assert.equal(inactive.status, 401)
    assert.equal(invalidShop.status, 401)
    assert.equal(unknownApp.status, 401)
  })

  test('fails startup for a missing auth declaration, handler, or invalid import', async ({ assert }) => {
    const invalidDir = mkdtempSync(join(tmpdir(), 'openshop-invalid-server-route-'))
    try {
      writeFileSync(join(invalidDir, 'missing-auth.ts'), 'export default { GET: () => new Response() }', 'utf8')
      await assert.rejects(() => createServerRoutes(invalidDir, config), /auth must be "none" or a function/)

      rmSync(join(invalidDir, 'missing-auth.ts'))
      writeFileSync(join(invalidDir, 'missing-handler.ts'), "export default { auth: 'none' }", 'utf8')
      await assert.rejects(() => createServerRoutes(invalidDir, config), /define at least one HTTP method/)

      rmSync(join(invalidDir, 'missing-handler.ts'))
      writeFileSync(join(invalidDir, 'broken.ts'), 'export default {', 'utf8')
      await assert.rejects(() => createServerRoutes(invalidDir, config), /Failed to load server route/)
    } finally {
      rmSync(invalidDir, { recursive: true, force: true })
    }
  })
})
