import type { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'
import { verifySessionToken } from '#server/jwt'
import { getDb } from '#db/client'
import { installations } from '#db/schema'

export async function shopMiddleware(c: Context, next: Next) {
  let shop: string | undefined
  let sessionToken: string | undefined
  const secret = process.env.SHOPIFY_API_SECRET
  const apiKey = process.env.SHOPIFY_API_KEY

  if (!secret) {
    return c.json({ error: 'SHOPIFY_API_SECRET is not configured' }, 500)
  }
  if (!apiKey) {
    return c.json({ error: 'SHOPIFY_API_KEY is not configured' }, 500)
  }

  const auth = c.req.header('Authorization')
  if (auth?.startsWith('Bearer ')) {
    sessionToken = auth.slice(7)

    try {
      const result = verifySessionToken(sessionToken, secret, { audience: apiKey })
      shop = result.shop
    } catch (error) {
      return c.json({ error: 'Unauthorized: ' + (error instanceof Error ? error.message : 'Invalid token') }, 401)
    }
  }

  if (!shop) {
    return c.json({ error: 'Unauthorized: missing session token' }, 401)
  }

  if (sessionToken) {
    try { await ensureInstallation(shop, sessionToken) } catch { /* non-blocking */ }
  }

  c.set('shop', shop)
  await next()
}

async function ensureInstallation(shop: string, sessionToken: string) {
  const db = getDb()
  const [existing] = await db.select().from(installations).where(eq(installations.shop, shop)).limit(1)

  if (existing?.accessToken) return

  const apiKey = process.env.SHOPIFY_API_KEY
  const apiSecret = process.env.SHOPIFY_API_SECRET
  if (!apiKey || !apiSecret) return

  try {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: sessionToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
      }),
    })

    if (!response.ok) return

    const data = await response.json() as { access_token: string; scope: string }

    if (existing) {
      await db.update(installations)
        .set({ accessToken: data.access_token, scopes: data.scope, uninstalledAt: null })
        .where(eq(installations.id, existing.id))
    } else {
      await db.insert(installations).values({ shop, accessToken: data.access_token, scopes: data.scope })
    }

    console.log(`[openshop] Token exchange successful for ${shop}`)
  } catch { /* silent */ }
}

export function getShop(c: Context): string {
  return c.get('shop') as string
}
