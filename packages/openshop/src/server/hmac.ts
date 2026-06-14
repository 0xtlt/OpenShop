import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify Shopify OAuth callback HMAC.
 * Shopify signs the query string (excluding `hmac` param) with the app secret.
 */
export function verifyQueryHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, ...rest } = query
  if (!secret.trim()) return false
  if (!hmac) return false

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('&')

  const computed = createHmac('sha256', secret).update(message).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(hmac))
  } catch {
    return false
  }
}

/**
 * Verify Shopify webhook HMAC.
 * Shopify sends the HMAC in the X-Shopify-Hmac-Sha256 header.
 */
export function verifyWebhookHmac(body: string, hmac: string, secret: string): boolean {
  if (!secret.trim()) return false
  const computed = createHmac('sha256', secret).update(body, 'utf8').digest('base64')

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(hmac))
  } catch {
    return false
  }
}
