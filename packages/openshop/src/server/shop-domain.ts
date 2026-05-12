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
