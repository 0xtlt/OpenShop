import { test } from '@japa/runner'
import { encryptConfig, decryptConfig, encryptString, decryptString } from '#server/crypto'

test.group('crypto', () => {
  test('encrypt returns encrypted envelope', ({ assert }) => {
    const result = encryptConfig({ apiKey: 'sk-123' })
    assert.equal((result as Record<string, unknown>).__encrypted, 'aes-256-gcm')
    assert.isString((result as Record<string, unknown>).payload)
  })

  test('encrypt + decrypt roundtrip', ({ assert }) => {
    const original = { apiKey: 'sk-123', secret: 'my-secret', nested: { foo: 'bar' } }
    const encrypted = encryptConfig(original)
    const decrypted = decryptConfig(encrypted)
    assert.deepEqual(decrypted, original)
  })

  test('two encryptions produce different payloads (random IV)', ({ assert }) => {
    const config = { key: 'value' }
    const a = encryptConfig(config) as Record<string, unknown>
    const b = encryptConfig(config) as Record<string, unknown>
    assert.notEqual(a.payload, b.payload)
  })

  test('tampered ciphertext throws on decrypt', ({ assert }) => {
    const encrypted = encryptConfig({ key: 'value' })
    const payload = (encrypted as Record<string, string>).payload
    const parts = payload.split(':')
    // Flip a character in the ciphertext
    parts[2] = parts[2].slice(0, -1) + (parts[2].at(-1) === '0' ? '1' : '0')
    ;(encrypted as Record<string, string>).payload = parts.join(':')
    assert.throws(() => decryptConfig(encrypted))
  })

  test('non-encrypted object passes through', ({ assert }) => {
    const plain = { foo: 'bar', num: 42 }
    const result = decryptConfig(plain)
    assert.deepEqual(result, plain)
  })

  test('null input returns empty object', ({ assert }) => {
    const result = decryptConfig(null)
    assert.deepEqual(result, {})
  })

  test('encryptString + decryptString roundtrip', ({ assert }) => {
    const encrypted = encryptString('offline-token')
    assert.notEqual(encrypted, 'offline-token')
    assert.isTrue(encrypted.startsWith('enc:aes-256-gcm:'))
    assert.equal(decryptString(encrypted), 'offline-token')
  })

  test('decryptString keeps legacy plaintext values', ({ assert }) => {
    assert.equal(decryptString('legacy-token'), 'legacy-token')
    assert.isNull(decryptString(null))
  })
})
