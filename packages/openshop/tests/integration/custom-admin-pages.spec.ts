import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import { encryptString } from '#server/crypto'
import { createServer } from '#server/index'
import type { OpenShopConfig } from '#types'
import { truncateAll, TEST_SHOP } from './helpers.ts'

const secret = process.env.SHOPIFY_API_SECRET!

function jwt(sub = '123') {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${TEST_SHOP}/admin`,
    dest: `https://${TEST_SHOP}`,
    aud: 'test-app',
    sub,
    exp: now + 3600,
    nbf: now - 10,
    iat: now,
    jti: 'custom-page-test',
    sid: 'custom-page-session',
  })).toString('base64url')
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

test.group('custom admin page RPC', (group) => {
  let directory: string
  let app: Awaited<ReturnType<typeof createServer>>
  let config: OpenShopConfig

  group.each.setup(async () => {
    await truncateAll()
    await getDb().insert(installations).values({
      appHandle: 'default',
      shop: TEST_SHOP,
      accessToken: encryptString('test-access-token'),
      scopes: 'read_products',
    })

    directory = mkdtempSync(join(tmpdir(), 'openshop-admin-rpc-'))
    const parentServerFile = join(directory, 'reviews.actions.js')
    writeFileSync(parentServerFile, `
      export const pageAccess = ({ actor }) => actor.id === '123'
    `)
    const childServerFile = join(directory, 'review-details.actions.js')
    writeFileSync(childServerFile, `
      export const details = {
        kind: 'loader',
        handler: ({ params, actor, shop, shopifyApp }) => ({
          id: params.id,
          actorId: actor.id,
          shop,
          shopifyApp,
        }),
      }
    `)
    writeFileSync(join(directory, 'admin-pages.json'), JSON.stringify([
      {
        id: 'reviews',
        path: '/reviews',
        routePattern: '/reviews',
        sourceFile: 'reviews/page.tsx',
        serverFile: pathToFileURL(parentServerFile).pathname,
      },
      {
        id: 'reviews/[id]',
        path: '/reviews/[id]',
        routePattern: '/reviews/:id',
        sourceFile: 'reviews/[id]/page.tsx',
        serverFile: pathToFileURL(childServerFile).pathname,
      },
    ]))

    config = {
      providers: {},
      flows: {},
      experimental: {
        customPages: {
          navigation: [{ label: 'Reviews', path: '/reviews' }],
        },
      },
    }
    app = await createServer(() => config, { adminPagesDir: directory })
    return () => rmSync(directory, { recursive: true, force: true })
  })

  const request = (path: string, sub = '123', init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${jwt(sub)}`)
    headers.set('content-type', 'application/json')
    return app.request(path, { ...init, headers })
  }

  test('passes trusted identity and dynamic params to a loader', async ({ assert }) => {
    const invoke = (id: string) => request(
      `/api/pages/custom/reviews/${id}/_rpc/loader/details`,
      '123',
      { method: 'POST', body: JSON.stringify({ input: null }) },
    )
    const firstResponse = await invoke('41')
    const response = await invoke('42')

    assert.equal(firstResponse.status, 200)
    assert.equal((await firstResponse.json() as { id: string }).id, '41')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      id: '42',
      actorId: '123',
      shop: TEST_SHOP,
      shopifyApp: 'default',
    })
  })

  test('inherits parent page policy for child direct access and RPC', async ({ assert }) => {
    const access = await request('/api/pages/custom/access?path=%2Freviews%2F42', '456')
    assert.equal(access.status, 200)
    assert.deepEqual(await access.json(), { allowed: false })

    const rpc = await request(
      '/api/pages/custom/reviews/42/_rpc/loader/details',
      '456',
      { method: 'POST', body: JSON.stringify({ input: null }) },
    )
    assert.equal(rpc.status, 403)
  })

  test('degrades invalid custom navigation without blocking built-in pages', async ({ assert }) => {
    config.experimental = {
      customPages: {
        navigation: [{ label: 'Missing', path: '/missing' }],
      },
    }

    const customPages = await request('/api/pages/custom')
    assert.equal(customPages.status, 200)
    assert.deepEqual(await customPages.json(), { navigation: [], pages: [] })

    const builtInPages = await request('/api/pages')
    assert.equal(builtInPages.status, 200)
  })

  test('rejects RPC requests without a session token', async ({ assert }) => {
    const response = await app.request(
      '/api/pages/custom/reviews/42/_rpc/loader/details',
      { method: 'POST', body: JSON.stringify({ input: null }) },
    )
    assert.equal(response.status, 401)
  })
})
