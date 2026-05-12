import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import { verifyQueryHmac, verifyWebhookHmac } from '#server/hmac'
import { normalizeShopDomain } from '#server/shop-domain'

function readScopesFromToml(cwd: string): string {
  const files = [
    ...(() => {
      try {
        return readdirSync(cwd).filter((f: string) => f.match(/^shopify\.app\..+\.toml$/) && f !== 'shopify.app.toml')
      } catch { return [] }
    })(),
    'shopify.app.toml',
  ]

  for (const file of files) {
    const path = resolve(cwd, file)
    if (!existsSync(path)) continue
    const content = readFileSync(path, 'utf-8')
    const match = content.match(/scopes\s*=\s*"([^"]*)"/)
    if (match) return match[1]
  }
  return ''
}

export function createAuthRoutes() {
  const auth = new Hono()
  const apiKey = process.env.SHOPIFY_API_KEY ?? ''
  const apiSecret = process.env.SHOPIFY_API_SECRET ?? ''
  const host = process.env.HOST ?? process.env.SHOPIFY_APP_URL ?? ''
  const scopes = readScopesFromToml(process.cwd())

  auth.get('/', async (c) => {
    const rawShop = c.req.query('shop')
    if (!rawShop) return c.json({ error: 'Missing shop parameter' }, 400)
    const shop = normalizeShopDomain(rawShop)
    if (!shop) return c.json({ error: 'Invalid shop parameter' }, 400)

    const db = getDb()
    const nonce = randomBytes(16).toString('hex')

    await db.insert(installations)
      .values({ shop, nonce })
      .onConflictDoUpdate({ target: installations.shop, set: { nonce } })

    const redirectUri = `${host}/auth/callback`
    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}`
    return c.redirect(authUrl)
  })

  auth.get('/callback', async (c) => {
    if (!apiSecret) return c.json({ error: 'SHOPIFY_API_SECRET not configured' }, 500)

    const query = c.req.query() as Record<string, string>
    const { shop: rawShop, code, state } = query

    if (!rawShop || !code || !state) return c.json({ error: 'Missing required parameters' }, 400)
    const shop = normalizeShopDomain(rawShop)
    if (!shop) return c.json({ error: 'Invalid shop parameter' }, 400)
    if (!verifyQueryHmac(query, apiSecret)) return c.json({ error: 'Invalid HMAC' }, 401)

    const db = getDb()
    const [installation] = await db.select().from(installations).where(eq(installations.shop, shop)).limit(1)
    if (!installation || installation.nonce !== state) return c.json({ error: 'Invalid state/nonce' }, 401)

    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
    })

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text()
      return c.json({ error: `Token exchange failed: ${text}` }, 500)
    }

    const tokenData = await tokenResponse.json() as { access_token: string; scope: string }

    await db.update(installations)
      .set({ accessToken: tokenData.access_token, scopes: tokenData.scope, nonce: null, installedAt: new Date(), uninstalledAt: null })
      .where(eq(installations.id, installation.id))

    return c.redirect(`https://${shop}/admin/apps/${apiKey}`)
  })

  auth.post('/webhooks/app-uninstalled', async (c) => {
    if (!apiSecret) return c.json({ error: 'SHOPIFY_API_SECRET not configured' }, 500)

    const body = await c.req.text()
    const hmac = c.req.header('x-shopify-hmac-sha256') ?? ''
    if (!verifyWebhookHmac(body, hmac, apiSecret)) return c.json({ error: 'Invalid webhook HMAC' }, 401)

    const data = JSON.parse(body)
    const shopDomain = normalizeShopDomain(c.req.header('x-shopify-shop-domain') ?? data.myshopify_domain ?? '')

    if (shopDomain) {
      const db = getDb()
      await db.update(installations)
        .set({ uninstalledAt: new Date(), accessToken: null })
        .where(eq(installations.shop, shopDomain))
    }

    return c.json({ ok: true })
  })

  return auth
}
