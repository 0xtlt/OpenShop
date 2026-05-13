import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import { createServer } from '#server/index'
import { createConfig, truncateAll } from './helpers.ts'

const simpleFlow = { name: 'static-flow', async run() {} }
const secret = process.env.SHOPIFY_API_SECRET!

function signedLaunchUrl(path = '/', shop = 'static-test.myshopify.com'): string {
  const params: Record<string, string> = {
    host: 'admin.shopify.com/store/static-test',
    shop,
    timestamp: '1770000000',
  }
  const message = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&')
  const hmac = createHmac('sha256', secret).update(message).digest('hex')
  const query = new URLSearchParams({ ...params, hmac })
  return `http://localhost${path}?${query.toString()}`
}

test.group('Static files and SPA fallback', (group) => {
  let staticRoot: string
  let app: Awaited<ReturnType<typeof createServer>>

  group.setup(async () => {
    staticRoot = mkdtempSync(join(tmpdir(), 'openshop-static-test-'))
    writeFileSync(join(staticRoot, 'index.html'), '<html><body>spa-shell</body></html>', 'utf8')
    writeFileSync(join(staticRoot, 'asset.txt'), 'plain asset', 'utf8')
    const config = createConfig({ 'static-flow': simpleFlow })
    app = await createServer(() => config, { staticDir: staticRoot })
  })

  group.teardown(() => {
    rmSync(staticRoot, { recursive: true, force: true })
  })

  group.each.setup(() => truncateAll())

  test('GET serves file from staticDir', async ({ assert }) => {
    const res = await app.request('http://localhost/asset.txt')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive, nosnippet')
    assert.include(await res.text(), 'plain asset')
  })

  test('GET robots.txt disallows all crawlers', async ({ assert }) => {
    const res = await app.request('http://localhost/robots.txt')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive, nosnippet')
    assert.equal(await res.text(), 'User-agent: *\nDisallow: /\n')
  })

  test('GET root without a valid Shopify launch does not serve the app shell', async ({ assert }) => {
    const res = await app.request('http://localhost/')
    assert.equal(res.status, 401)
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive, nosnippet')
    const text = await res.text()
    assert.include(text, 'Open this app from Shopify admin')
    assert.notInclude(text, 'spa-shell')
  })

  test('GET unknown path without a valid Shopify launch does not serve SPA fallback', async ({ assert }) => {
    const res = await app.request('http://localhost/admin/deep/route')
    assert.equal(res.status, 401)
    const text = await res.text()
    assert.include(text, 'Open this app from Shopify admin')
    assert.notInclude(text, 'spa-shell')
  })

  test('GET with signed Shopify launch serves index.html for installed shops', async ({ assert }) => {
    await getDb().insert(installations).values({
      shop: 'static-test.myshopify.com',
      accessToken: 'offline-token',
      scopes: 'read_products',
    })

    const res = await app.request(signedLaunchUrl('/'))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive, nosnippet')
    const text = await res.text()
    assert.include(text, 'spa-shell')
  })

  test('GET with signed Shopify launch redirects uninstalled shops to auth', async ({ assert }) => {
    const res = await app.request(signedLaunchUrl('/', 'uninstalled.myshopify.com'))
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), '/auth?shop=uninstalled.myshopify.com')
  })
})
