import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { flowRuns, installations } from '#db/schema'
import { decryptString, encryptString } from '#server/crypto'
import { createServer } from '#server/index'
import { startScheduler, stopScheduler } from '#engine/scheduler'
import { createShopifyClient } from '../../src/shopify/client.ts'
import { CLIENT_CREDENTIALS_SHOP_ENV, getClientCredentialsToken } from '../../src/shopify/client-credentials.ts'
import { createConfig, truncateAll } from './helpers.ts'

const SHOP = 'cc-dev-store.myshopify.com'
const OTHER_SHOP = 'cc-merchant.myshopify.com'
const API_KEY = process.env.SHOPIFY_API_KEY!
const API_SECRET = process.env.SHOPIFY_API_SECRET!
const DAY_MS = 24 * 60 * 60 * 1000

interface Call {
  url: string
  body: string
  headers: Headers
}

type Responder = (call: Call) => Response | Promise<Response>

interface FakeShopify {
  tokenRequests: Call[]
  graphqlRequests: Call[]
  restore: () => void
}

/** Replaces fetch with a fake Shopify: `onToken` answers the token endpoint, `onGraphql` the Admin API. */
function fakeShopify(options: { onToken?: Responder; onGraphql?: Responder } = {}): FakeShopify {
  const originalFetch = globalThis.fetch
  const fake: FakeShopify = {
    tokenRequests: [],
    graphqlRequests: [],
    restore: () => { globalThis.fetch = originalFetch },
  }
  let issued = 0
  const onToken = options.onToken ?? (() => {
    issued += 1
    return Response.json({ access_token: `cc-token-${issued}`, scope: 'read_orders', expires_in: 86399 })
  })
  const onGraphql = options.onGraphql ?? (() => Response.json({ data: { shop: { name: 'Dev store' } } }))

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const call = { url, body: String(init?.body ?? ''), headers: new Headers(init?.headers) }
    if (url.endsWith('/admin/oauth/access_token')) {
      fake.tokenRequests.push(call)
      return onToken(call)
    }
    if (url.includes('/admin/api/')) {
      fake.graphqlRequests.push(call)
      return onGraphql(call)
    }
    return originalFetch(input, init)
  }
  return fake
}

function withClientCredentialsShop(value: string | undefined): () => void {
  const previous = process.env[CLIENT_CREDENTIALS_SHOP_ENV]
  if (value === undefined) delete process.env[CLIENT_CREDENTIALS_SHOP_ENV]
  else process.env[CLIENT_CREDENTIALS_SHOP_ENV] = value
  return () => {
    if (previous === undefined) delete process.env[CLIENT_CREDENTIALS_SHOP_ENV]
    else process.env[CLIENT_CREDENTIALS_SHOP_ENV] = previous
  }
}

async function storedInstallation(shop = SHOP) {
  const [row] = await getDb().select().from(installations)
    .where(and(eq(installations.appHandle, 'default'), eq(installations.shop, shop)))
    .limit(1)
  return row
}

async function storeToken(token: string, installedAt: Date, shop = SHOP) {
  await getDb().insert(installations).values({
    shop,
    accessToken: encryptString(token),
    scopes: 'read_orders',
    installedAt,
  })
}

const query = 'query { shop { name } }'

