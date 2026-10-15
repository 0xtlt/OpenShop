import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/client.ts'
import { installations } from '../db/schema.ts'
import { decryptString, encryptString } from '../server/crypto.ts'
import { normalizeShopDomain } from '../server/shop-domain.ts'
import { DEFAULT_SHOPIFY_APP_HANDLE } from '../server/shopify-apps.ts'

/**
 * Client credentials token mode.
 *
 * Shopify's client credentials grant gives an Admin API token without a browser,
 * but only when the app and the store belong to the same Shopify organization
 * (a development store of the app's own organization). It is opt-in: setting
 * `SHOPIFY_CLIENT_CREDENTIALS_SHOP` to one `*.myshopify.com` domain makes the
 * `default` app (`SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`) obtain and renew its
 * token for that shop by itself. Every other shop keeps OAuth and token exchange.
 */
export const CLIENT_CREDENTIALS_SHOP_ENV = 'SHOPIFY_CLIENT_CREDENTIALS_SHOP'

/** Synthetic shop used by flows and crons that do not target a shop. */
export const GLOBAL_SHOP = '__global__'

/** Shopify documents `expires_in` as 86399 seconds for this grant. */
const DEFAULT_TOKEN_LIFETIME_MS = 86_399_000
/** A stored token is renewed this long before it expires. */
export const CLIENT_CREDENTIALS_RENEW_MARGIN_MS = 5 * 60_000

const ERROR_CODE_RE = /^[a-z0-9_.-]{1,64}$/i

export interface ClientCredentialsToken {
  accessToken: string
  expiresAt: Date
}

const inFlight = new Map<string, Promise<ClientCredentialsToken>>()

/**
 * The shop configured for client credentials, or `null` when the mode is off.
 * Throws when the variable is set to something other than a `*.myshopify.com` domain.
 */
export function clientCredentialsShop(): string | null {
  const raw = process.env[CLIENT_CREDENTIALS_SHOP_ENV]
  if (raw === undefined || raw.trim() === '') return null
  const shop = normalizeShopDomain(raw)
  if (!shop) {
    throw new Error(`[openshop] ${CLIENT_CREDENTIALS_SHOP_ENV} must be a *.myshopify.com domain`)
  }
  return shop
}

/**
 * The shop whose token the client credentials mode provides for this app and
 * shop, or `null` when the mode does not apply. The global placeholder shop
 * resolves to the configured shop.
 */
export function clientCredentialsTarget(shopifyApp: string, shop: string): string | null {
  const configured = clientCredentialsShop()
  if (!configured || shopifyApp !== DEFAULT_SHOPIFY_APP_HANDLE) return null
  if (shop === GLOBAL_SHOP) return configured
  return normalizeShopDomain(shop) === configured ? configured : null
}

function appCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.SHOPIFY_API_KEY ?? ''
  const clientSecret = process.env.SHOPIFY_API_SECRET ?? ''
  if (!clientId || !clientSecret) {
    throw new Error(`[openshop] ${CLIENT_CREDENTIALS_SHOP_ENV} requires SHOPIFY_API_KEY and SHOPIFY_API_SECRET`)
  }
  return { clientId, clientSecret }
}

function isFresh(token: ClientCredentialsToken): boolean {
  return token.expiresAt.getTime() - CLIENT_CREDENTIALS_RENEW_MARGIN_MS > Date.now()
}

async function readStoredToken(shop: string): Promise<ClientCredentialsToken | null> {
  const [installation] = await getDb()
    .select({
      accessToken: installations.accessToken,
      installedAt: installations.installedAt,
      uninstalledAt: installations.uninstalledAt,
    })
    .from(installations)
    .where(and(eq(installations.appHandle, DEFAULT_SHOPIFY_APP_HANDLE), eq(installations.shop, shop)))
    .limit(1)

  if (!installation || installation.uninstalledAt) return null
  const accessToken = decryptString(installation.accessToken)
  if (!accessToken) return null
  // A granted token is stored with `installedAt` set to the time of the grant,
  // as the OAuth callback does, so its expiry needs no column of its own.
  return { accessToken, expiresAt: new Date(installation.installedAt.getTime() + DEFAULT_TOKEN_LIFETIME_MS) }
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

async function requestToken(shop: string): Promise<ClientCredentialsToken> {
  const { clientId, clientSecret } = appCredentials()
  const grantedAt = new Date()
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  })

  if (!response.ok) {
    const code = await readErrorCode(response)
    throw new Error(
      `[openshop] Client credentials grant refused for shop "${shop}" (HTTP ${response.status}${code ? `, ${code}` : ''}). `
      + 'The app and the store must belong to the same Shopify organization and the app must be installed on the store.',
    )
  }

  const data = await response.json() as { access_token?: unknown; scope?: unknown; expires_in?: unknown }
  if (typeof data.access_token !== 'string' || data.access_token === '') {
    throw new Error(`[openshop] Client credentials grant for shop "${shop}" returned no access token`)
  }
  const scopes = typeof data.scope === 'string' ? data.scope : null
  const lifetimeMs = typeof data.expires_in === 'number' && data.expires_in > 0
    ? Math.min(data.expires_in * 1000, DEFAULT_TOKEN_LIFETIME_MS)
    : DEFAULT_TOKEN_LIFETIME_MS

  const accessToken = encryptString(data.access_token)
  await getDb().insert(installations)
    .values({ appHandle: DEFAULT_SHOPIFY_APP_HANDLE, shop, accessToken, scopes, installedAt: grantedAt })
    .onConflictDoUpdate({
      target: [installations.appHandle, installations.shop],
      set: { accessToken, scopes, nonce: null, installedAt: grantedAt, uninstalledAt: null },
    })

  return { accessToken: data.access_token, expiresAt: new Date(grantedAt.getTime() + lifetimeMs) }
}

function renewOnce(shop: string): Promise<ClientCredentialsToken> {
  const pending = inFlight.get(shop)
  if (pending) return pending
  const request = requestToken(shop).finally(() => inFlight.delete(shop))
  inFlight.set(shop, request)
  return request
}

/**
 * Returns a usable client credentials token for `shop`: the stored one while it
 * has more than the renewal margin left, a new one otherwise.
 *
 * `rejected` is a token the Admin API answered 401 to. It is renewed even when
 * it looks fresh, unless another caller already replaced it.
 */
export async function getClientCredentialsToken(
  shop: string,
  options?: { rejected?: string },
): Promise<ClientCredentialsToken> {
  const pending = inFlight.get(shop)
  if (pending) return pending

  const stored = await readStoredToken(shop)
  if (stored && isFresh(stored) && stored.accessToken !== options?.rejected) return stored
  return renewOnce(shop)
}
