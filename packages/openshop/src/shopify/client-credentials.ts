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
 *   covers `shop` and whose `timestamp` is recent, or a verified session
 *   token's `dest`), when the resolved app has no usable token for that shop.
 *   Any failure falls back to OAuth or token exchange exactly as before. A
 *   definite refusal is remembered in memory for one hour per app and shop, so
 *   a merchant's store pays the extra round trip at most once an hour per
 *   process; a transient failure only for a few seconds.
 * - For background work on the one shop named by `SHOPIFY_CLIENT_CREDENTIALS_SHOP`
 *   (and the `__global__` placeholder, which maps to it), with the `default` app.
 * - To renew a stored token the Admin API answered 401 to (one grant, one retry),
 *   and to renew a token this process obtained by grant shortly before it expires.
 *
 * Unsigned input never starts a grant for a shop of its choosing. A webhook's
 * signature covers the body, not the `X-Shopify-Shop-Domain` header, so its
 * shop is not vouched for by Shopify: the webhook route refuses the
 * `__global__` placeholder in that header, and a webhook handler reaches a
 * grant only like any other background work (the configured shop, or the 401
 * renewal of a token already stored for its shop).
 */
export const CLIENT_CREDENTIALS_SHOP_ENV = 'SHOPIFY_CLIENT_CREDENTIALS_SHOP'

/** Synthetic shop used by flows and crons that do not target a shop. */
export const GLOBAL_SHOP = '__global__'

/** Shopify documents `expires_in` as 86399 seconds for this grant. */
const DEFAULT_TOKEN_LIFETIME_MS = 86_399_000
/** A token this process obtained by grant is renewed this long before it expires. */
export const CLIENT_CREDENTIALS_RENEW_MARGIN_MS = 5 * 60_000
/**
 * A definite refusal (a 4xx answer carrying a Shopify error code, such as
 * `shop_not_permitted`) is not attempted again for this app and shop during this time.
 */
export const CLIENT_CREDENTIALS_REFUSAL_TTL_MS = 60 * 60_000
/**
 * A transient failure (network error, timeout, 429, 5xx, or an answer Shopify
 * did not explain) is not attempted again for this app and shop during this time.
 */
export const CLIENT_CREDENTIALS_RETRY_BACKOFF_MS = 30_000
/** The token request is abandoned after this long, and counts as a transient failure. */
export const CLIENT_CREDENTIALS_GRANT_TIMEOUT_MS = 5_000
/**
 * A signed admin launch only starts a grant (or revives an uninstalled row)
 * when its `timestamp` is this close to the current time: the same 90 seconds
 * Shopify's own app library tolerates, so a copied launch URL cannot be
 * replayed later. A stale but valid launch keeps the behaviour it had before
 * the grant existed.
 */
export const SIGNED_QUERY_MAX_AGE_MS = 90_000

const ERROR_CODE_RE = /^[a-z0-9_.-]{1,64}$/i
const TIMESTAMP_RE = /^\d{1,12}$/

interface AppCredentials {
  clientId: string
  clientSecret: string
}

/** Who vouched for the shop. A background grant never revives an uninstalled shop. */
type GrantMode = 'signed' | 'background'

/**
 * Why a grant gave no token: `refused` is a definite answer from Shopify,
 * `transient` a failure worth trying again soon, `other` anything decided
 * locally (invalid shop, missing credentials, uninstalled shop, cancelled call).
 */
type FailureKind = 'refused' | 'transient' | 'other'

type GrantResult = { ok: true; accessToken: string } | { ok: false; reason: string; kind: FailureKind }

/** What the token endpoint answered, before any caller stores it. */
type TokenAnswer =
  | { ok: true; accessToken: string; scopes: string | null; lifetimeMs: number }
  | { ok: false; reason: string; kind: FailureKind }

interface GrantedToken {
  accessToken: string
  expiresAt: number
}

interface Failure {
  until: number
  reason: string
  kind: FailureKind
  window: string
}

const granted = new Map<string, GrantedToken>()
const failures = new Map<string, Failure>()
const inFlight = new Map<string, Promise<TokenAnswer>>()
let now: () => number = () => Date.now()
let grantTimeoutMs = CLIENT_CREDENTIALS_GRANT_TIMEOUT_MS
let configSource: { get: () => OpenShopConfig; live: boolean } | null = null

function stateKey(shopifyApp: string, shop: string): string {
  return `${shopifyApp}\n${shop}`
}

function formatDuration(ms: number): string {
  if (ms % 3_600_000 === 0) return ms === 3_600_000 ? '1 hour' : `${ms / 3_600_000} hours`
  if (ms % 60_000 === 0) return ms === 60_000 ? '1 minute' : `${ms / 60_000} minutes`
  return `${Math.ceil(ms / 1000)} seconds`
}

/**
 * Clears the in-memory state (granted token lifetimes, remembered failures,
 * in-flight grants, the registered config) and optionally replaces the clock
 * and the grant timeout. Meant for tests.
 */