test.group('Client credentials token mode', (group) => {
  let restoreEnv: () => void = () => {}

  group.each.setup(async () => {
    await truncateAll()
    restoreEnv = withClientCredentialsShop(SHOP)
    return () => restoreEnv()
  })

  test('obtains a token by client credentials when none is stored', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const client = await createShopifyClient(SHOP)
      assert.deepEqual(await client.graphql(query), { shop: { name: 'Dev store' } })

      assert.lengthOf(shopify.tokenRequests, 1)
      const [tokenRequest] = shopify.tokenRequests
      assert.equal(tokenRequest!.url, `https://${SHOP}/admin/oauth/access_token`)
      assert.equal(tokenRequest!.headers.get('content-type'), 'application/x-www-form-urlencoded')
      const form = new URLSearchParams(tokenRequest!.body)
      assert.equal(form.get('grant_type'), 'client_credentials')
      assert.equal(form.get('client_id'), API_KEY)
      assert.equal(form.get('client_secret'), API_SECRET)

      assert.lengthOf(shopify.graphqlRequests, 1)
      assert.equal(shopify.graphqlRequests[0]!.url, `https://${SHOP}/admin/api/2026-04/graphql.json`)
      assert.equal(shopify.graphqlRequests[0]!.headers.get('x-shopify-access-token'), 'cc-token-1')

      const row = await storedInstallation()
      assert.isTrue(row!.accessToken!.startsWith('enc:'))
      assert.equal(decryptString(row!.accessToken), 'cc-token-1')
      assert.equal(row!.scopes, 'read_orders')
      assert.isNull(row!.uninstalledAt)
    } finally {
      shopify.restore()
    }
  })

  test('resolves the global placeholder shop to the configured shop', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const client = await createShopifyClient('__global__')
      await client.graphql(query)

      assert.equal(client.shop, SHOP)
      assert.equal(shopify.tokenRequests[0]!.url, `https://${SHOP}/admin/oauth/access_token`)
      assert.equal(shopify.graphqlRequests[0]!.url, `https://${SHOP}/admin/api/2026-04/graphql.json`)
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'cc-token-1')
    } finally {
      shopify.restore()
    }
  })

  test('reuses a stored token before it expires', async ({ assert }) => {
    await storeToken('stored-token', new Date(Date.now() - 60_000))
    const shopify = fakeShopify()
    try {
      const client = await createShopifyClient(SHOP)
      await client.graphql(query)
      await client.graphql(query)

      assert.lengthOf(shopify.tokenRequests, 0)
      assert.deepEqual(
        shopify.graphqlRequests.map((call) => call.headers.get('x-shopify-access-token')),
        ['stored-token', 'stored-token'],
      )
    } finally {
      shopify.restore()
    }
  })

  test('renews a stored token that is about to expire', async ({ assert }) => {
    await storeToken('expired-token', new Date(Date.now() - DAY_MS + 60_000))
    const shopify = fakeShopify()
    try {
      const client = await createShopifyClient(SHOP)
      await client.graphql(query)

      assert.lengthOf(shopify.tokenRequests, 1)
      assert.equal(shopify.graphqlRequests[0]!.headers.get('x-shopify-access-token'), 'cc-token-1')
      const row = await storedInstallation()
      assert.equal(decryptString(row!.accessToken), 'cc-token-1')
      assert.isAbove(row!.installedAt.getTime(), Date.now() - 60_000)
    } finally {
      shopify.restore()
    }
  })

  test('renews once and retries once when the Admin API answers 401', async ({ assert }) => {
    await storeToken('revoked-token', new Date())
    const shopify = fakeShopify({
      onGraphql: (call) => call.headers.get('x-shopify-access-token') === 'revoked-token'
        ? new Response('{"errors":"[API] Invalid API key or access token"}', { status: 401 })
        : Response.json({ data: { shop: { name: 'Dev store' } } }),
    })
    try {
      const client = await createShopifyClient(SHOP)
      assert.deepEqual(await client.graphql(query), { shop: { name: 'Dev store' } })

      assert.lengthOf(shopify.tokenRequests, 1)
      assert.deepEqual(
        shopify.graphqlRequests.map((call) => call.headers.get('x-shopify-access-token')),
        ['revoked-token', 'cc-token-1'],
      )
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'cc-token-1')
    } finally {
      shopify.restore()
    }
  })

  test('does not retry more than once on repeated 401', async ({ assert }) => {
    const shopify = fakeShopify({ onGraphql: () => new Response('unauthorized', { status: 401 }) })
    try {
      const client = await createShopifyClient(SHOP)
      await assert.rejects(() => client.graphql(query), /Shopify GraphQL error \(401\)/)
      assert.lengthOf(shopify.tokenRequests, 2)
      assert.lengthOf(shopify.graphqlRequests, 2)
    } finally {
      shopify.restore()
    }
  })

  test('concurrent callers share a single token request', async ({ assert }) => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const shopify = fakeShopify({
      onToken: async () => {
        await gate
        return Response.json({ access_token: 'shared-token', scope: 'read_orders', expires_in: 86399 })
      },
    })
    try {
      const pending = Promise.all([
        getClientCredentialsToken(SHOP),
        getClientCredentialsToken(SHOP),
        getClientCredentialsToken(SHOP),
      ])
      await new Promise((resolve) => setTimeout(resolve, 50))
      release()
      const tokens = await pending

      assert.deepEqual(tokens.map((token) => token.accessToken), ['shared-token', 'shared-token', 'shared-token'])
      assert.lengthOf(shopify.tokenRequests, 1)
    } finally {
      shopify.restore()
    }
  })

  test('a refusal names the status and Shopify error code, never the credentials', async ({ assert }) => {
    const shopify = fakeShopify({
      onToken: () => Response.json(
        { error: 'shop_not_permitted', error_description: `client ${API_KEY} is not permitted` },
        { status: 400 },
      ),
    })
    try {
      const client = await createShopifyClient(SHOP)
      let message = ''
      try {
        await client.graphql(query)
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }

      assert.include(message, 'HTTP 400')
      assert.include(message, 'shop_not_permitted')
      assert.include(message, 'same Shopify organization')
      assert.notInclude(message, API_SECRET)
      assert.notInclude(message, API_KEY)
      assert.lengthOf(shopify.graphqlRequests, 0)
      assert.isUndefined(await storedInstallation())
    } finally {
      shopify.restore()
    }
  })

  test('leaves other shops on the stored-token flow', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const client = await createShopifyClient(OTHER_SHOP)
      await assert.rejects(() => client.graphql(query), /No access token found for app "default" and shop "cc-merchant.myshopify.com"/)
      assert.lengthOf(shopify.tokenRequests, 0)
    } finally {
      shopify.restore()
    }
  })

  test('leaves other app handles on the stored-token flow', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const client = await createShopifyClient(SHOP, 'clientA')
      await assert.rejects(() => client.graphql(query), /No access token found for app "clientA"/)
      assert.lengthOf(shopify.tokenRequests, 0)
    } finally {
      shopify.restore()
    }
  })

  test('mode off keeps today\'s behaviour for the shop and the global placeholder', async ({ assert }) => {
    restoreEnv()
    restoreEnv = withClientCredentialsShop(undefined)
    const shopify = fakeShopify()
    try {
      const client = await createShopifyClient(SHOP)
      await assert.rejects(() => client.graphql(query), /No access token found for app "default" and shop "cc-dev-store.myshopify.com"/)
      const global = await createShopifyClient('__global__')
      await assert.rejects(() => global.graphql(query), /No access token found for app "default" and shop "__global__"/)
      assert.lengthOf(shopify.tokenRequests, 0)
    } finally {
      shopify.restore()
    }
  })

  test('rejects a configured value that is not a myshopify.com domain', async ({ assert }) => {
    restoreEnv()
    restoreEnv = withClientCredentialsShop('example.com')
    await assert.rejects(() => createShopifyClient(SHOP), /SHOPIFY_CLIENT_CREDENTIALS_SHOP must be a \*\.myshopify\.com domain/)
    await assert.rejects(() => createServer(() => createConfig({})), /SHOPIFY_CLIENT_CREDENTIALS_SHOP must be a \*\.myshopify\.com domain/)
  })

  test('requires the app credentials', async ({ assert }) => {
    const previousSecret = process.env.SHOPIFY_API_SECRET
    delete process.env.SHOPIFY_API_SECRET
    const shopify = fakeShopify()
    try {
      await assert.rejects(() => getClientCredentialsToken(SHOP), /requires SHOPIFY_API_KEY and SHOPIFY_API_SECRET/)
      assert.lengthOf(shopify.tokenRequests, 0)
    } finally {
      process.env.SHOPIFY_API_SECRET = previousSecret
      shopify.restore()
    }
  })
})

