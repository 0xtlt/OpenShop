import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import { decryptString, encryptString } from '#server/crypto'
import { createServer } from '#server/index'
import { resolveTargets, startScheduler, stopScheduler } from '#engine/scheduler'
import { Worker } from '#engine/worker'
import { createShopifyClient } from '../../src/shopify/client.ts'
import {
  CLIENT_CREDENTIALS_SHOP_ENV,
  resetClientCredentialsState,
  useShopifyAppsConfig,
} from '../../src/shopify/client-credentials.ts'
import type { OpenShopConfig } from '#types'
import { createConfig, truncateAll } from './helpers.ts'

const SHOP = 'dev-store.myshopify.com'
const OTHER_SHOP = 'merchant-store.myshopify.com'
const API_KEY = process.env.SHOPIFY_API_KEY!
const API_SECRET = process.env.SHOPIFY_API_SECRET!
const HOUR_MS = 60 * 60 * 1000
const query = 'query { shop { name } }'

const MULTI_APPS = {
  scopes: 'read_orders',
  apps: {
    default: { apiKey: 'default-app-key', apiSecret: 'default-app-secret', appUrl: 'https://default.example.test' },
    second: { apiKey: 'second-app-key', apiSecret: 'second-app-secret', appUrl: 'https://second.example.test' },
  },
}

const MULTI_APPS_WITHOUT_DEFAULT = {
  scopes: 'read_orders',
  apps: {
    first: { apiKey: 'first-app-key', apiSecret: 'first-app-secret', appUrl: 'https://first.example.test' },
    second: { apiKey: 'second-app-key', apiSecret: 'second-app-secret', appUrl: 'https://second.example.test' },
  },
}

interface Call {
  url: string
  body: string
  headers: Headers
}

type Responder = (call: Call) => Response | Promise<Response>

interface FakeShopify {
  /** Every request, in order, whatever its address. */
  requests: Call[]
  tokenRequests: Call[]
  graphqlRequests: Call[]
  restore: () => void
}

/**
 * Replaces fetch with a fake Shopify: `onToken` answers the token endpoint and
 * `onGraphql` the Admin API. Any other address is recorded and refused, so no
 * test reaches the network.
 */
function fakeShopify(options: { onToken?: Responder; onGraphql?: Responder } = {}): FakeShopify {
  const originalFetch = globalThis.fetch
  const fake: FakeShopify = {
    requests: [],
    tokenRequests: [],
    graphqlRequests: [],
    restore: () => { globalThis.fetch = originalFetch },
  }
  let issued = 0
  const onToken = options.onToken ?? (() => {
    issued += 1
    return Response.json({ access_token: `granted-token-${issued}`, scope: 'read_orders', expires_in: 86399 })
  })
  const onGraphql = options.onGraphql ?? (() => Response.json({ data: { shop: { name: 'Dev store' } } }))

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const call = { url, body: String(init?.body ?? ''), headers: new Headers(init?.headers) }
    fake.requests.push(call)
    if (/^https:\/\/[a-z0-9-]+\.myshopify\.com\/admin\/oauth\/access_token$/.test(url)) {
      fake.tokenRequests.push(call)
      return onToken(call)
    }
    if (/^https:\/\/[a-z0-9-]+\.myshopify\.com\/admin\/api\//.test(url)) {
      fake.graphqlRequests.push(call)
      return onGraphql(call)
    }
    throw new Error(`unexpected request to ${url}`)
  }
  return fake
}

function setClientCredentialsShop(value: string | undefined): () => void {
  const previous = process.env[CLIENT_CREDENTIALS_SHOP_ENV]
  if (value === undefined) delete process.env[CLIENT_CREDENTIALS_SHOP_ENV]
  else process.env[CLIENT_CREDENTIALS_SHOP_ENV] = value
  return () => {
    if (previous === undefined) delete process.env[CLIENT_CREDENTIALS_SHOP_ENV]
    else process.env[CLIENT_CREDENTIALS_SHOP_ENV] = previous
  }
}

