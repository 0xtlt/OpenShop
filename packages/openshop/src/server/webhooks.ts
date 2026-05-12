import { Hono } from 'hono'
import { verifyWebhookHmac } from '#server/hmac'
import type { OpenShopConfig } from '#types'

/**
 * Creates webhook routes from the config's webhook definitions.
 * Each webhook is mounted at POST /webhooks/:topic
 * Shopify sends the HMAC in the X-Shopify-Hmac-Sha256 header.
 */
export function createWebhookRoutes(getConfig: () => OpenShopConfig) {
  const webhooks = new Hono()
  const secret = process.env.SHOPIFY_API_SECRET ?? ''

  // Catch-all webhook handler — matches topic from header
  webhooks.post('/', async (c) => {
    const config = getConfig()
    const body = await c.req.text()
    const hmac = c.req.header('x-shopify-hmac-sha256') ?? ''
    const topic = c.req.header('x-shopify-topic') ?? ''
    const shop = c.req.header('x-shopify-shop-domain') ?? ''
    const apiVersion = c.req.header('x-shopify-api-version') ?? ''

    // Verify HMAC
    if (!secret) return c.json({ error: 'SHOPIFY_API_SECRET is not configured' }, 500)
    if (!verifyWebhookHmac(body, hmac, secret)) {
      return c.json({ error: 'Invalid webhook HMAC' }, 401)
    }

    // Normalize topic: Shopify sends "orders/create", config uses "ORDERS_CREATE"
    const normalizedTopic = topic.replace(/\//g, '_').toUpperCase()

    // Find matching handler
    const handler = config.webhooks?.[topic] ?? config.webhooks?.[normalizedTopic]

    if (!handler) {
      console.warn(`[openshop] No webhook handler for topic "${topic}"`)
      return c.json({ ok: true }) // Always return 200 to Shopify
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(body)
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    try {
      await handler.run({ topic, shop, payload, apiVersion })
    } catch (error) {
      console.error(`[openshop] Webhook handler error for "${topic}":`, error)
      // Still return 200 — don't let Shopify retry on handler errors
    }

    return c.json({ ok: true })
  })

  return webhooks
}