test.group('Client credentials token mode: crons', (group) => {
  let restoreEnv: () => void = () => {}

  group.each.setup(async () => {
    stopScheduler()
    await truncateAll()
    restoreEnv = withClientCredentialsShop(SHOP)
    return () => {
      stopScheduler()
      restoreEnv()
    }
  })

  test('shops=all includes the configured shop before it has an installation row', async ({ assert }) => {
    const db = getDb()
    await db.insert(installations).values({ shop: OTHER_SHOP, accessToken: 'tok', scopes: 'read_orders' })
    const quickFlow = { name: 'cc-quick-flow', concurrency: 'allow' as const, async run() {} }
    const config = {
      ...createConfig({ 'cc-quick-flow': quickFlow }),
      crons: [{ schedule: '* * * * * *', flow: 'cc-quick-flow', shops: 'all' as const }],
    }

    startScheduler(config)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    stopScheduler()

    const runs = await db.select().from(flowRuns).where(eq(flowRuns.flowName, 'cc-quick-flow'))
    assert.includeMembers([...new Set(runs.map((run) => run.shop))], [SHOP, OTHER_SHOP])
  }).timeout(5000)
})

function signedLaunchUrl(shop: string): string {
  const params: Record<string, string> = {
    host: 'admin.shopify.com/store/cc-dev-store',
    shop,
    timestamp: '1770000000',
  }
  const message = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&')
  const hmac = createHmac('sha256', API_SECRET).update(message).digest('hex')
  return `http://localhost/?${new URLSearchParams({ ...params, hmac }).toString()}`
}

