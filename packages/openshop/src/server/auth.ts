import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import { normalizeShopDomain } from '#server/shop-domain'
import { encryptString } from '#server/crypto'
import { resolveShopifyAppByHandle, resolveShopifyAppBySignedQuery, resolveShopifyAppByWebhookHmac } from '#server/shopify-apps'
import type { OpenShopConfig } from '#types'

export function createAuthRoutes(getConfig: () => OpenShopConfig) {
  const auth = new Hono()

  auth.get('/', async (c) => {
    const rawShop = c.req.query('shop')
    if (!rawShop) return c.json({ error: 'Missing shop parameter' }, 400)
    const shop = normalizeShopDomain(rawShop)
    if (!shop) return c.json({ error: 'Invalid shop parameter' }, 400)
    let app
    try {
      app = resolveShopifyAppByHandle(getConfig(), c.req.query('app'))
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid Shopify app' }, 400)
    }

    const db = getDb()
    const nonce = randomBytes(16).toString('hex')

    await db.insert(installations)
      .values({ appHandle: app.handle, shop, nonce })
      .onConflictDoUpdate({ target: [installations.appHandle, installations.shop], set: { nonce } })

    const redirectUri = `${app.appUrl}/auth/callback`
    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${app.apiKey}&scope=${app.scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}`
    return c.redirect(authUrl)
  })

  auth.get('/callback', async (c) => {
    const query = c.req.query() as Record<string, string>
    const { shop: rawShop, code, state } = query

    if (!rawShop || !code || !state) return c.json({ error: 'Missing required parameters' }, 400)
    const shop = normalizeShopDomain(rawShop)
    if (!shop) return c.json({ error: 'Invalid shop parameter' }, 400)
    let app
    try {
      app = resolveShopifyAppBySignedQuery(getConfig(), query)
    } catch {
      return c.json({ error: 'Invalid HMAC' }, 401)
    }

    const db = getDb()
    const [installation] = await db.select().from(installations)
      .where(and(eq(installations.appHandle, app.handle), eq(installations.shop, shop)))
      .limit(1)
    if (!installation || installation.nonce !== state) return c.json({ error: 'Invalid state/nonce' }, 401)

    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: app.apiKey, client_secret: app.apiSecret, code }),
    })

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text()
      return c.json({ error: `Token exchange failed: ${text}` }, 500)
    }

    const tokenData = await tokenResponse.json() as { access_token: string; scope: string }

    await db.update(installations)
      .set({ accessToken: encryptString(tokenData.access_token), scopes: tokenData.scope, nonce: null, installedAt: new Date(), uninstalledAt: null })
      .where(eq(installations.id, installation.id))

    return c.redirect(`https://${shop}/admin/apps/${app.apiKey}`)
  })

  auth.post('/webhooks/app-uninstalled', async (c) => {
    const body = await c.req.text()
    const hmac = c.req.header('x-shopify-hmac-sha256') ?? ''
    let app
    try {
      app = resolveShopifyAppByWebhookHmac(getConfig(), body, hmac)
    } catch {
      return c.json({ error: 'Invalid webhook HMAC' }, 401)
    }

    const data = JSON.parse(body)
    const shopDomain = normalizeShopDomain(c.req.header('x-shopify-shop-domain') ?? data.myshopify_domain ?? '')

    if (shopDomain) {
      const db = getDb()
      await db.update(installations)
        .set({ uninstalledAt: new Date(), accessToken: null })
        .where(and(eq(installations.appHandle, app.handle), eq(installations.shop, shopDomain)))
    }

    return c.json({ ok: true })
  })

  return auth
}