async function storedInstallation(shop = SHOP, appHandle = 'default') {
  const [row] = await getDb().select().from(installations)
    .where(and(eq(installations.appHandle, appHandle), eq(installations.shop, shop)))
    .limit(1)
  return row
}

async function insertInstallation(values: {
  shop?: string
  appHandle?: string
  token?: string | null
  nonce?: string | null
  uninstalledAt?: Date | null
  installedAt?: Date
}) {
  await getDb().insert(installations).values({
    appHandle: values.appHandle ?? 'default',
    shop: values.shop ?? SHOP,
    accessToken: values.token ? encryptString(values.token) : null,
    scopes: 'read_orders',
    nonce: values.nonce ?? null,
    uninstalledAt: values.uninstalledAt ?? null,
    ...(values.installedAt ? { installedAt: values.installedAt } : {}),
  })
}

function signQuery(params: Record<string, string>, secret = API_SECRET): Record<string, string> {
  const message = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&')
  return { ...params, hmac: createHmac('sha256', secret).update(message).digest('hex') }
}

function launchUrl(shop: string, options: { secret?: string; signed?: boolean } = {}): string {
  const params = { host: 'YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvZGV2LXN0b3Jl', shop, timestamp: '1770000000' }
  const query = options.signed === false ? params : signQuery(params, options.secret)
  return `http://localhost/?${new URLSearchParams(query).toString()}`
}

