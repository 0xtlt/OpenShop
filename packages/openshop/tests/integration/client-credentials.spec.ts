import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import { decryptString, encryptString } from '#server/crypto'
import { createServer } from '#server/index'
import { resolveTargets, startScheduler, stopScheduler } from '#engine/scheduler'
import { Worker } from '#engine/worker'
import { cancelRun } from '#engine/abort'
import { dispatchFlow } from '#engine/dispatch'
import { runFlow } from '#engine/runner'
import { createCoreMcpCapabilities } from '#server/mcp/core'
import { createShopifyClient, openShopifyClient } from '../../src/shopify/client.ts'
import { setRuntimeLogger, type RuntimeLogger } from '../../src/runtime/logger.ts'
import { sql } from 'drizzle-orm'
import {
  CLIENT_CREDENTIALS_SHOP_ENV,
  resetClientCredentialsState,
} from '../../src/shopify/client-credentials.ts'
import type { FlowRunContext, McpExecutionContext, OpenShopConfig } from '#types'
import { createConfig, truncateAll } from './helpers.ts'

const SHOP = 'dev-store.myshopify.com'
const OTHER_SHOP = 'merchant-store.myshopify.com'
const API_KEY = process.env.SHOPIFY_API_KEY!
const API_SECRET = process.env.SHOPIFY_API_SECRET!
const HOUR_MS = 60 * 60 * 1000
/** The short wait after a transient failure (CLIENT_CREDENTIALS_RETRY_BACKOFF_MS). */
const BACKOFF_MS = 30_000
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
  signal: AbortSignal | null
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
    const call = { url, body: String(init?.body ?? ''), headers: new Headers(init?.headers), signal: init?.signal ?? null }
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

/**
 * A token endpoint that holds its answer until `release()`. `received` settles
 * when the first request reaches it, so a test knows the request is in flight
 * without waiting for an arbitrary time.
 */
function gatedToken(accessToken = 'shared-token') {
  let release: () => void = () => {}
  let received: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const receivedPromise = new Promise<void>((resolve) => { received = resolve })
  return {
    received: receivedPromise,
    release: () => release(),
    onToken: async () => {
      received()
      await gate
      return Response.json({ access_token: accessToken, scope: 'read_orders', expires_in: 86399 })
    },
  }
}

