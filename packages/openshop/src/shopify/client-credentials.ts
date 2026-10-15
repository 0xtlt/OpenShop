import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client.ts'
import { installations } from '../db/schema.ts'
import { decryptString, encryptString } from '../server/crypto.ts'
import { strictShopDomain } from '../server/shop-domain.ts'
import { DEFAULT_SHOPIFY_APP_HANDLE, resolveShopifyApps } from '../server/shopify-apps.ts'
import { getRuntimeLogger } from '../runtime/logger.ts'
import type { OpenShopConfig } from '../types.ts'

/**
 * Shopify's client credentials grant.
 *
 * The grant gives an Admin API token with no browser and no click, but Shopify
 * only answers it when the app and the store belong to the same organization
 * (a development store of the organization that owns the app). OpenShop uses it
 * in three places, and nowhere else:
 *
 * - On a request whose shop Shopify signed (an admin launch whose query HMAC
 *   covers `shop`, or a verified session token's `dest`), when the resolved app
 *   has no usable token for that shop. Any failure falls back to OAuth or token
 *   exchange exactly as before. A refusal is remembered in memory for one hour
 *   per app and shop, so a merchant's store pays the extra round trip at most
 *   once an hour per process.
 * - For background work on the one shop named by `SHOPIFY_CLIENT_CREDENTIALS_SHOP`
 *   (and the `__global__` placeholder, which maps to it), with the `default` app.
 * - To renew a stored token the Admin API answered 401 to (one grant, one retry),
 *   and to renew a token this process obtained by grant shortly before it expires.
 *
 * A webhook never triggers a grant: its signature covers the body, not the
 * `X-Shopify-Shop-Domain` header, so its shop is not vouched for by Shopify.
 */
export const CLIENT_CREDENTIALS_SHOP_ENV = 'SHOPIFY_CLIENT_CREDENTIALS_SHOP'

/** Synthetic shop used by flows and crons that do not target a shop. */
export const GLOBAL_SHOP = '__global__'

/** Shopify documents `expires_in` as 86399 seconds for this grant. */
const DEFAULT_TOKEN_LIFETIME_MS = 86_399_000
/** A token this process obtained by grant is renewed this long before it expires. */
export const CLIENT_CREDENTIALS_RENEW_MARGIN_MS = 5 * 60_000
/** A refused grant is not attempted again for this app and shop during this time. */
export const CLIENT_CREDENTIALS_REFUSAL_TTL_MS = 60 * 60_000

const ERROR_CODE_RE = /^[a-z0-9_.-]{1,64}$/i

interface AppCredentials {
  clientId: string
  clientSecret: string
}

/** Who vouched for the shop. A background grant never revives an uninstalled shop. */
type GrantMode = 'signed' | 'background'

type GrantResult = { ok: true; accessToken: string } | { ok: false; reason: string }

interface GrantedToken {
  accessToken: string
  expiresAt: number
}

interface Refusal {
  until: number
  reason: string
}

const granted = new Map<string, GrantedToken>()
const refusals = new Map<string, Refusal>()
const inFlight = new Map<string, Promise<GrantResult>>()
let now: () => number = () => Date.now()
let configSource: (() => OpenShopConfig) | null = null

function stateKey(shopifyApp: string, shop: string): string {
  return `${shopifyApp}\n${shop}`
}

/**
 * Clears the in-memory state (granted token lifetimes, remembered refusals,
 * in-flight grants) and optionally replaces the clock. Meant for tests.
 */
export function resetClientCredentialsState(options?: { now?: () => number }): void {
  granted.clear()
  refusals.clear()
  inFlight.clear()
  now = options?.now ?? (() => Date.now())
}

/**
 * Tells the grant where to read each app's API key and secret. The server, the
 * scheduler, the worker and the flow runner call it with their config, so that
 * `shopify.apps` handles use their own credentials. Without it, only the
 * `default` app can be granted, from `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`.
 */
export function useShopifyAppsConfig(getConfig: () => OpenShopConfig): void {
  configSource = getConfig
}