function sessionToken(shop: string, options: { apiKey?: string; secret?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: options.apiKey ?? API_KEY,
    sub: '42',
    exp: now + 3600,
    nbf: now - 10,
    iat: now,
    jti: `jti-${shop}`,
    sid: `sid-${shop}`,
  })).toString('base64url')
  const signature = createHmac('sha256', options.secret ?? API_SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function grantForm(call: Call): URLSearchParams {
  return new URLSearchParams(call.body)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

let clock = Date.now()

/** Common per-test state: empty tables, a fixed clock, a single-app config. */
async function freshState(): Promise<void> {
  await truncateAll()
  clock = Date.now()
  resetClientCredentialsState({ now: () => clock })
  useShopifyAppsConfig(() => createConfig({}))
}

test.group('Client credentials: background work on the configured shop', (group) => {
  let restoreEnv: () => void = () => {}

  group.each.setup(async () => {
    await freshState()
    restoreEnv = setClientCredentialsShop(SHOP)
    return () => restoreEnv()
  })

  test('obtains a token by grant when none is stored, and stores it encrypted', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const client = await createShopifyClient(SHOP)
      assert.deepEqual(await client.graphql(query), { shop: { name: 'Dev store' } })

      assert.lengthOf(shopify.tokenRequests, 1)
      const [tokenRequest] = shopify.tokenRequests
      assert.equal(tokenRequest!.url, `https://${SHOP}/admin/oauth/access_token`)
      assert.equal(tokenRequest!.headers.get('content-type'), 'application/x-www-form-urlencoded')
      assert.equal(grantForm(tokenRequest!).get('grant_type'), 'client_credentials')
      assert.equal(grantForm(tokenRequest!).get('client_id'), API_KEY)
      assert.equal(grantForm(tokenRequest!).get('client_secret'), API_SECRET)

      assert.equal(shopify.graphqlRequests[0]!.url, `https://${SHOP}/admin/api/2026-04/graphql.json`)
      assert.equal(shopify.graphqlRequests[0]!.headers.get('x-shopify-access-token'), 'granted-token-1')

      const row = await storedInstallation()
      assert.isTrue(row!.accessToken!.startsWith('enc:'))
      assert.equal(decryptString(row!.accessToken), 'granted-token-1')
      assert.equal(row!.scopes, 'read_orders')
      assert.isNull(row!.uninstalledAt)
    } finally {
      shopify.restore()
    }
  })

  test('maps the global placeholder shop to the configured shop', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const client = await createShopifyClient('__global__')
      await client.graphql(query)

      assert.equal(client.shop, SHOP)
      assert.equal(shopify.tokenRequests[0]!.url, `https://${SHOP}/admin/oauth/access_token`)
      assert.equal(shopify.graphqlRequests[0]!.url, `https://${SHOP}/admin/api/2026-04/graphql.json`)
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'granted-token-1')
    } finally {
      shopify.restore()
    }
  })

  test('uses an existing OAuth token as is and never replaces it', async ({ assert }) => {
    const installedAt = new Date(Date.now() - 30 * 24 * HOUR_MS)
    await insertInstallation({ token: 'oauth-offline-token', installedAt })
    const shopify = fakeShopify()
    try {
      clock += 2 * 24 * HOUR_MS
      const client = await createShopifyClient(SHOP)
      await client.graphql(query)
      await client.graphql(query)
      await (await createShopifyClient('__global__')).graphql(query)

      assert.lengthOf(shopify.tokenRequests, 0)
      assert.deepEqual(
        shopify.graphqlRequests.map((call) => call.headers.get('x-shopify-access-token')),
        ['oauth-offline-token', 'oauth-offline-token', 'oauth-offline-token'],
      )
      const row = await storedInstallation()
      assert.equal(decryptString(row!.accessToken), 'oauth-offline-token')
      assert.equal(row!.installedAt.getTime(), installedAt.getTime())
    } finally {
      shopify.restore()
    }
  })

  test('renews a token it granted 5 minutes before it expires, even when shorter than a day', async ({ assert }) => {
    let issued = 0
    const shopify = fakeShopify({
      onToken: () => {
        issued += 1
        return Response.json({ access_token: `short-token-${issued}`, scope: 'read_orders', expires_in: 900 })
      },
    })
    try {
      await (await createShopifyClient(SHOP)).graphql(query)
      clock += 9 * 60_000
      await (await createShopifyClient(SHOP)).graphql(query)
      assert.lengthOf(shopify.tokenRequests, 1)

      clock += 2 * 60_000
      await (await createShopifyClient(SHOP)).graphql(query)
      assert.lengthOf(shopify.tokenRequests, 2)
      assert.deepEqual(
        shopify.graphqlRequests.map((call) => call.headers.get('x-shopify-access-token')),
        ['short-token-1', 'short-token-1', 'short-token-2'],
      )
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'short-token-2')
    } finally {
      shopify.restore()
    }
  })

  test('concurrent callers share a single grant request', async ({ assert }) => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const shopify = fakeShopify({
      onToken: async () => {
        await gate
        return Response.json({ access_token: 'shared-token', scope: 'read_orders', expires_in: 86399 })
      },
    })
    try {
      const clients = await Promise.all([createShopifyClient(SHOP), createShopifyClient(SHOP), createShopifyClient('__global__')])
      const pending = Promise.all(clients.map((client) => client.graphql(query)))
      await new Promise((resolve) => setTimeout(resolve, 50))
      release()
      await pending

      assert.lengthOf(shopify.tokenRequests, 1)
      assert.deepEqual(
        shopify.graphqlRequests.map((call) => call.headers.get('x-shopify-access-token')),
        ['shared-token', 'shared-token', 'shared-token'],
      )
    } finally {
      shopify.restore()
    }
  })

  test('a refusal names the status and error code, never the credentials, and stores nothing', async ({ assert }) => {
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
        message = errorMessage(error)
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

  test('never revives an uninstalled shop', async ({ assert }) => {
    const uninstalledAt = new Date(Date.now() - HOUR_MS)
    await insertInstallation({ token: null, uninstalledAt })
    const shopify = fakeShopify()
    try {
      const client = await createShopifyClient(SHOP)
      await assert.rejects(() => client.graphql(query), /No access token found for app "default" and shop "dev-store.myshopify.com"/)
      const global = await createShopifyClient('__global__')
      await assert.rejects(() => global.graphql(query), /No access token found for app "default" and shop "__global__"/)

      assert.lengthOf(shopify.requests, 0)
      const row = await storedInstallation()
      assert.isNull(row!.accessToken)
      assert.equal(row!.uninstalledAt!.getTime(), uninstalledAt.getTime())
    } finally {
      shopify.restore()
    }
  })

  test('keeps the nonce of an OAuth flow in progress when it stores a granted token', async ({ assert }) => {
    await insertInstallation({ token: null, nonce: 'pending-oauth-nonce' })
    const shopify = fakeShopify()
    try {
      await (await createShopifyClient(SHOP)).graphql(query)
      const row = await storedInstallation()
      assert.equal(decryptString(row!.accessToken), 'granted-token-1')
      assert.equal(row!.nonce, 'pending-oauth-nonce')
    } finally {
      shopify.restore()
    }
  })

  test('leaves other shops and other app handles on the stored-token flow', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const other = await createShopifyClient(OTHER_SHOP)
      await assert.rejects(() => other.graphql(query), /No access token found for app "default" and shop "merchant-store.myshopify.com"/)
      const second = await createShopifyClient(SHOP, 'second')
      await assert.rejects(() => second.graphql(query), /No access token found for app "second"/)
      assert.lengthOf(shopify.requests, 0)
    } finally {
      shopify.restore()
    }
  })

  test('rejects a configured value that is not exactly <name>.myshopify.com', async ({ assert }) => {
    for (const value of ['example.com', 'https://dev-store.myshopify.com', 'dev-store.myshopify.com:8443', 'Dev-Store.myshopify.com', ' dev-store.myshopify.com']) {
      restoreEnv()
      restoreEnv = setClientCredentialsShop(value)
      await assert.rejects(() => createShopifyClient(SHOP), /SHOPIFY_CLIENT_CREDENTIALS_SHOP must be exactly <name>\.myshopify\.com/)
      await assert.rejects(() => createServer(() => createConfig({})), /SHOPIFY_CLIENT_CREDENTIALS_SHOP must be exactly <name>\.myshopify\.com/)
    }
  })

  test('refuses to start without the default app\'s API secret', async ({ assert }) => {
    const previousSecret = process.env.SHOPIFY_API_SECRET
    delete process.env.SHOPIFY_API_SECRET
    try {
      await assert.rejects(() => createServer(() => createConfig({})), /requires the API key and secret of the "default" app/)
    } finally {
      process.env.SHOPIFY_API_SECRET = previousSecret
    }
  })
})