/** Waits, a turn of the event loop at a time, until `condition` holds. */
async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 100_000; turn += 1) {
    if (condition()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('condition never met')
}

/** The context the MCP server gives a tool call, with the caller's signal. */
function mcpContext(signal: AbortSignal): McpExecutionContext {
  return {
    appHandle: 'default',
    shop: SHOP,
    tokenId: 'test-token-id',
    permissions: ['shopify_admin_graphql'],
    signal,
    db: getDb() as unknown as McpExecutionContext['db'],
  }
}

function mcpTool(name: string) {
  return createCoreMcpCapabilities(() => createConfig({})).tools[name]!
}

function adminGraphqlTool() {
  return mcpTool('openshop.admin.graphql')
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

/** A launch URL as Shopify signs it, with a timestamp taken from the test clock. */
function launchUrl(shop: string, options: { secret?: string; signed?: boolean; ageMs?: number; idToken?: string } = {}): string {
  const timestamp = String(Math.floor((clock - (options.ageMs ?? 0)) / 1000))
  const params: Record<string, string> = { host: 'YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvZGV2LXN0b3Jl', shop, timestamp }
  // Shopify managed installation opens the app with a session token.
  if (options.idToken) params.id_token = options.idToken
  const query = options.signed === false ? params : signQuery(params, options.secret)
  return `http://localhost/?${new URLSearchParams(query).toString()}`
}

function sessionToken(shop: string, options: { apiKey?: string; secret?: string; expiresIn?: number } = {}): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: options.apiKey ?? API_KEY,
    sub: '42',
    exp: now + (options.expiresIn ?? 3600),
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
/**
 * How many times the grant code read the clock. A signed launch reads it to
 * check its timestamp, then joins or starts the token request in the same turn
 * of the event loop: once the count moves, the launch is waiting on Shopify.
 */
let clockReads = 0

/**
 * Common per-test state: empty tables and a fixed clock. `createShopifyClient`
 * has no config, so its `default` app uses SHOPIFY_API_KEY / SHOPIFY_API_SECRET.
 */
async function freshState(options?: { grantTimeoutMs?: number }): Promise<void> {
  await truncateAll()
  clock = Date.now()
  resetClientCredentialsState({ now: () => { clockReads += 1; return clock }, ...options })
}

/** Runs a flow on `shop` with `config`, as the worker does, and returns its run. */
async function runFlowWith(config: OpenShopConfig, flowName: string, shop: string) {
  const { runId } = await dispatchFlow({ flowName, config, shop, options: { retryPolicy: { maxAttempts: 0 } } })
  return runFlow({ runId, flowName, config, shop })
}

/** A flow that sends one Admin API query. */
const queryFlow = {
  name: 'query-flow',
  run: async ({ shopify }: FlowRunContext) => { await shopify.graphql(query) },
}

/** Makes every write to `installations` fail, as a database error would. */
async function refuseInstallationWrites(): Promise<() => Promise<void>> {
  const db = getDb()
  await db.execute(sql`CREATE OR REPLACE FUNCTION openshop_test_refuse_write() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'write refused by test'; END $$ LANGUAGE plpgsql`)
  await db.execute(sql`DROP TRIGGER IF EXISTS openshop_test_refuse_write ON installations`)
  await db.execute(sql`CREATE TRIGGER openshop_test_refuse_write BEFORE INSERT OR UPDATE ON installations
    FOR EACH ROW EXECUTE FUNCTION openshop_test_refuse_write()`)
  return async () => {
    await db.execute(sql`DROP TRIGGER IF EXISTS openshop_test_refuse_write ON installations`)
    await db.execute(sql`DROP FUNCTION IF EXISTS openshop_test_refuse_write()`)
  }
}

function signWebhook(body: string, secret = API_SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64')
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

  test('a token granted for less than the renewal margin is asked for once per call, not twice', async ({ assert }) => {
    let issued = 0
    const shopify = fakeShopify({
      onToken: () => {
        issued += 1
        return Response.json({ access_token: `brief-token-${issued}`, scope: 'read_orders', expires_in: 120 })
      },
    })
    try {
      await (await createShopifyClient(SHOP)).graphql(query)
      assert.lengthOf(shopify.tokenRequests, 1)
      assert.deepEqual(shopify.graphqlRequests.map((call) => call.headers.get('x-shopify-access-token')), ['brief-token-1'])

      await (await createShopifyClient(SHOP)).graphql(query)
      assert.lengthOf(shopify.tokenRequests, 2)
      assert.equal(shopify.graphqlRequests.at(-1)!.headers.get('x-shopify-access-token'), 'brief-token-2')
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
      // Each caller starts or joins the request before its first await, so all
      // three are waiting on Shopify when the answer is released.
      const pending = Promise.all(clients.map((client) => client.graphql(query)))
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

  test('a definite refusal (a 4xx with an error code) is remembered for an hour', async ({ assert }) => {
    const shopify = fakeShopify({ onToken: () => Response.json({ error: 'shop_not_permitted' }, { status: 400 }) })
    try {
      const client = await createShopifyClient(SHOP)
      await assert.rejects(() => client.graphql(query), /same Shopify organization/)
      clock += HOUR_MS - 1000
      await assert.rejects(() => client.graphql(query), /shop_not_permitted, less than 1 hour ago/)
      assert.lengthOf(shopify.tokenRequests, 1)
      clock += 2000
      await assert.rejects(() => client.graphql(query), /\(HTTP 400, shop_not_permitted\)/)
      assert.lengthOf(shopify.tokenRequests, 2)
    } finally {
      shopify.restore()
    }
  })

  test('a transient failure holds the next attempt for 30 seconds, not an hour', async ({ assert }) => {
    const failures: Array<{ label: string; answer: () => Response | Promise<Response> }> = [
      { label: 'HTTP 503', answer: () => Response.json({ error: 'service_unavailable' }, { status: 503 }) },
      { label: 'HTTP 502', answer: () => new Response('Bad gateway', { status: 502 }) },
      { label: 'HTTP 429', answer: () => Response.json({ error: 'too_many_requests' }, { status: 429 }) },
      { label: 'HTTP 400', answer: () => new Response('Bad request', { status: 400 }) },
      { label: 'network error', answer: () => { throw new TypeError('fetch failed') } },
    ]
    for (const failure of failures) {
      await freshState()
      let fail = true
      const shopify = fakeShopify({
        onToken: () => fail
          ? failure.answer()
          : Response.json({ access_token: 'after-backoff', scope: 'read_orders', expires_in: 86399 }),
      })
      try {
        const client = await createShopifyClient(SHOP)
        let message = ''
        try {
          await client.graphql(query)
        } catch (error) {
          message = errorMessage(error)
        }
        assert.include(message, failure.label)
        assert.include(message, 'attempted again after 30 seconds')
        assert.notInclude(message, 'same Shopify organization')

        clock += BACKOFF_MS - 1000
        await assert.rejects(() => client.graphql(query), /less than 30 seconds ago/)
        assert.lengthOf(shopify.tokenRequests, 1)

        fail = false
        clock += 2000
        assert.deepEqual(await client.graphql(query), { shop: { name: 'Dev store' } })
        assert.lengthOf(shopify.tokenRequests, 2)
        assert.equal(decryptString((await storedInstallation())!.accessToken), 'after-backoff')
      } finally {
        shopify.restore()
      }
    }
  })

  test('a failed renewal keeps the token and holds the next grant for 30 seconds only', async ({ assert }) => {
    const grantedAt = clock
    const expiresAt = grantedAt + 900_000
    let answers = 0
    const shopify = fakeShopify({
      onToken: () => {
        answers += 1
        if (answers === 1) return Response.json({ access_token: 'short-token-1', scope: 'read_orders', expires_in: 900 })
        if (answers === 2) return new Response('Bad gateway', { status: 502 })
        return Response.json({ access_token: 'short-token-2', scope: 'read_orders', expires_in: 900 })
      },
      onGraphql: (call) => call.headers.get('x-shopify-access-token') === 'short-token-1' && clock >= expiresAt
        ? new Response('expired-token', { status: 401 })
        : Response.json({ data: { shop: { name: 'Dev store' } } }),
    })
    try {
      await (await createShopifyClient(SHOP)).graphql(query)

      // Inside the renewal margin: the renewal fails, the current token still works.
      clock = expiresAt - 10_000
      await (await createShopifyClient(SHOP)).graphql(query)
      assert.lengthOf(shopify.tokenRequests, 2)

      // Expired, within the backoff: no new request, the original 401 surfaces.
      clock = expiresAt + 10_000
      await assert.rejects(async () => (await createShopifyClient(SHOP)).graphql(query), /Shopify GraphQL error \(401\): expired-token/)
      assert.lengthOf(shopify.tokenRequests, 2)

      // Past the backoff: a grant replaces the token.
      clock = expiresAt + 25_000
      assert.deepEqual(await (await createShopifyClient(SHOP)).graphql(query), { shop: { name: 'Dev store' } })
      assert.lengthOf(shopify.tokenRequests, 3)
      assert.equal(shopify.graphqlRequests.at(-1)!.headers.get('x-shopify-access-token'), 'short-token-2')
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'short-token-2')
    } finally {
      shopify.restore()
    }
  })

  test('a failed write names neither the token nor its ciphertext', async ({ assert }) => {
    const shopify = fakeShopify({
      onToken: () => Response.json({ access_token: 'granted-secret-token', scope: 'read_orders', expires_in: 86399 }),
    })
    const restoreWrites = await refuseInstallationWrites()
    try {
      const client = await createShopifyClient(SHOP)
      let message = ''
      try {
        await client.graphql(query)
      } catch (error) {
        message = errorMessage(error)
        assert.isUndefined((error as Error).cause)
      }
      assert.include(message, 'Could not store the client credentials token for app "default" and shop "dev-store.myshopify.com"')
      assert.notInclude(message, 'granted-secret-token')
      assert.notInclude(message, 'enc:')
      assert.notInclude(message, 'params')
      assert.lengthOf(shopify.graphqlRequests, 0)
    } finally {
      await restoreWrites()
      shopify.restore()
    }
  })

  test('a malformed value stops the server, the scheduler and the worker, and is ignored with one warning elsewhere', async ({ assert }) => {
    const warnings: string[] = []
    const previousLogger = setRuntimeLogger({
      info: () => {},
      warn: (message) => { warnings.push(message) },
      error: () => {},
    } satisfies RuntimeLogger)
    await insertInstallation({ shop: OTHER_SHOP, token: 'merchant-token' })
    const shopify = fakeShopify()
    try {
      const values = ['example.com', 'https://dev-store.myshopify.com', 'dev-store.myshopify.com:8443', 'Dev-Store.myshopify.com', ' dev-store.myshopify.com']
      for (const value of values) {
        restoreEnv()
        restoreEnv = setClientCredentialsShop(value)
        const malformed = /SHOPIFY_CLIENT_CREDENTIALS_SHOP must be exactly <name>\.myshopify\.com/
        await assert.rejects(() => createServer(() => createConfig({})), malformed)
        assert.throws(() => startScheduler(createConfig({})), malformed)
        assert.throws(() => new Worker(createConfig({})), malformed)

        // A plain script: the variable is off, every other shop works as before.
        assert.deepEqual(await (await createShopifyClient(OTHER_SHOP)).graphql(query), { shop: { name: 'Dev store' } })
        await assert.rejects(async () => (await createShopifyClient(SHOP)).graphql(query), /No access token found for app "default" and shop "dev-store.myshopify.com"/)
        await assert.rejects(async () => (await createShopifyClient('__global__')).graphql(query), /No access token found/)
      }
      assert.lengthOf(shopify.tokenRequests, 0)
      assert.lengthOf(shopify.graphqlRequests, values.length)
      // One warning per value, however many clients read it.
      assert.lengthOf(warnings, values.length)
      for (const warning of warnings) assert.include(warning, 'is ignored')
    } finally {
      setRuntimeLogger(previousLogger)
      stopScheduler()
      shopify.restore()
    }
  })

  test('a refusal of old credentials never holds back corrected ones', async ({ assert }) => {
    const previousSecret = process.env.SHOPIFY_API_SECRET
    process.env.SHOPIFY_API_SECRET = 'old-wrong-secret'
    const shopify = fakeShopify({
      onToken: (call) => grantForm(call).get('client_secret') === API_SECRET
        ? Response.json({ access_token: 'fixed-token', scope: 'read_orders', expires_in: 86399 })
        : Response.json({ error: 'invalid_client' }, { status: 401 }),
    })
    try {
      const messages: string[] = []
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await (await createShopifyClient(SHOP)).graphql(query)
        } catch (error) {
          messages.push(errorMessage(error))
        }
      }
      assert.include(messages[0], 'HTTP 401, invalid_client')
      assert.include(messages[1], 'invalid_client, less than 1 hour ago')
      assert.lengthOf(shopify.tokenRequests, 1)
      for (const message of messages) assert.notInclude(message, 'old-wrong-secret')

      // The operator fixes the secret: the next call asks Shopify again at once.
      process.env.SHOPIFY_API_SECRET = previousSecret
      assert.deepEqual(await (await createShopifyClient(SHOP)).graphql(query), { shop: { name: 'Dev store' } })
      assert.lengthOf(shopify.tokenRequests, 2)
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'fixed-token')
    } finally {
      process.env.SHOPIFY_API_SECRET = previousSecret
      shopify.restore()
    }
  })

  test('cancelling an MCP call stops its wait, not the request it shares with other callers', async ({ assert }) => {
    await freshState({ grantTimeoutMs: 60_000 })
    const token = gatedToken()
    const shopify = fakeShopify({ onToken: token.onToken })
    const controller = new AbortController()
    try {
      const call = (async () => adminGraphqlTool().run(mcpContext(controller.signal), { shop: SHOP, apiVersion: '2026-04', query }))()
        .then(() => 'answered', (error: unknown) => errorMessage(error))
      await token.received
      const client = await createShopifyClient(SHOP)
      // Joins the request the MCP call started, before its first await.
      const other = client.graphql(query)

      controller.abort()
      assert.include(await call, 'cancelled')
      assert.isFalse(shopify.tokenRequests[0]!.signal!.aborted)

      token.release()
      assert.deepEqual(await other, { shop: { name: 'Dev store' } })
      assert.lengthOf(shopify.tokenRequests, 1)
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'shared-token')
    } finally {
      token.release()
      shopify.restore()
    }
  })

  test('cancelling a flow run stops its wait, not the request it shares with other callers', async ({ assert }) => {
    await freshState({ grantTimeoutMs: 60_000 })
    const token = gatedToken()
    const fake = fakeShopify({ onToken: token.onToken })
    const flow = {
      name: 'grant-flow',
      run: async ({ shopify }: FlowRunContext) => { await shopify.graphql(query) },
    }
    const config = createConfig({ 'grant-flow': flow })
    try {
      const { runId } = await dispatchFlow({
        flowName: 'grant-flow', config, shop: '__global__', options: { retryPolicy: { maxAttempts: 0 } },
      })
      const run = runFlow({ runId, flowName: 'grant-flow', config, shop: '__global__' })
      await token.received
      const client = await createShopifyClient(SHOP)
      // Joins the request the run started, before its first await.
      const other = client.graphql(query)

      assert.isTrue(cancelRun(runId))
      assert.equal((await run).status, 'canceled')
      assert.isFalse(fake.tokenRequests[0]!.signal!.aborted)

      token.release()
      assert.deepEqual(await other, { shop: { name: 'Dev store' } })
      assert.lengthOf(fake.tokenRequests, 1)
    } finally {
      token.release()
      fake.restore()
    }
  })

  test('a caller whose signal already aborted sends nothing', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const controller = new AbortController()
      controller.abort()
      await assert.rejects(
        async () => adminGraphqlTool().run(mcpContext(controller.signal), { shop: SHOP, apiVersion: '2026-04', query }),
        /cancelled/,
      )
      assert.lengthOf(shopify.requests, 0)
      assert.isUndefined(await storedInstallation())
    } finally {
      shopify.restore()
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

  test('a transient failure after a 401 is tried again after 30 seconds, not an hour', async ({ assert }) => {
    await insertInstallation({ token: 'revoked-token' })
    let fail = true
    const shopify = fakeShopify({
      onToken: () => fail
        ? new Response('upstream error', { status: 503 })
        : Response.json({ access_token: 'renewed-token', scope: 'read_orders', expires_in: 86399 }),
      onGraphql: (call) => call.headers.get('x-shopify-access-token') === 'revoked-token'
        ? new Response('original-401-body', { status: 401 })
        : Response.json({ data: { shop: { name: 'Dev store' } } }),
    })
    try {
      const client = await createShopifyClient(SHOP)
      await assert.rejects(() => client.graphql(query), /Shopify GraphQL error \(401\): original-401-body/)
      assert.lengthOf(shopify.tokenRequests, 1)

      clock += BACKOFF_MS - 1000
      await assert.rejects(() => client.graphql(query), /Shopify GraphQL error \(401\)/)
      assert.lengthOf(shopify.tokenRequests, 1)

      fail = false
      clock += 2000
      assert.deepEqual(await client.graphql(query), { shop: { name: 'Dev store' } })
      assert.lengthOf(shopify.tokenRequests, 2)
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'renewed-token')
    } finally {
      shopify.restore()
    }
  })

  test('a failed write after a 401 names neither the token nor its ciphertext', async ({ assert }) => {
    await insertInstallation({ token: 'revoked-token' })
    const shopify = fakeShopify({
      onToken: () => Response.json({ access_token: 'granted-secret-token', scope: 'read_orders', expires_in: 86399 }),
      onGraphql: () => new Response('unauthorized', { status: 401 }),
    })
    const restoreWrites = await refuseInstallationWrites()
    try {
      const client = await createShopifyClient(SHOP)
      let message = ''
      try {
        await client.graphql(query)
      } catch (error) {
        message = errorMessage(error)
      }
      assert.include(message, 'Could not store the client credentials token')
      assert.notInclude(message, 'granted-secret-token')
      assert.notInclude(message, 'enc:')
      assert.notInclude(message, 'params')
      assert.lengthOf(shopify.graphqlRequests, 1)
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'revoked-token')
    } finally {
      await restoreWrites()
      shopify.restore()
    }
  })

  test('another app handle renews with its own credentials', async ({ assert }) => {
    await insertInstallation({ appHandle: 'second', token: 'revoked-token' })
    const shopify = fakeShopify({
      onGraphql: (call) => call.headers.get('x-shopify-access-token') === 'revoked-token'
        ? new Response('unauthorized', { status: 401 })
        : Response.json({ data: { shop: { name: 'Dev store' } } }),
    })
    try {
      const config = createConfig({ 'query-flow': queryFlow }, { shopify: MULTI_APPS })
      const { runId } = await dispatchFlow({ flowName: 'query-flow', config, shopifyApp: 'second', shop: SHOP })
      const run = await runFlow({ runId, flowName: 'query-flow', config, shopifyApp: 'second', shop: SHOP })
      assert.equal(run.status, 'completed')
      const form = grantForm(shopify.tokenRequests[0]!)
      assert.equal(form.get('client_id'), 'second-app-key')
      assert.equal(form.get('client_secret'), 'second-app-secret')
      assert.equal(decryptString((await storedInstallation(SHOP, 'second'))!.accessToken), 'granted-token-1')
    } finally {
      shopify.restore()
    }
  })

  test('a webhook handler\'s client renews the stored token of its shop once after a 401', async ({ assert }) => {
    await insertInstallation({ token: 'revoked-token' })
    const answers: string[] = []
    const config = createConfig({}, {
      webhooks: {
        ORDERS_CREATE: {
          run: async ({ shop, shopifyApp }) => {
            try {
              await (await createShopifyClient(shop, shopifyApp)).graphql(query)
              answers.push(`${shop}: answered`)
            } catch (error) {
              answers.push(`${shop}: ${errorMessage(error)}`)
            }
          },
        },
      },
    })
    const shopify = fakeShopify({
      onGraphql: (call) => call.headers.get('x-shopify-access-token') === 'revoked-token'
        ? new Response('unauthorized', { status: 401 })
        : Response.json({ data: { shop: { name: 'Dev store' } } }),
    })
    try {
      const app = await createServer(() => config)
      const body = JSON.stringify({ id: 1 })
      const deliver = (shop: string) => app.request('http://localhost/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shopify-hmac-sha256': signWebhook(body),
          'x-shopify-topic': 'orders/create',
          'x-shopify-shop-domain': shop,
          'x-shopify-api-version': '2026-04',
        },
        body,
      })

      assert.equal((await deliver(SHOP)).status, 200)
      // One grant, one retry with the new token, which is stored.
      assert.lengthOf(shopify.tokenRequests, 1)
      assert.deepEqual(
        shopify.graphqlRequests.map((call) => call.headers.get('x-shopify-access-token')),
        ['revoked-token', 'granted-token-1'],
      )
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'granted-token-1')

      // A shop without a row gets no token, and Shopify is not asked.
      assert.equal((await deliver(OTHER_SHOP)).status, 200)
      assert.lengthOf(shopify.requests, 3)
      assert.deepEqual(answers, [`${SHOP}: answered`, `${OTHER_SHOP}: [openshop] No access token found for app "default" and shop "${OTHER_SHOP}". Is the app installed?`])
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
    const shopify = fakeShopify()
    try {
      const run = await runFlowWith(createConfig({ 'query-flow': queryFlow }, { shopify: MULTI_APPS }), 'query-flow', '__global__')
      assert.equal(run.status, 'completed')
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

  test('shops given as a list or a string include the configured shop with no row, like any named shop', async ({ assert }) => {
    assert.deepEqual(await resolveTargets({ shops: SHOP }), [{ shopifyApp: 'default', shop: SHOP }])
    assert.deepEqual(await resolveTargets({ shops: [SHOP] }), [{ shopifyApp: 'default', shop: SHOP }])
    assert.deepEqual(await resolveTargets({ shops: [SHOP, OTHER_SHOP] }), [
      { shopifyApp: 'default', shop: SHOP },
      { shopifyApp: 'default', shop: OTHER_SHOP },
    ])
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
      assert.equal(first.headers.get('location'), `/auth?shop=${OTHER_SHOP}&app=default`)
      assert.lengthOf(shopify.tokenRequests, 1)

      clock += HOUR_MS - 1000
      const second = await app.request(launchUrl(OTHER_SHOP), { redirect: 'manual' })
      assert.equal(second.status, 302)
      assert.equal(second.headers.get('location'), `/auth?shop=${OTHER_SHOP}&app=default`)
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

  test('a network error holds the next attempt for 30 seconds only', async ({ assert }) => {
    const shopify = fakeShopify({ onToken: () => { throw new TypeError('fetch failed') } })
    try {
      const app = await appWith()
      assert.equal((await app.request(launchUrl(OTHER_SHOP), { redirect: 'manual' })).status, 302)
      assert.equal((await app.request(launchUrl(OTHER_SHOP), { redirect: 'manual' })).status, 302)
      assert.lengthOf(shopify.tokenRequests, 1)
      clock += BACKOFF_MS + 1000
      assert.equal((await app.request(launchUrl(OTHER_SHOP), { redirect: 'manual' })).status, 302)
      assert.lengthOf(shopify.tokenRequests, 2)
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

  test('a stale signed launch never grants nor revives, and keeps the OAuth redirect', async ({ assert }) => {
    await insertInstallation({ shop: OTHER_SHOP, token: null, uninstalledAt: new Date() })
    const shopify = fakeShopify()
    try {
      const app = await appWith()
      for (const ageMs of [91_000, -91_000, 30 * 24 * HOUR_MS]) {
        for (const shop of [SHOP, OTHER_SHOP]) {
          const res = await app.request(launchUrl(shop, { ageMs }), { redirect: 'manual' })
          assert.equal(res.status, 302)
          assert.equal(res.headers.get('location'), `/auth?shop=${shop}&app=default`)
        }
      }
      assert.lengthOf(shopify.requests, 0)
      assert.isUndefined(await storedInstallation())
      assert.isNotNull((await storedInstallation(OTHER_SHOP))!.uninstalledAt)

      // Within 90 seconds, either way, the launch still grants.
      assert.equal((await app.request(launchUrl(SHOP, { ageMs: 89_000 }), { redirect: 'manual' })).status, 200)
      assert.equal((await app.request(launchUrl(OTHER_SHOP, { ageMs: -89_000 }), { redirect: 'manual' })).status, 200)
      assert.lengthOf(shopify.tokenRequests, 2)
      assert.isNull((await storedInstallation(OTHER_SHOP))!.uninstalledAt)
    } finally {
      shopify.restore()
    }
  })

  test('a token endpoint that never answers falls back to the OAuth redirect within the timeout', async ({ assert }) => {
    resetClientCredentialsState({ now: () => clock, grantTimeoutMs: 50 })
    // Never settles, and ignores the abort signal too.
    const shopify = fakeShopify({ onToken: () => new Promise<Response>(() => {}) })
    try {
      const app = await appWith()
      const started = Date.now()
      const res = await app.request(launchUrl(SHOP), { redirect: 'manual' })
      assert.isBelow(Date.now() - started, 2000)
      assert.equal(res.status, 302)
      assert.equal(res.headers.get('location'), `/auth?shop=${SHOP}&app=default`)
      assert.isTrue(shopify.tokenRequests[0]!.signal?.aborted)

      // A timeout is transient: tried again after the backoff, not after an hour.
      assert.equal((await app.request(launchUrl(SHOP), { redirect: 'manual' })).status, 302)
      assert.lengthOf(shopify.tokenRequests, 1)
      clock += BACKOFF_MS + 1000
      assert.equal((await app.request(launchUrl(SHOP), { redirect: 'manual' })).status, 302)
      assert.lengthOf(shopify.tokenRequests, 2)
    } finally {
      shopify.restore()
    }
  })

  test('a signed launch and background work on the same shop share one grant request', async ({ assert }) => {
    restoreEnv()
    restoreEnv = setClientCredentialsShop(SHOP)
    const token = gatedToken()
    const shopify = fakeShopify({ onToken: token.onToken })
    try {
      const app = await appWith()
      const client = await createShopifyClient('__global__')
      const launch = app.request(launchUrl(SHOP), { redirect: 'manual' })
      await token.received
      // Joins the request the launch started, before its first await.
      const background = client.graphql(query)
      token.release()
      const [data, res] = await Promise.all([background, launch])

      assert.deepEqual(data, { shop: { name: 'Dev store' } })
      assert.equal(res.status, 200)
      assert.lengthOf(shopify.tokenRequests, 1)
      const row = await storedInstallation()
      assert.equal(decryptString(row!.accessToken), 'shared-token')
      assert.isNull(row!.uninstalledAt)
    } finally {
      token.release()
      shopify.restore()
    }
  })

  test('a background refusal never holds back a signed launch: installed, then opened within the hour', async ({ assert }) => {
    restoreEnv()
    restoreEnv = setClientCredentialsShop(SHOP)
    let installed = false
    const shopify = fakeShopify({
      onToken: () => installed
        ? Response.json({ access_token: 'after-install', scope: 'read_orders', expires_in: 86399 })
        : Response.json({ error: 'shop_not_permitted' }, { status: 400 }),
    })
    try {
      const app = await appWith()
      // A cron runs before the app is installed on the store, and is refused.
      await assert.rejects(async () => (await createShopifyClient('__global__')).graphql(query), /same Shopify organization/)
      clock += 10 * 60_000
      await assert.rejects(async () => (await createShopifyClient('__global__')).graphql(query), /less than 1 hour ago/)
      assert.lengthOf(shopify.tokenRequests, 1)

      // The developer installs the app and opens it: the launch asks Shopify at once.
      installed = true
      const res = await app.request(launchUrl(SHOP), { redirect: 'manual' })
      assert.equal(res.status, 200)
      assert.lengthOf(shopify.tokenRequests, 2)
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'after-install')

      // The success cleared the background refusal too: with the row gone, background work asks again.
      await truncateAll()
      assert.deepEqual(await (await createShopifyClient('__global__')).graphql(query), { shop: { name: 'Dev store' } })
      assert.lengthOf(shopify.tokenRequests, 3)
    } finally {
      shopify.restore()
    }
  })

  test('a signed refusal holds back signed launches and background work alike', async ({ assert }) => {
    restoreEnv()
    restoreEnv = setClientCredentialsShop(SHOP)
    const shopify = fakeShopify({ onToken: () => Response.json({ error: 'shop_not_permitted' }, { status: 400 }) })
    try {
      const app = await appWith()
      assert.equal((await app.request(launchUrl(SHOP), { redirect: 'manual' })).status, 302)
      clock += 10 * 60_000
      assert.equal((await app.request(launchUrl(SHOP), { redirect: 'manual' })).status, 302)
      await assert.rejects(async () => (await createShopifyClient('__global__')).graphql(query), /less than 1 hour ago/)
      assert.lengthOf(shopify.tokenRequests, 1)
    } finally {
      shopify.restore()
    }
  })

  test('background work alone never revives a shop uninstalled while its grant was in flight', async ({ assert }) => {
    restoreEnv()
    restoreEnv = setClientCredentialsShop(SHOP)
    const token = gatedToken()
    const shopify = fakeShopify({ onToken: token.onToken })
    try {
      const client = await createShopifyClient(SHOP)
      const background = client.graphql(query).then(() => 'answered', (error: unknown) => errorMessage(error))
      await token.received
      await insertInstallation({ token: null, uninstalledAt: new Date() })
      token.release()

      assert.include(await background, 'the shop was uninstalled')
      const row = await storedInstallation()
      assert.isNull(row!.accessToken)
      assert.isNotNull(row!.uninstalledAt)
    } finally {
      token.release()
      shopify.restore()
    }
  })

  for (const first of ['background', 'signed'] as const) {
    test(`a signed launch sharing a grant with background work revives an uninstalled shop (${first} first)`, async ({ assert }) => {
      restoreEnv()
      restoreEnv = setClientCredentialsShop(SHOP)
      const token = gatedToken()
      const shopify = fakeShopify({ onToken: token.onToken })
      try {
        const app = await appWith()
        // Opened while the shop had no row; the row then says it was uninstalled.
        const client = await createShopifyClient(SHOP)
        let background: Promise<string>
        let launch: Promise<Response>
        const startBackground = () => client.graphql(query).then(() => 'answered', (error: unknown) => errorMessage(error))
        if (first === 'background') {
          background = startBackground()
          await token.received
          await insertInstallation({ token: null, uninstalledAt: new Date() })
          const reads = clockReads
          launch = app.request(launchUrl(SHOP), { redirect: 'manual' })
          // The launch checks its timestamp, then joins the request in that turn.
          await until(() => clockReads > reads)
        } else {
          await insertInstallation({ token: null, uninstalledAt: new Date() })
          launch = app.request(launchUrl(SHOP), { redirect: 'manual' })
          await token.received
          // Joins the request the launch started, before its first await.
          background = startBackground()
        }
        token.release()

        const res = await launch
        await background
        assert.equal(res.status, 200)
        assert.lengthOf(shopify.tokenRequests, 1)
        const row = await storedInstallation()
        assert.equal(decryptString(row!.accessToken), 'shared-token')
        assert.isNull(row!.uninstalledAt)
      } finally {
        token.release()
        shopify.restore()
      }
    })
  }

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

  test('a session token for a dev store stores the token exchange token and sends no grant', async ({ assert }) => {
    // Token exchange runs first, as before the grant existed: its offline token
    // does not expire, so nothing has to renew it.
    const shopify = fakeShopify({
      onToken: (call) => call.headers.get('content-type') === 'application/json'
        ? Response.json({ access_token: 'exchanged-token', scope: 'read_orders' })
        : Response.json({ access_token: 'granted-token', scope: 'read_orders', expires_in: 86399 }),
    })
    try {
      const app = await appWith()
      const res = await app.request('/api/flows', { headers: { Authorization: `Bearer ${sessionToken(SHOP)}` } })
      assert.equal(res.status, 200)
      assert.lengthOf(shopify.tokenRequests, 1)
      assert.equal(JSON.parse(shopify.tokenRequests[0]!.body).grant_type, 'urn:ietf:params:oauth:grant-type:token-exchange')
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'exchanged-token')

      // The token is stored: later requests ask Shopify for nothing.
      await app.request('/api/flows', { headers: { Authorization: `Bearer ${sessionToken(SHOP)}` } })
      assert.lengthOf(shopify.tokenRequests, 1)
    } finally {
      shopify.restore()
    }
  })

  test('a refused token exchange on a session token falls back to the grant', async ({ assert }) => {
    const shopify = fakeShopify({
      onToken: (call) => call.headers.get('content-type') === 'application/json'
        ? Response.json({ error: 'invalid_subject_token' }, { status: 400 })
        : Response.json({ access_token: 'granted-token', scope: 'read_orders', expires_in: 86399 }),
    })
    try {
      const app = await appWith()
      const res = await app.request('/api/flows', { headers: { Authorization: `Bearer ${sessionToken(SHOP)}` } })
      assert.equal(res.status, 200)
      assert.lengthOf(shopify.tokenRequests, 2)
      assert.equal(JSON.parse(shopify.tokenRequests[0]!.body).grant_type, 'urn:ietf:params:oauth:grant-type:token-exchange')
      assert.equal(grantForm(shopify.tokenRequests[1]!).get('grant_type'), 'client_credentials')
      assert.equal(decryptString((await storedInstallation())!.accessToken), 'granted-token')
    } finally {
      shopify.restore()
    }
  })

  test('a granted token that cannot be stored is logged without the token, on launches and session tokens alike', async ({ assert }) => {
    const errors: string[] = []
    const previousLogger = setRuntimeLogger({
      info: () => {},
      warn: () => {},
      error: (message: string, meta?: unknown) => { errors.push(`${message} ${JSON.stringify(meta ?? null)}`) },
    } satisfies RuntimeLogger)
    const shopify = fakeShopify({
      onToken: (call) => call.headers.get('content-type') === 'application/json'
        ? Response.json({ error: 'invalid_subject_token' }, { status: 400 })
        : Response.json({ access_token: 'granted-secret-token', scope: 'read_orders', expires_in: 86399 }),
    })
    const restoreWrites = await refuseInstallationWrites()
    try {
      const app = await appWith()
      assert.equal((await app.request(launchUrl(SHOP), { redirect: 'manual' })).status, 302)
      const res = await app.request('/api/flows', { headers: { Authorization: `Bearer ${sessionToken(OTHER_SHOP)}` } })
      assert.equal(res.status, 200)

      assert.deepEqual(errors, [
        `[openshop] Could not store a client credentials token for shop "${SHOP}" null`,
        `[openshop] Could not store a client credentials token for shop "${OTHER_SHOP}" null`,
      ])
      for (const error of errors) {
        assert.notInclude(error, 'granted-secret-token')
        assert.notInclude(error, 'enc:')
      }
    } finally {
      await restoreWrites()
      setRuntimeLogger(previousLogger)
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

test.group('Signed launches: Shopify managed installation', (group) => {
  let staticRoot: string
  let restoreEnv: () => void = () => {}

  group.setup(() => {
    staticRoot = mkdtempSync(join(tmpdir(), 'openshop-managed-install-test-'))
    writeFileSync(
      join(staticRoot, 'index.html'),
      '<html><head><meta name="shopify-api-key" content="" /></head><body>spa-shell</body></html>',
      'utf8',
    )
    return () => rmSync(staticRoot, { recursive: true, force: true })
  })

  group.each.setup(async () => {
    await freshState()
    restoreEnv = setClientCredentialsShop(undefined)
    return () => restoreEnv()
  })

  async function appWith(config: OpenShopConfig = createConfig({})) {
    return createServer(() => config, { staticDir: staticRoot })
  }

  function isTokenExchange(call: Call): boolean {
    return call.headers.get('content-type') === 'application/json'
  }

  /** Shopify answers the token exchange with `exchange`, and refuses the grant, as for a merchant's store. */
  function merchantShopify(exchange: Responder = () => Response.json({ access_token: 'exchanged-token', scope: 'read_orders' })) {
    return fakeShopify({
      onToken: (call) => isTokenExchange(call) ? exchange(call) : Response.json({ error: 'shop_not_permitted' }, { status: 400 }),
    })
  }

  test('a launch with a session token installs the shop by token exchange and renders the app', async ({ assert }) => {
    const shopify = merchantShopify()
    try {
      const app = await appWith()
      const idToken = sessionToken(OTHER_SHOP)
      const res = await app.request(launchUrl(OTHER_SHOP, { idToken }), { redirect: 'manual' })

      assert.equal(res.status, 200)
      const html = await res.text()
      assert.include(html, 'spa-shell')
      assert.include(html, `<meta name="shopify-api-key" content="${API_KEY}" />`)
      assert.lengthOf(shopify.tokenRequests, 1)
      const exchange = JSON.parse(shopify.tokenRequests[0]!.body)
      assert.equal(exchange.grant_type, 'urn:ietf:params:oauth:grant-type:token-exchange')
      assert.equal(exchange.subject_token, idToken)
      assert.equal(exchange.requested_token_type, 'urn:shopify:params:oauth:token-type:offline-access-token')
      const row = await storedInstallation(OTHER_SHOP)
      assert.equal(decryptString(row!.accessToken), 'exchanged-token')
      assert.isNull(row!.uninstalledAt)

      // Installed: the next launch asks Shopify for nothing.
      assert.equal((await app.request(launchUrl(OTHER_SHOP), { redirect: 'manual' })).status, 200)
      assert.lengthOf(shopify.tokenRequests, 1)
    } finally {
      shopify.restore()
    }
  })

  test('multi-app: a launch of the default app next to another installs it by token exchange', async ({ assert }) => {
    const shopify = merchantShopify()
    try {
      const app = await appWith(createConfig({}, { shopify: MULTI_APPS }))
      const idToken = sessionToken(OTHER_SHOP, { apiKey: 'default-app-key', secret: 'default-app-secret' })
      const res = await app.request(launchUrl(OTHER_SHOP, { secret: 'default-app-secret', idToken }), { redirect: 'manual' })

      assert.equal(res.status, 200)
      assert.include(await res.text(), '<meta name="shopify-api-key" content="default-app-key" />')
      assert.equal(JSON.parse(shopify.tokenRequests[0]!.body).client_id, 'default-app-key')
      assert.equal(decryptString((await storedInstallation(OTHER_SHOP, 'default'))!.accessToken), 'exchanged-token')
      assert.isUndefined(await storedInstallation(OTHER_SHOP, 'second'))
    } finally {
      shopify.restore()
    }
  })

  test('multi-app: the OAuth fallback of the default app names it, and /auth installs it', async ({ assert }) => {
    const shopify = merchantShopify()
    try {
      const app = await appWith(createConfig({}, { shopify: MULTI_APPS }))
      const res = await app.request(launchUrl(OTHER_SHOP, { secret: 'default-app-secret' }), { redirect: 'manual' })

      assert.equal(res.status, 302)
      const location = res.headers.get('location')!
      assert.equal(location, `/auth?shop=${OTHER_SHOP}&app=default`)
      const oauthStart = await app.request(location, { redirect: 'manual' })
      assert.equal(oauthStart.status, 302)
      assert.match(oauthStart.headers.get('location') ?? '', /^https:\/\/merchant-store\.myshopify\.com\/admin\/oauth\/authorize\?client_id=default-app-key&/)
    } finally {
      shopify.restore()
    }
  })

  test('a refused token exchange falls back to the grant, then to OAuth', async ({ assert }) => {
    const shopify = merchantShopify(() => Response.json({ error: 'invalid_subject_token' }, { status: 400 }))
    try {
      const app = await appWith()
      const res = await app.request(launchUrl(OTHER_SHOP, { idToken: sessionToken(OTHER_SHOP) }), { redirect: 'manual' })

      assert.equal(res.status, 302)
      assert.equal(res.headers.get('location'), `/auth?shop=${OTHER_SHOP}&app=default`)
      assert.deepEqual(shopify.tokenRequests.map(isTokenExchange), [true, false])
      assert.equal(grantForm(shopify.tokenRequests[1]!).get('grant_type'), 'client_credentials')
      assert.isUndefined(await storedInstallation(OTHER_SHOP))
    } finally {
      shopify.restore()
    }
  })

  test('a session token of another shop, of another app, or expired is never exchanged', async ({ assert }) => {
    const shopify = merchantShopify()
    try {
      const app = await appWith(createConfig({}, { shopify: MULTI_APPS }))
      for (const idToken of [
        sessionToken(SHOP, { apiKey: 'default-app-key', secret: 'default-app-secret' }),
        sessionToken(OTHER_SHOP, { apiKey: 'second-app-key', secret: 'second-app-secret' }),
        sessionToken(OTHER_SHOP, { apiKey: 'default-app-key', secret: 'second-app-secret' }),
        sessionToken(OTHER_SHOP, { apiKey: 'default-app-key', secret: 'default-app-secret', expiresIn: -60 }),
      ]) {
        const res = await app.request(launchUrl(OTHER_SHOP, { secret: 'default-app-secret', idToken }), { redirect: 'manual' })
        assert.equal(res.status, 302)
        assert.equal(res.headers.get('location'), `/auth?shop=${OTHER_SHOP}&app=default`)
      }
      assert.isFalse(shopify.tokenRequests.some(isTokenExchange))
      assert.isUndefined(await storedInstallation(OTHER_SHOP, 'default'))
    } finally {
      shopify.restore()
    }
  })
})

test.group('Client credentials: unsigned input', (group) => {
  let restoreEnv: () => void = () => {}

  group.each.setup(async () => {
    await freshState()
    restoreEnv = setClientCredentialsShop(SHOP)
    return () => restoreEnv()
  })

  test('a webhook naming the global placeholder is refused and runs nothing', async ({ assert }) => {
    const shops: string[] = []
    const config = createConfig({}, {
      webhooks: { ORDERS_CREATE: { run: async ({ shop }: { shop: string }) => { shops.push(shop) } } },
    })
    const shopify = fakeShopify()
    try {
      const app = await createServer(() => config)
      const body = JSON.stringify({ id: 1 })
      const send = (shop: string) => app.request('http://localhost/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shopify-hmac-sha256': signWebhook(body),
          'x-shopify-topic': 'orders/create',
          'x-shopify-shop-domain': shop,
          'x-shopify-api-version': '2026-04',
        },
        body,
      })

      assert.equal((await send('__global__')).status, 400)
      assert.equal((await send(OTHER_SHOP)).status, 200)
      assert.deepEqual(shops, [OTHER_SHOP])
      assert.lengthOf(shopify.requests, 0)
    } finally {
      shopify.restore()
    }
  })
})

test.group('Client credentials: each caller\'s config', (group) => {
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

  async function grantedClientId(shopify: FakeShopify, ask: () => Promise<unknown>): Promise<string | null> {
    await truncateAll()
    const before = shopify.tokenRequests.length
    await ask()
    return grantForm(shopify.tokenRequests[before]!).get('client_id')
  }

  test('two configs in one process each grant with their own credentials, whatever started first', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      const multi = createConfig({ 'query-flow': queryFlow }, { shopify: MULTI_APPS })
      const single = createConfig({ 'query-flow': queryFlow })
      await createServer(() => multi)
      startScheduler(single)
      assert.instanceOf(new Worker(single), Worker)

      assert.equal(await grantedClientId(shopify, () => runFlowWith(single, 'query-flow', '__global__')), API_KEY)
      assert.equal(await grantedClientId(shopify, () => runFlowWith(multi, 'query-flow', '__global__')), 'default-app-key')
      assert.equal(await grantedClientId(shopify, () => runFlowWith(single, 'query-flow', '__global__')), API_KEY)
    } finally {
      shopify.restore()
    }
  })

  test('the public createShopifyClient has no config: its default app uses the environment', async ({ assert }) => {
    const shopify = fakeShopify()
    try {
      await createServer(() => createConfig({}, { shopify: MULTI_APPS }))
      assert.equal(await grantedClientId(shopify, async () => (await createShopifyClient('__global__')).graphql(query)), API_KEY)
      // An internal caller with that config uses the default handle's credentials.
      const config = createConfig({}, { shopify: MULTI_APPS })
      assert.equal(
        await grantedClientId(shopify, async () => (await openShopifyClient('__global__', 'default', { getConfig: () => config })).graphql(query)),
        'default-app-key',
      )
    } finally {
      shopify.restore()
    }
  })
})

test.group('Client credentials: MCP tools', (group) => {
  let restoreEnv: () => void = () => {}

  group.each.setup(async () => {
    await freshState()
    restoreEnv = setClientCredentialsShop(SHOP)
    return () => restoreEnv()
  })

  async function listedShops(): Promise<string[]> {
    const result = await mcpTool('openshop.shops.list').run(mcpContext(new AbortController().signal), {}) as {
      structuredContent: { shops: Array<{ shop: string }> }
    }
    return result.structuredContent.shops.map((entry) => entry.shop)
  }

  test('the configured shop without a row is listed, and admin.graphql reaches it', async ({ assert }) => {
    await insertInstallation({ shop: OTHER_SHOP, token: 'merchant-token' })
    const shopify = fakeShopify()
    try {
      assert.deepEqual(await listedShops(), [SHOP, OTHER_SHOP])
      await adminGraphqlTool().run(mcpContext(new AbortController().signal), { shop: SHOP, apiVersion: '2026-04', query })
      assert.lengthOf(shopify.tokenRequests, 1)
      assert.equal(shopify.graphqlRequests[0]!.headers.get('x-shopify-access-token'), 'granted-token-1')
      assert.deepEqual(await listedShops(), [SHOP, OTHER_SHOP])
    } finally {
      shopify.restore()
    }
  })

  test('a shop marked uninstalled is neither listed nor reached, even with a token left in its row', async ({ assert }) => {
    await insertInstallation({ token: 'stale-token', uninstalledAt: new Date() })
    await insertInstallation({ shop: OTHER_SHOP, token: 'stale-token', uninstalledAt: new Date() })
    const shopify = fakeShopify()
    try {
      assert.deepEqual(await listedShops(), [])
      for (const shop of [SHOP, OTHER_SHOP]) {
        await assert.rejects(
          async () => adminGraphqlTool().run(mcpContext(new AbortController().signal), { shop, apiVersion: '2026-04', query }),
          new RegExp(`Shop "${shop}" is not installed for app "default"`),
        )
      }
      assert.lengthOf(shopify.requests, 0)
    } finally {
      shopify.restore()
    }
  })

  test('with the variable unset, only installed rows are listed and reached', async ({ assert }) => {
    restoreEnv()
    restoreEnv = setClientCredentialsShop(undefined)
    const shopify = fakeShopify()
    try {
      assert.deepEqual(await listedShops(), [])
      await assert.rejects(
        async () => adminGraphqlTool().run(mcpContext(new AbortController().signal), { shop: SHOP, apiVersion: '2026-04', query }),
        /Shop "dev-store.myshopify.com" is not installed for app "default"/,
      )
      assert.lengthOf(shopify.requests, 0)
    } finally {
      shopify.restore()
    }
  })
})

interface RedirectingShopify {
  /** Requests that reached the Shopify stand-in, which answers each with a 307. */
  redirected: string[]
  /** Requests that reached the address of the 307: there must be none. */
  stolen: string[]
  close: () => Promise<void>
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

/**
 * Sends every request for `https://<shop>.myshopify.com/...` to a local server
 * that answers `307 Temporary Redirect` to a second local server, which records
 * whatever reaches it. A 307 keeps the method and the body, so a client that
 * followed it would hand the secret or token it sent to that second address.
 */
async function redirectingShopify(): Promise<RedirectingShopify> {
  const stolen: string[] = []
  const redirected: string[] = []
  const thief = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      stolen.push(`${req.method} ${req.url} ${JSON.stringify(req.headers)} ${body}`)
      res.end('{}')
    })
  })
  const thiefPort = await listen(thief)
  const shopify = http.createServer((req, res) => {
    redirected.push(`${req.method} ${req.url}`)
    req.resume()
    res.writeHead(307, { Location: `http://127.0.0.1:${thiefPort}${req.url}` })
    res.end()
  })
  const shopifyPort = await listen(shopify)

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const match = url.match(/^https:\/\/[a-z0-9-]+\.myshopify\.com(\/.*)$/)
    return originalFetch(match ? `http://127.0.0.1:${shopifyPort}${match[1]}` : input, init)
  }
  return {
    stolen,
    redirected,
    close: async () => {
      globalThis.fetch = originalFetch
      shopify.closeAllConnections()
      thief.closeAllConnections()
      await Promise.all([shopify, thief].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
    },
  }
}