/**
 * The shop named by `SHOPIFY_CLIENT_CREDENTIALS_SHOP`, or `null` when it is unset.
 * Throws when it is set to anything but exactly `<name>.myshopify.com`.
 */
export function clientCredentialsShop(): string | null {
  const raw = process.env[CLIENT_CREDENTIALS_SHOP_ENV]
  if (raw === undefined || raw === '') return null
  const shop = strictShopDomain(raw)
  if (!shop) {
    throw new Error(`[openshop] ${CLIENT_CREDENTIALS_SHOP_ENV} must be exactly <name>.myshopify.com (lowercase, no scheme, port or path)`)
  }
  return shop
}

/**
 * Checks at startup that the variable, when set, can be served: a valid shop and
 * a `default` app with an API key and secret. In multi-app mode a config without
 * a `default` handle is refused, since nothing says which app the shop belongs to.
 */
export function assertClientCredentialsConfig(config: OpenShopConfig): void {
  const shop = clientCredentialsShop()
  if (!shop) return
  const app = resolveShopifyApps(config).find((candidate) => candidate.handle === DEFAULT_SHOPIFY_APP_HANDLE)
  if (!app) {
    throw new Error(
      `[openshop] ${CLIENT_CREDENTIALS_SHOP_ENV} needs a Shopify app with the "${DEFAULT_SHOPIFY_APP_HANDLE}" handle in shopify.apps: `
      + 'background work on that shop uses that app',
    )
  }
  if (!app.apiKey || !app.apiSecret) {
    throw new Error(`[openshop] ${CLIENT_CREDENTIALS_SHOP_ENV} requires the API key and secret of the "${DEFAULT_SHOPIFY_APP_HANDLE}" app`)
  }
}

/**
 * The shop background work reaches by client credentials for this app and shop:
 * the configured shop when the app is `default` and the shop is that shop or the
 * `__global__` placeholder, `null` otherwise.
 */
export function clientCredentialsTarget(shopifyApp: string, shop: string): string | null {
  const configured = clientCredentialsShop()
  if (!configured || shopifyApp !== DEFAULT_SHOPIFY_APP_HANDLE) return null
  return shop === GLOBAL_SHOP || shop === configured ? configured : null
}

function credentialsFor(shopifyApp: string): AppCredentials | null {
  if (configSource) {
    let app
    try {
      app = resolveShopifyApps(configSource()).find((candidate) => candidate.handle === shopifyApp)
    } catch {
      return null
    }
    return app?.apiKey && app.apiSecret ? { clientId: app.apiKey, clientSecret: app.apiSecret } : null
  }
  if (shopifyApp !== DEFAULT_SHOPIFY_APP_HANDLE) return null
  const clientId = process.env.SHOPIFY_API_KEY ?? ''
  const clientSecret = process.env.SHOPIFY_API_SECRET ?? ''
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body = await response.json() as { error?: unknown; errors?: unknown }
    const code = typeof body.error === 'string' ? body.error : typeof body.errors === 'string' ? body.errors : null
    return code && ERROR_CODE_RE.test(code) ? code : null
  } catch {
    return null
  }
}

function refuse(shopifyApp: string, shop: string, reason: string): GrantResult {
  refusals.set(stateKey(shopifyApp, shop), { until: now() + CLIENT_CREDENTIALS_REFUSAL_TTL_MS, reason })
  getRuntimeLogger().info(
    `[openshop] Client credentials grant refused for app "${shopifyApp}" and shop "${shop}" (${reason}); not attempted again for 1 hour`,
  )
  return { ok: false, reason }
}