test.group('Client credentials: 401 renewal', (group) => {
  let restoreEnv: () => void = () => {}

  group.each.setup(async () => {
    await freshState()
    restoreEnv = setClientCredentialsShop(undefined)
    return () => restoreEnv()
  })

  test('a 401 on a stored token gives one grant and one retry', async ({ assert }) => {
    await insertInstallation({ token: 'revoked-token' })
    const shopify = fakeShopify({
      onGraphql: (call) => call.headers.get('x-shopify-access-token') === 'revoked-token'
        ? new Response('{"errors":"[API] Invalid API key or access token"}', { status: 401 })
        : Response.json({ data: { shop: { name: 'Dev store' } } }),
    })
    try {
      const client = await createShopifyClient(SHOP)
      assert.deepEqual(await client.graphql(query), { shop: { name: 'Dev store' } })

      assert.lengthOf(shopify.tokenRequests, 1)
      assert.equal(grantForm(shopify.tokenRequests[0]!).get('client_id'), API_KEY)
      assert.deepEqual(
        shopify.graphqlRequests.map((call) => call.headers.get('x-shopify-access-token')),
        ['revoked-token', 'granted-token-1'],
      )
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'granted-token-1')
    } finally {
      shopify.restore()
    }
  })

  test('a second 401 is not retried again', async ({ assert }) => {
    await insertInstallation({ token: 'revoked-token' })
    const shopify = fakeShopify({ onGraphql: () => new Response('unauthorized', { status: 401 }) })
    try {
      const client = await createShopifyClient(SHOP)
      await assert.rejects(() => client.graphql(query), /Shopify GraphQL error \(401\)/)
      assert.lengthOf(shopify.tokenRequests, 1)
      assert.lengthOf(shopify.graphqlRequests, 2)
    } finally {
      shopify.restore()
    }
  })

  test('a refused grant after a 401 surfaces the original 401 and keeps the stored token', async ({ assert }) => {
    await insertInstallation({ token: 'revoked-token' })
    const shopify = fakeShopify({
      onToken: () => Response.json({ error: 'shop_not_permitted' }, { status: 400 }),
      onGraphql: () => new Response('original-401-body', { status: 401 }),
    })
    try {
      const client = await createShopifyClient(SHOP)
      await assert.rejects(() => client.graphql(query), /Shopify GraphQL error \(401\): original-401-body/)
      assert.lengthOf(shopify.tokenRequests, 1)
      assert.lengthOf(shopify.graphqlRequests, 1)
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'revoked-token')

      // The refusal is remembered: the next 401 does not ask Shopify again.
      await assert.rejects(() => client.graphql(query), /Shopify GraphQL error \(401\)/)
      assert.lengthOf(shopify.tokenRequests, 1)
    } finally {
      shopify.restore()
    }
  })

  test('another app handle renews with its own credentials', async ({ assert }) => {
    useShopifyAppsConfig(() => createConfig({}, { shopify: MULTI_APPS }))
    await insertInstallation({ appHandle: 'second', token: 'revoked-token' })
    const shopify = fakeShopify({
      onGraphql: (call) => call.headers.get('x-shopify-access-token') === 'revoked-token'
        ? new Response('unauthorized', { status: 401 })
        : Response.json({ data: { shop: { name: 'Dev store' } } }),
    })
    try {
      await (await createShopifyClient(SHOP, 'second')).graphql(query)
      const form = grantForm(shopify.tokenRequests[0]!)
      assert.equal(form.get('client_id'), 'second-app-key')
      assert.equal(form.get('client_secret'), 'second-app-secret')
      assert.equal(decryptString((await storedInstallation(SHOP, 'second'))!.accessToken), 'granted-token-1')
    } finally {
      shopify.restore()
    }
  })

  test('with the variable unset, a shop without a token keeps today\'s error and nothing is requested', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const client = await createShopifyClient(SHOP)
      await assert.rejects(() => client.graphql(query), /No access token found for app "default" and shop "dev-store.myshopify.com"/)
      const global = await createShopifyClient('__global__')
      assert.equal(global.shop, '__global__')
      await assert.rejects(() => global.graphql(query), /No access token found for app "default" and shop "__global__"/)
      assert.lengthOf(shopify.requests, 0)
    } finally {
      shopify.restore()
    }
  })

  test('a stored shop that is not exactly <name>.myshopify.com is never called', async ({ assert }) => {
    for (const shop of ['evil.example://dev-store.myshopify.com', 'dev-store.myshopify.com:8443', 'dev-store.myshopify.com@evil.example']) {
      await insertInstallation({ shop, token: 'stored-token' })
    }
    const shopify = fakeShopify()
    try {
      for (const shop of ['evil.example://dev-store.myshopify.com', 'dev-store.myshopify.com:8443', 'dev-store.myshopify.com@evil.example']) {
        const client = await createShopifyClient(shop)
        await assert.rejects(() => client.graphql(query), /Invalid shop domain/)
      }
      assert.lengthOf(shopify.requests, 0)
    } finally {
      shopify.restore()
    }
  })
})