test.group('Client credentials: redirects', (group) => {
  let restoreEnv: () => void = () => {}

  group.each.setup(async () => {
    await freshState()
    restoreEnv = setClientCredentialsShop(SHOP)
    return () => restoreEnv()
  })

  test('a redirect of the token endpoint is never followed and counts as a transient failure', async ({ assert }) => {
    const shopify = await redirectingShopify()
    try {
      let message = ''
      try {
        await (await createShopifyClient(SHOP)).graphql(query)
      } catch (error) {
        message = errorMessage(error)
      }
      assert.include(message, 'redirect refused')
      assert.include(message, 'attempted again after 30 seconds')
      assert.notInclude(message, '127.0.0.1')
      assert.deepEqual(shopify.redirected, ['POST /admin/oauth/access_token'])
      assert.deepEqual(shopify.stolen, [])

      clock += BACKOFF_MS - 1000
      await assert.rejects(async () => (await createShopifyClient(SHOP)).graphql(query), /less than 30 seconds ago/)
      assert.lengthOf(shopify.redirected, 1)
      clock += 2000
      await assert.rejects(async () => (await createShopifyClient(SHOP)).graphql(query), /redirect refused/)
      assert.lengthOf(shopify.redirected, 2)
      assert.deepEqual(shopify.stolen, [])
    } finally {
      await shopify.close()
    }
  })

  test('a redirect of the Admin API never carries the token elsewhere, from a client or the MCP tool', async ({ assert }) => {
    await insertInstallation({ token: 'stored-secret-token' })
    const shopify = await redirectingShopify()
    try {
      const messages: string[] = []
      for (const call of [
        async () => (await createShopifyClient(SHOP)).graphql(query),
        async () => adminGraphqlTool().run(mcpContext(new AbortController().signal), { shop: SHOP, apiVersion: '2026-04', query }),
      ]) {
        try {
          await call()
        } catch (error) {
          messages.push(errorMessage(error))
        }
      }
      assert.deepEqual(messages, Array(2).fill('[openshop] Shopify answered a redirect, not followed'))
      assert.deepEqual(shopify.redirected, ['POST /admin/api/2026-04/graphql.json', 'POST /admin/api/2026-04/graphql.json'])
      assert.deepEqual(shopify.stolen, [])
    } finally {
      await shopify.close()
    }
  })

  test('a redirect during a session token\'s grant or token exchange is never followed', async ({ assert }) => {
    const shopify = await redirectingShopify()
    try {
      const app = await createServer(() => createConfig({}))
      const res = await app.request('/api/flows', { headers: { Authorization: `Bearer ${sessionToken(OTHER_SHOP)}` } })
      assert.equal(res.status, 200)
      // Token exchange, then the grant, each redirected once and followed by neither.
      assert.deepEqual(shopify.redirected, ['POST /admin/oauth/access_token', 'POST /admin/oauth/access_token'])
      assert.deepEqual(shopify.stolen, [])
      assert.isUndefined(await storedInstallation(OTHER_SHOP))
    } finally {
      await shopify.close()
    }
  })

  test('a redirect of the OAuth callback\'s token request is never followed and answers a clear error', async ({ assert }) => {
    await insertInstallation({ shop: OTHER_SHOP, token: null, nonce: 'oauth-nonce' })
    const shopify = await redirectingShopify()
    try {
      const app = await createServer(() => createConfig({}))
      const query = new URLSearchParams(signQuery({ code: 'oauth-code', shop: OTHER_SHOP, state: 'oauth-nonce', timestamp: String(Math.floor(clock / 1000)) }))
      const res = await app.request(`http://localhost/auth/callback?${query.toString()}`, { redirect: 'manual' })

      assert.equal(res.status, 502)
      assert.deepEqual(await res.json(), { error: '[openshop] Shopify answered a redirect, not followed' })
      assert.deepEqual(shopify.redirected, ['POST /admin/oauth/access_token'])
      assert.deepEqual(shopify.stolen, [])
      assert.isNull((await storedInstallation(OTHER_SHOP))!.accessToken)
    } finally {
      await shopify.close()
    }
  })
})