/** Stores a granted token. Returns false when a background grant met an uninstalled shop. */
async function storeToken(shopifyApp: string, shop: string, token: string, scopes: string | null, mode: GrantMode): Promise<boolean> {
  const accessToken = encryptString(token)
  const scopeUpdate = scopes === null ? {} : { scopes }
  // `nonce` and `installedAt` are left alone: an OAuth flow may be in progress.
  if (mode === 'signed') {
    await getDb().insert(installations)
      .values({ appHandle: shopifyApp, shop, accessToken, scopes })
      .onConflictDoUpdate({
        target: [installations.appHandle, installations.shop],
        set: { accessToken, ...scopeUpdate, uninstalledAt: null },
      })
    return true
  }
  const rows = await getDb().insert(installations)
    .values({ appHandle: shopifyApp, shop, accessToken, scopes })
    .onConflictDoUpdate({
      target: [installations.appHandle, installations.shop],
      set: { accessToken, ...scopeUpdate },
      setWhere: isNull(installations.uninstalledAt),
    })
    .returning({ id: installations.id })
  return rows.length > 0
}

async function requestGrant(shopifyApp: string, shop: string, credentials: AppCredentials, mode: GrantMode): Promise<GrantResult> {
  let response: Response
  try {
    response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }).toString(),
    })
  } catch {
    return refuse(shopifyApp, shop, 'network error')
  }

  if (!response.ok) {
    const code = await readErrorCode(response)
    return refuse(shopifyApp, shop, `HTTP ${response.status}${code ? `, ${code}` : ''}`)
  }

  let data: { access_token?: unknown; scope?: unknown; expires_in?: unknown }
  try {
    data = await response.json() as typeof data
  } catch {
    data = {}
  }
  if (typeof data.access_token !== 'string' || data.access_token === '') {
    return refuse(shopifyApp, shop, 'no access token in the answer')
  }

  const lifetimeMs = typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0
    ? data.expires_in * 1000
    : DEFAULT_TOKEN_LIFETIME_MS
  const scopes = typeof data.scope === 'string' ? data.scope : null
  const stored = await storeToken(shopifyApp, shop, data.access_token, scopes, mode)
  if (!stored) return { ok: false, reason: 'the shop was uninstalled' }

  const key = stateKey(shopifyApp, shop)
  refusals.delete(key)
  granted.set(key, { accessToken: data.access_token, expiresAt: now() + lifetimeMs })
  return { ok: true, accessToken: data.access_token }
}

/**
 * Asks Shopify for a token, unless a grant for this app and shop was refused less
 * than an hour ago. Concurrent callers share one request per app, shop and mode.
 * Shopify refusals are returned, never thrown; database errors are thrown.
 */
function grant(shopifyApp: string, shop: string, credentials: AppCredentials, mode: GrantMode): Promise<GrantResult> {
  const validShop = strictShopDomain(shop)
  if (!validShop) return Promise.resolve({ ok: false, reason: 'invalid shop domain' })

  const key = stateKey(shopifyApp, validShop)
  const refusal = refusals.get(key)
  if (refusal) {
    if (refusal.until > now()) return Promise.resolve({ ok: false, reason: `${refusal.reason}, less than 1 hour ago` })
    refusals.delete(key)
  }

  const flightKey = `${mode}\n${key}`
  const pending = inFlight.get(flightKey)
  if (pending) return pending
  const request = requestGrant(shopifyApp, validShop, credentials, mode).finally(() => inFlight.delete(flightKey))
  inFlight.set(flightKey, request)
  return request
}

/**
 * Tries the grant for a shop Shopify vouched for in this request: an admin launch
 * whose query HMAC covers `shop`, or a verified session token's `dest`. The
 * caller passes the app resolved from that signature and checks beforehand that
 * it has no usable token. Returns true when a token was stored (an uninstalled
 * row is revived, since Shopify says the app is open on the shop); false sends
 * the caller to its usual OAuth or token exchange path.
 */
export async function grantForSignedRequest(
  app: { handle: string; apiKey: string; apiSecret: string },
  shop: string,
): Promise<boolean> {
  if (!app.apiKey || !app.apiSecret) return false
  const result = await grant(app.handle, shop, { clientId: app.apiKey, clientSecret: app.apiSecret }, 'signed')
  return result.ok
}

function grantFailure(shop: string, reason: string): Error {
  return new Error(
    `[openshop] Client credentials grant refused for shop "${shop}" (${reason}). `
    + 'The app and the store must belong to the same Shopify organization and the app must be installed on the store.',
  )
}