test.group('Client credentials: multi-app startup', (group) => {
  let restoreEnv: () => void = () => {}

  group.each.setup(async () => {
    stopScheduler()
    await freshState()
    restoreEnv = setClientCredentialsShop(SHOP)
    return () => {
      stopScheduler()
      restoreEnv()
    }
  })

  test('background work uses the default handle\'s config credentials, not the environment', async ({ assert }) => {
    await createServer(() => createConfig({}, { shopify: MULTI_APPS }))
    const shopify = fakeShopify()
    try {
      await (await createShopifyClient('__global__')).graphql(query)
      const form = grantForm(shopify.tokenRequests[0]!)
      assert.equal(form.get('client_id'), 'default-app-key')
      assert.equal(form.get('client_secret'), 'default-app-secret')
      assert.notEqual(form.get('client_id'), API_KEY)
    } finally {
      shopify.restore()
    }
  })

  test('without a default handle, the server, the scheduler and the worker refuse to start', async ({ assert }) => {
    const config = createConfig({}, { shopify: MULTI_APPS_WITHOUT_DEFAULT })
    await assert.rejects(() => createServer(() => config), /needs a Shopify app with the "default" handle/)
    assert.throws(() => startScheduler(config), /needs a Shopify app with the "default" handle/)
    assert.throws(() => new Worker(config), /needs a Shopify app with the "default" handle/)
  })

  test('without a default handle and with the variable unset, everything starts', async ({ assert }) => {
    restoreEnv()
    restoreEnv = setClientCredentialsShop(undefined)
    const config = createConfig({}, { shopify: MULTI_APPS_WITHOUT_DEFAULT })
    await createServer(() => config)
    startScheduler(config)
    assert.instanceOf(new Worker(config), Worker)
  })
})

