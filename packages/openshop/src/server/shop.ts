import type { Context, Next } from 'hono'
import { and, eq } from 'drizzle-orm'
import { verifySessionToken } from '#server/jwt'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import { encryptString } from '#server/crypto'
import { getRuntimeLogger } from '../runtime/logger.ts'
import { readJwtAudience, resolveShopifyAppByApiKey, type ResolvedShopifyApp } from '#server/shopify-apps'
import type { OpenShopConfig } from '#types'

export function createShopMiddleware(getConfig: () => OpenShopConfig) {
  return async function shopMiddleware(c: Context, next: Next) {
  let shop: string | undefined
  let sessionToken: string | undefined
  let shopifyApp: ResolvedShopifyApp | undefined

  const auth = c.req.header('Authorization')
  if (auth?.startsWith('Bearer ')) {
    sessionToken = auth.slice(7)

    try {
      const audience = readJwtAudience(sessionToken)
      if (!audience) return c.json({ error: 'Unauthorized: missing token audience' }, 401)
      shopifyApp = resolveShopifyAppByApiKey(getConfig(), audience)
      const result = verifySessionToken(sessionToken, shopifyApp.apiSecret, { audience: shopifyApp.apiKey })
      shop = result.shop
    } catch (error) {
      return c.json({ error: 'Unauthorized: ' + (error instanceof Error ? error.message : 'Invalid token') }, 401)
    }
  }

  if (!shop) {
    return c.json({ error: 'Unauthorized: missing session token' }, 401)
  }

  if (!shopifyApp) {
    return c.json({ error: 'Unauthorized: missing Shopify app' }, 401)
  }

  if (sessionToken) {
    try { await ensureInstallation(shopifyApp, shop, sessionToken) } catch { /* non-blocking */ }
  }

  c.set('shop', shop)
  c.set('shopifyApp', shopifyApp.handle)
  await next()
  }
}

async function ensureInstallation(shopifyApp: ResolvedShopifyApp, shop: string, sessionToken: string) {
  const db = getDb()
  const [existing] = await db.select().from(installations)
    .where(and(eq(installations.appHandle, shopifyApp.handle), eq(installations.shop, shop)))
    .limit(1)

  if (existing?.accessToken) return

  if (!shopifyApp.apiKey || !shopifyApp.apiSecret) return

  try {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: shopifyApp.apiKey,
        client_secret: shopifyApp.apiSecret,
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: sessionToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
      }),
    })

    if (!response.ok) return

    const data = await response.json() as { access_token: string; scope: string }
    const accessToken = encryptString(data.access_token)

    await db.insert(installations)
      .values({ appHandle: shopifyApp.handle, shop, accessToken, scopes: data.scope })
      .onConflictDoUpdate({
        target: [installations.appHandle, installations.shop],
        set: { accessToken, scopes: data.scope, uninstalledAt: null },
      })

    getRuntimeLogger().info(`[openshop] Token exchange successful for ${shop}`)
  } catch { /* silent */ }
}

export function getShop(c: Context): string {
  return c.get('shop') as string
}

export function getShopifyApp(c: Context): string {
  return c.get('shopifyApp') as string
}
