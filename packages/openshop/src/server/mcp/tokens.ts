import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const tokenPrefix = 'oshp_mcp_'
const hashPrefix = 'scrypt:'
const keyLength = 32

function randomTokenPart(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

export function createMcpToken(): { tokenId: string; token: string; tokenHash: string; tokenFingerprint: string } {
  const tokenId = `mtk_${randomTokenPart(12)}`
  return createMcpTokenForId(tokenId)
}

export function createMcpTokenForId(tokenId: string): { tokenId: string; token: string; tokenHash: string; tokenFingerprint: string } {
  const secret = randomTokenPart(32)
  const token = `${tokenPrefix}${tokenId}.${secret}`
  return {
    tokenId,
    token,
    tokenHash: hashMcpToken(token),
    tokenFingerprint: fingerprintMcpToken(token),
  }
}

export function parseMcpToken(value: string): { tokenId: string; token: string } | null {
  if (!value.startsWith(tokenPrefix)) return null
  const rest = value.slice(tokenPrefix.length)
  const dot = rest.indexOf('.')
  if (dot <= 0 || dot === rest.length - 1) return null
  const tokenId = rest.slice(0, dot)
  if (!/^mtk_[A-Za-z0-9_-]+$/.test(tokenId)) return null
  return { tokenId, token: value }
}

export function fingerprintMcpToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url').slice(0, 16)
}

export function hashMcpToken(token: string): string {
  const salt = randomTokenPart(16)
  const hash = scryptSync(token, salt, keyLength).toString('base64url')
  return `${hashPrefix}${salt}:${hash}`
}

export function verifyMcpToken(token: string, storedHash: string): boolean {
  if (!storedHash.startsWith(hashPrefix)) return false
  const payload = storedHash.slice(hashPrefix.length)
  const [salt, expected] = payload.split(':')
  if (!salt || !expected) return false

  const actualBuffer = scryptSync(token, salt, keyLength)
  const expectedBuffer = Buffer.from(expected, 'base64url')
  if (actualBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(actualBuffer, expectedBuffer)
}

export function extractBearerToken(header: string | undefined | null): string | null {
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}