test.group('Client credentials: cron targets', (group) => {
  let restoreEnv: () => void = () => {}

  group.each.setup(async () => {
    await freshState()
    restoreEnv = setClientCredentialsShop(SHOP)
    return () => restoreEnv()
  })

  function sorted(targets: Array<{ shopifyApp: string; shop: string }>) {
    return [...targets].sort((a, b) => `${a.shopifyApp}/${a.shop}`.localeCompare(`${b.shopifyApp}/${b.shop}`))
  }

  test('shops=all adds the configured shop once when it has no row', async ({ assert }) => {
    await insertInstallation({ shop: OTHER_SHOP, token: 'merchant-token' })
    assert.deepEqual(sorted(await resolveTargets({ shops: 'all' })), [
      { shopifyApp: 'default', shop: SHOP },
      { shopifyApp: 'default', shop: OTHER_SHOP },
    ])
  })

  test('shops=all lists an installed configured shop exactly once', async ({ assert }) => {
    await insertInstallation({ token: 'granted-token' })
    await insertInstallation({ shop: OTHER_SHOP, token: 'merchant-token' })
    assert.deepEqual(sorted(await resolveTargets({ shops: 'all' })), [
      { shopifyApp: 'default', shop: SHOP },
      { shopifyApp: 'default', shop: OTHER_SHOP },
    ])
  })

  test('shops=all leaves out an uninstalled configured shop', async ({ assert }) => {
    await insertInstallation({ token: null, uninstalledAt: new Date() })
    await insertInstallation({ shop: OTHER_SHOP, token: 'merchant-token' })
    assert.deepEqual(await resolveTargets({ shops: 'all' }), [{ shopifyApp: 'default', shop: OTHER_SHOP }])
  })

  test('with the variable unset, shops=all is exactly the installed rows', async ({ assert }) => {
    restoreEnv()
    restoreEnv = setClientCredentialsShop(undefined)
    await insertInstallation({ shop: OTHER_SHOP, token: 'merchant-token' })
    assert.deepEqual(await resolveTargets({ shops: 'all' }), [{ shopifyApp: 'default', shop: OTHER_SHOP }])
    assert.deepEqual(await resolveTargets({}), [{ shopifyApp: 'default', shop: '__global__' }])
  })
})