/** The token an Admin API call uses, and how to replace it after a 401. */
export interface AdminTokenSource {
  /** The shop the token belongs to (the configured shop for `__global__`). */
  readonly shop: string
  /** A usable token, or an error saying why there is none. */
  token(): Promise<string>
  /** A replacement for a token the Admin API answered 401 to, or `null`. */
  renewAfterUnauthorized(rejected: string): Promise<string | null>
}

/**
 * Resolves the Admin API token of an app on a shop, for work that has no
 * Shopify-signed request behind it (flows, crons, admin API handlers, MCP):
 *
 * - a stored token, whatever obtained it, is used as is;
 * - with no stored token, only the shop of `SHOPIFY_CLIENT_CREDENTIALS_SHOP`
 *   (or `__global__`) for the `default` app is granted, unless its row says
 *   it was uninstalled;
 * - a token this process granted is renewed 5 minutes before it expires;
 * - after a 401, one grant replaces the token, unless the shop is uninstalled.
 */
export async function openAdminTokenSource(
  shopifyApp: string,
  shop: string,
  options?: { missingToken?: () => Error },
): Promise<AdminTokenSource> {
  const configuredShop = clientCredentialsTarget(shopifyApp, shop)
  const tokenShop = configuredShop ?? shop
  const key = stateKey(shopifyApp, tokenShop)
  const [installation] = await getDb()
    .select({ accessToken: installations.accessToken, uninstalledAt: installations.uninstalledAt })
    .from(installations)
    .where(and(eq(installations.appHandle, shopifyApp), eq(installations.shop, tokenShop)))
    .limit(1)

  let current = decryptString(installation?.accessToken)
  const uninstalled = Boolean(installation?.uninstalledAt)
  const missingToken = options?.missingToken
    ?? (() => new Error(`[openshop] No access token found for app "${shopifyApp}" and shop "${shop}". Is the app installed?`))

  async function backgroundGrant(): Promise<GrantResult> {
    const credentials = credentialsFor(shopifyApp)
    if (!credentials) return { ok: false, reason: `no API key and secret for app "${shopifyApp}"` }
    return grant(shopifyApp, tokenShop, credentials, 'background')
  }

  return {
    shop: tokenShop,

    async token() {
      if (current) {
        const own = granted.get(key)
        if (own && own.accessToken === current && own.expiresAt - CLIENT_CREDENTIALS_RENEW_MARGIN_MS <= now()) {
          // A failed renewal keeps the current token: it may still have minutes left.
          const renewed = await backgroundGrant()
          if (renewed.ok) current = renewed.accessToken
        }
        return current
      }

      if (configuredShop && !uninstalled) {
        const result = await backgroundGrant()
        if (!result.ok) throw grantFailure(tokenShop, result.reason)
        current = result.accessToken
        return current
      }

      throw missingToken()
    },

    async renewAfterUnauthorized(rejected) {
      const [row] = await getDb()
        .select({ accessToken: installations.accessToken, uninstalledAt: installations.uninstalledAt })
        .from(installations)
        .where(and(eq(installations.appHandle, shopifyApp), eq(installations.shop, tokenShop)))
        .limit(1)
      if (row?.uninstalledAt) return null
      if (!row && !configuredShop) return null
      // Another caller may already have replaced it.
      const stored = decryptString(row?.accessToken)
      if (stored && stored !== rejected) {
        current = stored
        return stored
      }
      const result = await backgroundGrant()
      if (!result.ok) return null
      current = result.accessToken
      return current
    },
  }
}

/**
 * Sends an Admin API request with the source's token. On a 401 the token is
 * renewed once and the request sent once more; when no new token can be had,
 * the original 401 response is returned untouched.
 */
export async function sendWithAdminToken(
  source: AdminTokenSource,
  send: (accessToken: string) => Promise<Response>,
): Promise<Response> {
  const accessToken = await source.token()
  const response = await send(accessToken)
  if (response.status !== 401) return response

  const renewed = await source.renewAfterUnauthorized(accessToken)
  if (!renewed) return response
  await response.body?.cancel()
  return send(renewed)
}