test.group('Client credentials token mode: embedded admin load', (group) => {
  let staticRoot: string
  let restoreEnv: () => void = () => {}

  group.setup(() => {
    staticRoot = mkdtempSync(join(tmpdir(), 'openshop-cc-static-test-'))
    writeFileSync(
      join(staticRoot, 'index.html'),
      '<html><head><meta name="shopify-api-key" content="" /></head><body>spa-shell</body></html>',
      'utf8',
    )
    return () => rmSync(staticRoot, { recursive: true, force: true })
  })

  group.each.setup(async () => {
    await truncateAll()
    restoreEnv = withClientCredentialsShop(SHOP)
    return () => restoreEnv()
  })

  test('renders the app for the configured shop instead of redirecting to OAuth', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const app = await createServer(() => createConfig({}), { staticDir: staticRoot })
      const res = await app.request(signedLaunchUrl(SHOP), { redirect: 'manual' })

      assert.equal(res.status, 200)
      const html = await res.text()
      assert.include(html, 'spa-shell')
      assert.include(html, `<meta name="shopify-api-key" content="${API_KEY}" />`)
      assert.lengthOf(shopify.tokenRequests, 1)
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'cc-token-1')
    } finally {
      shopify.restore()
    }
  })

  test('answers an error page, not an OAuth redirect, when the grant is refused', async ({ assert }) => {
    const shopify = fakeShopify({ onToken: () => Response.json({ error: 'shop_not_permitted' }, { status: 400 }) })
    try {
      const app = await createServer(() => createConfig({}), { staticDir: staticRoot })
      const res = await app.request(signedLaunchUrl(SHOP), { redirect: 'manual' })

      assert.equal(res.status, 502)
      assert.isNull(res.headers.get('location'))
      const html = await res.text()
      assert.include(html, 'could not get an access token')
      assert.notInclude(html, 'spa-shell')
      assert.notInclude(html, API_SECRET)
    } finally {
      shopify.restore()
    }
  })

  test('still redirects other shops to OAuth', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const app = await createServer(() => createConfig({}), { staticDir: staticRoot })
      const res = await app.request(signedLaunchUrl(OTHER_SHOP), { redirect: 'manual' })

      assert.equal(res.status, 302)
      assert.equal(res.headers.get('location'), `/auth?shop=${OTHER_SHOP}`)
      assert.lengthOf(shopify.tokenRequests, 0)
    } finally {
      shopify.restore()
    }
  })

  test('still redirects to OAuth when the mode is off', async ({ assert }) => {
    restoreEnv()
    restoreEnv = withClientCredentialsShop(undefined)
    const shopify = fakeShopify()
    try {
      const app = await createServer(() => createConfig({}), { staticDir: staticRoot })
      const res = await app.request(signedLaunchUrl(SHOP), { redirect: 'manual' })

      assert.equal(res.status, 302)
      assert.equal(res.headers.get('location'), `/auth?shop=${SHOP}`)
      assert.lengthOf(shopify.tokenRequests, 0)
    } finally {
      shopify.restore()
    }
  })
})