test.group('Client credentials: Shopify-signed requests', (group) => {
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
    await freshState()
    // The dynamic path needs no variable.
    restoreEnv = setClientCredentialsShop(undefined)
    return () => restoreEnv()
  })

  async function appWith(config: OpenShopConfig = createConfig({})) {
    return createServer(() => config, { staticDir: staticRoot })
  }

  test('a signed admin load of a shop without a token grants and renders the app', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const app = await appWith()
      const res = await app.request(launchUrl(SHOP), { redirect: 'manual' })

      assert.equal(res.status, 200)
      const html = await res.text()
      assert.include(html, 'spa-shell')
      assert.include(html, `<meta name="shopify-api-key" content="${API_KEY}" />`)
      assert.lengthOf(shopify.tokenRequests, 1)
      assert.equal(shopify.tokenRequests[0]!.url, `https://${SHOP}/admin/oauth/access_token`)
      assert.equal(grantForm(shopify.tokenRequests[0]!).get('client_id'), API_KEY)
      const row = await storedInstallation()
      assert.equal(decryptString(row!.accessToken), 'granted-token-1')
      assert.isNull(row!.uninstalledAt)
    } finally {
      shopify.restore()
    }
  })

  test('unsigned, badly signed and OAuth-start requests never trigger a grant', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const app = await appWith()
      const unsigned = await app.request(launchUrl(SHOP, { signed: false }), { redirect: 'manual' })
      assert.equal(unsigned.status, 401)
      const badlySigned = await app.request(launchUrl(SHOP, { secret: 'not-the-secret' }), { redirect: 'manual' })
      assert.equal(badlySigned.status, 401)
      const oauthStart = await app.request(`/auth?shop=${SHOP}`, { redirect: 'manual' })
      assert.equal(oauthStart.status, 302)
      assert.match(oauthStart.headers.get('location') ?? '', /^https:\/\/dev-store\.myshopify\.com\/admin\/oauth\/authorize\?/)
      const unsignedApi = await app.request('/api/flows', { headers: { Authorization: 'Bearer invalid.token.here' } })
      assert.equal(unsignedApi.status, 401)

      assert.lengthOf(shopify.requests, 0)
      assert.isNull((await storedInstallation())?.accessToken ?? null)
    } finally {
      shopify.restore()
    }
  })

  test('a refused grant falls back to the OAuth redirect and is not retried within the hour', async ({ assert }) => {
    const shopify = fakeShopify({ onToken: () => Response.json({ error: 'shop_not_permitted' }, { status: 400 }) })
    try {
      const app = await appWith()
      const first = await app.request(launchUrl(OTHER_SHOP), { redirect: 'manual' })
      assert.equal(first.status, 302)
      assert.equal(first.headers.get('location'), `/auth?shop=${OTHER_SHOP}`)
      assert.lengthOf(shopify.tokenRequests, 1)

      clock += HOUR_MS - 1000
      const second = await app.request(launchUrl(OTHER_SHOP), { redirect: 'manual' })
      assert.equal(second.status, 302)
      assert.equal(second.headers.get('location'), `/auth?shop=${OTHER_SHOP}`)
      assert.lengthOf(shopify.tokenRequests, 1)

      clock += 2000
      const third = await app.request(launchUrl(OTHER_SHOP), { redirect: 'manual' })
      assert.equal(third.status, 302)
      assert.lengthOf(shopify.tokenRequests, 2)
      assert.isUndefined(await storedInstallation(OTHER_SHOP))
    } finally {
      shopify.restore()
    }
  })

  test('a network error is remembered like a refusal', async ({ assert }) => {
    const shopify = fakeShopify({ onToken: () => { throw new TypeError('fetch failed') } })
    try {
      const app = await appWith()
      assert.equal((await app.request(launchUrl(OTHER_SHOP), { redirect: 'manual' })).status, 302)
      assert.equal((await app.request(launchUrl(OTHER_SHOP), { redirect: 'manual' })).status, 302)
      assert.lengthOf(shopify.tokenRequests, 1)
    } finally {
      shopify.restore()
    }
  })

  test('a successful grant after a refusal clears it', async ({ assert }) => {
    let refuse = true
    const shopify = fakeShopify({
      onToken: () => refuse
        ? Response.json({ error: 'shop_not_permitted' }, { status: 400 })
        : Response.json({ access_token: 'later-token', scope: 'read_orders', expires_in: 86399 }),
    })
    try {
      const app = await appWith()
      assert.equal((await app.request(launchUrl(SHOP), { redirect: 'manual' })).status, 302)
      refuse = false
      clock += HOUR_MS + 1000
      assert.equal((await app.request(launchUrl(SHOP), { redirect: 'manual' })).status, 200)
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'later-token')
    } finally {
      shopify.restore()
    }
  })

  test('an installed shop renders without asking Shopify', async ({ assert }) => {
    await insertInstallation({ token: 'oauth-offline-token' })
    const shopify = fakeShopify()
    try {
      const res = await (await appWith()).request(launchUrl(SHOP), { redirect: 'manual' })
      assert.equal(res.status, 200)
      assert.lengthOf(shopify.requests, 0)
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'oauth-offline-token')
    } finally {
      shopify.restore()
    }
  })

  test('multi-app: the grant uses the app that signed the request', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const app = await appWith(createConfig({}, { shopify: MULTI_APPS }))
      const res = await app.request(launchUrl(SHOP, { secret: 'second-app-secret' }), { redirect: 'manual' })

      assert.equal(res.status, 200)
      assert.include(await res.text(), '<meta name="shopify-api-key" content="second-app-key" />')
      const form = grantForm(shopify.tokenRequests[0]!)
      assert.equal(form.get('client_id'), 'second-app-key')
      assert.equal(form.get('client_secret'), 'second-app-secret')
      assert.equal(decryptString((await storedInstallation(SHOP, 'second'))!.accessToken), 'granted-token-1')
      assert.isUndefined(await storedInstallation(SHOP, 'default'))
    } finally {
      shopify.restore()
    }
  })

  test('a signed load revives an uninstalled shop and keeps the nonce', async ({ assert }) => {
    await insertInstallation({ token: null, nonce: 'pending-oauth-nonce', uninstalledAt: new Date() })
    const shopify = fakeShopify()
    try {
      const res = await (await appWith()).request(launchUrl(SHOP), { redirect: 'manual' })
      assert.equal(res.status, 200)
      const row = await storedInstallation()
      assert.equal(decryptString(row!.accessToken), 'granted-token-1')
      assert.isNull(row!.uninstalledAt)
      assert.equal(row!.nonce, 'pending-oauth-nonce')
    } finally {
      shopify.restore()
    }
  })

  test('a hostile shop parameter never reaches another host', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const app = await appWith()
      for (const shop of ['evil.example://dev-store.myshopify.com', 'dev-store.myshopify.com:8443', 'https://dev-store.myshopify.com']) {
        const res = await app.request(launchUrl(shop), { redirect: 'manual' })
        assert.notEqual(res.status, 200)
      }
      assert.lengthOf(shopify.requests, 0)
    } finally {
      shopify.restore()
    }
  })

  test('a verified session token grants before token exchange', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const app = await appWith()
      const res = await app.request('/api/flows', { headers: { Authorization: `Bearer ${sessionToken(SHOP)}` } })
      assert.equal(res.status, 200)
      assert.lengthOf(shopify.tokenRequests, 1)
      assert.equal(grantForm(shopify.tokenRequests[0]!).get('grant_type'), 'client_credentials')
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'granted-token-1')
    } finally {
      shopify.restore()
    }
  })

  test('a refused grant on a session token falls back to token exchange', async ({ assert }) => {
    const shopify = fakeShopify({
      onToken: (call) => call.headers.get('content-type') === 'application/x-www-form-urlencoded'
        ? Response.json({ error: 'shop_not_permitted' }, { status: 400 })
        : Response.json({ access_token: 'exchanged-token', scope: 'read_orders' }),
    })
    try {
      const app = await appWith()
      const res = await app.request('/api/flows', { headers: { Authorization: `Bearer ${sessionToken(OTHER_SHOP)}` } })
      assert.equal(res.status, 200)
      assert.lengthOf(shopify.tokenRequests, 2)
      assert.equal(grantForm(shopify.tokenRequests[0]!).get('grant_type'), 'client_credentials')
      assert.equal(
        JSON.parse(shopify.tokenRequests[1]!.body).grant_type,
        'urn:ietf:params:oauth:grant-type:token-exchange',
      )
      assert.equal(decryptString((await storedInstallation(OTHER_SHOP))!.accessToken), 'exchanged-token')
    } finally {
      shopify.restore()
    }
  })

  test('a signed request with the variable set to another shop still uses the signed shop', async ({ assert }) => {
    restoreEnv()
    restoreEnv = setClientCredentialsShop(SHOP)
    const shopify = fakeShopify()
    try {
      const res = await (await appWith()).request(launchUrl(OTHER_SHOP), { redirect: 'manual' })
      assert.equal(res.status, 200)
      assert.equal(shopify.tokenRequests[0]!.url, `https://${OTHER_SHOP}/admin/oauth/access_token`)
      assert.isUndefined(await storedInstallation(SHOP))
    } finally {
      shopify.restore()
    }
  })
})