export function resetClientCredentialsState(options?: { now?: () => number; grantTimeoutMs?: number }): void {
  granted.clear()
  failures.clear()
  inFlight.clear()
  configSource = null
  now = options?.now ?? (() => Date.now())
  grantTimeoutMs = options?.grantTimeoutMs ?? CLIENT_CREDENTIALS_GRANT_TIMEOUT_MS
}

/**
 * Tells the grant where to read each app's API key and secret, so that
 * `shopify.apps` handles use their own credentials. Without it, only the
 * `default` app can be granted, from `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`.
 *
 * The server registers its live config getter (`live: true`), which follows
 * config reloads and always wins. The scheduler, the worker and the flow runner
 * register a fixed copy, which is only taken when nothing is registered yet: in
 * a process that runs the server too, they never replace its live getter, and
 * later fixed copies (one per flow run) never replace the first.
 */
export function useShopifyAppsConfig(getConfig: () => OpenShopConfig, options?: { live?: boolean }): void {
  const live = options?.live === true
  if (live || !configSource) configSource = { get: getConfig, live }
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

/**
 * Whether the `timestamp` of a Shopify-signed query (seconds since the epoch)
 * is within `SIGNED_QUERY_MAX_AGE_MS` of now, in either direction.
 */
export function isFreshSignedTimestamp(timestamp: unknown): boolean {
  if (typeof timestamp !== 'string' || !TIMESTAMP_RE.test(timestamp)) return false
  return Math.abs(now() - Number(timestamp) * 1000) <= SIGNED_QUERY_MAX_AGE_MS
}

function credentialsFor(shopifyApp: string): AppCredentials | null {
  if (configSource) {
    let app
    try {
      app = resolveShopifyApps(configSource.get()).find((candidate) => candidate.handle === shopifyApp)
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

/** Settles like `promise`, or rejects with the signal's reason once it aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

async function readErrorCode(response: Response, signal: AbortSignal): Promise<string | null> {
  try {
    const body = await untilAborted(response.json(), signal) as { error?: unknown; errors?: unknown }
    const code = typeof body.error === 'string' ? body.error : typeof body.errors === 'string' ? body.errors : null
    return code && ERROR_CODE_RE.test(code) ? code : null
  } catch {
    return null
  }
}

function remember(shopifyApp: string, shop: string, reason: string, kind: 'refused' | 'transient'): TokenAnswer {
  const ttl = kind === 'refused' ? CLIENT_CREDENTIALS_REFUSAL_TTL_MS : CLIENT_CREDENTIALS_RETRY_BACKOFF_MS
  const window = formatDuration(ttl)
  failures.set(stateKey(shopifyApp, shop), { until: now() + ttl, reason, kind, window })
  getRuntimeLogger().info(
    `[openshop] Client credentials grant ${kind === 'refused' ? 'refused' : 'failed'} for app "${shopifyApp}" and shop "${shop}" `
    + `(${reason}); not attempted again for ${window}`,
  )
  return { ok: false, reason, kind }
}

/**
 * Asks Shopify's token endpoint once, with a timeout. Never throws: every
 * failure is remembered, for an hour when Shopify refused with an error code,
 * for `CLIENT_CREDENTIALS_RETRY_BACKOFF_MS` otherwise.
 */
async function requestToken(shopifyApp: string, shop: string, credentials: AppCredentials): Promise<TokenAnswer> {
  const timeout = AbortSignal.timeout(grantTimeoutMs)
  let response: Response
  try {
    // The race keeps the timeout even if a fetch implementation ignored the signal.
    response = await untilAborted(fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }).toString(),
      signal: timeout,
    }), timeout)
  } catch {
    return remember(shopifyApp, shop, timeout.aborted ? 'timed out' : 'network error', 'transient')
  }

  if (!response.ok) {
    const code = await readErrorCode(response, timeout)
    const definite = response.status >= 400 && response.status < 500 && response.status !== 429 && code !== null
    return remember(shopifyApp, shop, `HTTP ${response.status}${code ? `, ${code}` : ''}`, definite ? 'refused' : 'transient')
  }

  let data: { access_token?: unknown; scope?: unknown; expires_in?: unknown }
  try {
    data = await untilAborted(response.json(), timeout) as typeof data
  } catch {
    data = {}
  }
  if (typeof data.access_token !== 'string' || data.access_token === '') {
    return remember(shopifyApp, shop, 'no access token in the answer', 'transient')
  }

  failures.delete(stateKey(shopifyApp, shop))
  const lifetimeMs = typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0
    ? data.expires_in * 1000
    : DEFAULT_TOKEN_LIFETIME_MS
  return {
    ok: true,
    accessToken: data.access_token,
    scopes: typeof data.scope === 'string' ? data.scope : null,
    lifetimeMs,
  }
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

/**
 * Gets a token for this app and shop and stores it, unless a grant for them
 * failed recently (an hour after a refusal, `CLIENT_CREDENTIALS_RETRY_BACKOFF_MS`
 * after a transient failure).
 *
 * Concurrent callers share one request to Shopify per app and shop, whatever
 * their mode; each then stores the answer with its own mode, so a background
 * caller never revives an uninstalled row and never keeps a signed caller from
 * reviving it. `signal` only stops this caller's wait: the shared request runs
 * until it ends or times out. Shopify failures are returned, never thrown; a
 * database error is thrown as a generic error that quotes neither the token
 * nor the query.
 */
async function grant(
  shopifyApp: string,
  shop: string,
  credentials: AppCredentials,
  mode: GrantMode,
  signal?: AbortSignal,
): Promise<GrantResult> {
  const validShop = strictShopDomain(shop)
  if (!validShop) return { ok: false, reason: 'invalid shop domain', kind: 'other' }

  const key = stateKey(shopifyApp, validShop)
  const failure = failures.get(key)
  if (failure) {
    if (failure.until > now()) return { ok: false, reason: `${failure.reason}, less than ${failure.window} ago`, kind: failure.kind }
    failures.delete(key)
  }

  let pending = inFlight.get(key)
  if (!pending) {
    const request: Promise<TokenAnswer> = requestToken(shopifyApp, validShop, credentials)
      .finally(() => { if (inFlight.get(key) === request) inFlight.delete(key) })
    inFlight.set(key, request)
    pending = request
  }

  let answer: TokenAnswer
  try {
    answer = signal ? await untilAborted(pending, signal) : await pending
  } catch {
    return { ok: false, reason: 'cancelled', kind: 'other' }
  }
  if (!answer.ok) return answer

  let stored: boolean
  try {
    stored = await storeToken(shopifyApp, validShop, answer.accessToken, answer.scopes, mode)
  } catch {
    // Database errors quote the query parameters, the sealed token among them.
    throw new Error(`[openshop] Could not store the client credentials token for app "${shopifyApp}" and shop "${validShop}"`)
  }
  if (!stored) return { ok: false, reason: 'the shop was uninstalled', kind: 'other' }

  granted.set(key, { accessToken: answer.accessToken, expiresAt: now() + answer.lifetimeMs })
  return { ok: true, accessToken: answer.accessToken }
}

/**
 * Tries the grant for a shop Shopify vouched for in this request: an admin launch
 * whose query HMAC covers `shop` and whose timestamp is fresh, or a verified
 * session token's `dest`. The caller passes the app resolved from that signature
 * and checks beforehand that it has no usable token. Returns true when a token
 * was stored (an uninstalled row is revived, since Shopify says the app is open
 * on the shop); false sends the caller to its usual OAuth or token exchange path.
 */
export async function grantForSignedRequest(
  app: { handle: string; apiKey: string; apiSecret: string },
  shop: string,
): Promise<boolean> {
  if (!app.apiKey || !app.apiSecret) return false
  const result = await grant(app.handle, shop, { clientId: app.apiKey, clientSecret: app.apiSecret }, 'signed')
  return result.ok
}

function grantFailure(shop: string, result: { reason: string; kind: FailureKind }): Error {
  const hint = result.kind === 'refused'
    ? ' The app and the store must belong to the same Shopify organization and the app must be installed on the store.'
    : result.kind === 'transient'
      ? ` Shopify could not be reached or did not grant a token; the grant is attempted again after ${formatDuration(CLIENT_CREDENTIALS_RETRY_BACKOFF_MS)}.`
      : ''
  return new Error(`[openshop] Client credentials grant ${result.kind === 'refused' ? 'refused' : 'failed'} for shop "${shop}" (${result.reason}).${hint}`)
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
 *
 * `signal` (an MCP call's or a flow run's) stops waiting for a grant.
 */
export async function openAdminTokenSource(
  shopifyApp: string,
  shop: string,
  options?: { missingToken?: () => Error; signal?: AbortSignal },
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
    if (!credentials) return { ok: false, reason: `no API key and secret for app "${shopifyApp}"`, kind: 'other' }
    return grant(shopifyApp, tokenShop, credentials, 'background', options?.signal)
  }

  return {
    shop: tokenShop,

    async token() {
      if (current) {
        const own = granted.get(key)
        if (own && own.accessToken === current && own.expiresAt - CLIENT_CREDENTIALS_RENEW_MARGIN_MS <= now()) {
          // A failed renewal keeps the current token: it may still have minutes
          // left, and a transient failure only holds the next attempt (here or
          // after a 401) for CLIENT_CREDENTIALS_RETRY_BACKOFF_MS.
          const renewed = await backgroundGrant()
          if (renewed.ok) current = renewed.accessToken
        }
        return current
      }

      if (configuredShop && !uninstalled) {
        const result = await backgroundGrant()
        if (!result.ok) throw grantFailure(tokenShop, result)
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
