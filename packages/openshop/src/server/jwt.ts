import { createHmac, timingSafeEqual } from 'node:crypto'
import { normalizeShopDomain } from '#server/shop-domain'

export interface JwtPayload {
  iss: string
  dest: string
  aud: string
  sub: string
  exp: number
  nbf: number
  iat: number
  jti: string
  sid: string
}

interface JwtHeader {
  alg: string
  typ?: string
}

export interface VerifySessionTokenOptions {
  audience?: string
}

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T
}

function isNumericDate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function customerIdFromJwtSub(sub: unknown): string | null {
  if (typeof sub !== 'string') return null
  const match = sub.match(/^gid:\/\/shopify\/Customer\/(\d+)$/)
  return match?.[1] ?? null
}

export function verifySessionToken(token: string, secret: string, options?: VerifySessionTokenOptions): { shop: string; payload: JwtPayload } {
  if (!secret) throw new Error('SHOPIFY_API_SECRET is not configured')

  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT format')

  const [header, payload, signature] = parts
  const decodedHeader = decodeJwtPart<JwtHeader>(header)
  if (decodedHeader.alg !== 'HS256') {
    throw new Error('Invalid JWT algorithm')
  }

  // Verify HS256 signature
  const expected = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url')

  const sigBuffer = Buffer.from(signature, 'base64url')
  const expBuffer = Buffer.from(expected, 'base64url')

  if (sigBuffer.length !== expBuffer.length || !timingSafeEqual(sigBuffer, expBuffer)) {
    throw new Error('Invalid JWT signature')
  }

  const decoded = decodeJwtPart<JwtPayload>(payload)

  const expectedAudience = options?.audience ?? process.env.SHOPIFY_API_KEY
  if (!expectedAudience) throw new Error('SHOPIFY_API_KEY is not configured')
  if (decoded.aud !== expectedAudience) throw new Error('Invalid JWT audience')

  // Check expiry
  const now = Math.floor(Date.now() / 1000)
  if (!isNumericDate(decoded.exp)) throw new Error('JWT missing exp claim')
  if (decoded.exp < now) {
    throw new Error('JWT expired')
  }
  if (!isNumericDate(decoded.nbf)) throw new Error('JWT missing nbf claim')
  if (decoded.nbf > now + 60) {
    throw new Error('JWT not yet valid')
  }

  const destShop = normalizeShopDomain(decoded.dest)
  if (!destShop) throw new Error('JWT missing or invalid dest claim')

  const issShop = normalizeShopDomain(decoded.iss)
  if (!issShop) throw new Error('JWT missing or invalid iss claim')
  if (destShop !== issShop) throw new Error('JWT dest/iss mismatch')

  return { shop: destShop, payload: decoded }
}
