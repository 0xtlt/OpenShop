const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

export function normalizeShopDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const input = value.trim().toLowerCase()
  if (!input) return null

  let hostname: string
  try {
    const url = new URL(input.includes('://') ? input : `https://${input}`)
    hostname = url.hostname.toLowerCase()
  } catch {
    return null
  }

  return SHOP_DOMAIN_RE.test(hostname) ? hostname : null
}

/**
 * Returns `value` only when it is exactly `<name>.myshopify.com` in lowercase,
 * with no scheme, port, path, credentials, query or fragment. Unlike
 * `normalizeShopDomain`, nothing is trimmed, lowercased or parsed out of a URL:
 * an address built from the result can only reach that shop.
 */
export function strictShopDomain(value: unknown): string | null {
  return typeof value === 'string' && SHOP_DOMAIN_RE.test(value) ? value : null
}
