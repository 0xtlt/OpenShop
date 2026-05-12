import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

let _key: Buffer | null = null
let _warned = false

function getKey(): Buffer | null {
  if (_key) return _key
  const hex = process.env.ENCRYPTION_KEY
  if (!hex) {
    if (!_warned) {
      _warned = true
      console.warn('[openshop] ENCRYPTION_KEY not set — provider credentials stored in plaintext')
    }
    return null
  }
  if (hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
  }
  _key = Buffer.from(hex, 'hex')
  return _key
}

interface EncryptedPayload {
  __encrypted: 'aes-256-gcm'
  payload: string // iv:tag:ciphertext (hex)
}

function isEncrypted(value: unknown): value is EncryptedPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).__encrypted === 'aes-256-gcm'
  )
}

/**
 * Encrypt a config object. Returns the encrypted envelope or the raw config if no key.
 */
export function encryptConfig(config: Record<string, unknown>): Record<string, string> {
  const key = getKey()
  if (!key) return JSON.parse(JSON.stringify(config))

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH })

  const plaintext = JSON.stringify(config)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    __encrypted: 'aes-256-gcm',
    payload: `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`,
  }
}

/**
 * Decrypt a config object. Handles both encrypted envelopes and legacy plaintext.
 */
export function decryptConfig(stored: unknown): Record<string, unknown> {
  if (!isEncrypted(stored)) {
    return (stored ?? {}) as Record<string, unknown>
  }

  const key = getKey()
  if (!key) {
    throw new Error('Cannot decrypt provider config: ENCRYPTION_KEY not set')
  }

  const [ivHex, tagHex, dataHex] = stored.payload.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const ciphertext = Buffer.from(dataHex, 'hex')

  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH })
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}
