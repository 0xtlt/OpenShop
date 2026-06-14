import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { customerIdFromJwtSub, verifySessionToken } from '#server/jwt'

const SECRET = 'test-secret-key-for-jwt'
const AUDIENCE = 'app-id'

function createJwt(payload: Record<string, unknown>, secret = SECRET, headerData: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }): string {
  const header = Buffer.from(JSON.stringify(headerData)).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function verify(token: string) {
  return verifySessionToken(token, SECRET, { audience: AUDIENCE })
}

const now = Math.floor(Date.now() / 1000)

const validPayload = {
  iss: 'https://test.myshopify.com/admin',
  dest: 'https://test.myshopify.com',
  aud: AUDIENCE,
  sub: '12345',
  exp: now + 3600,
  nbf: now - 10,
  iat: now,
  jti: 'jti-1',
  sid: 'sid-1',
}

test.group('jwt', () => {
  test('valid token returns shop and payload', ({ assert }) => {
    const token = createJwt(validPayload)
    const result = verify(token)
    assert.equal(result.shop, 'test.myshopify.com')
    assert.equal(result.payload.sub, '12345')
  })

  test('expired token throws', ({ assert }) => {
    const token = createJwt({ ...validPayload, exp: now - 3600 })
    assert.throws(() => verify(token), 'JWT expired')
  })

  test('not yet valid token throws', ({ assert }) => {
    const token = createJwt({ ...validPayload, nbf: now + 7200 })
    assert.throws(() => verify(token), 'JWT not yet valid')
  })

  test('nbf within 60s tolerance succeeds', ({ assert }) => {
    const token = createJwt({ ...validPayload, nbf: now + 30 })
    const result = verify(token)
    assert.equal(result.shop, 'test.myshopify.com')
  })

  test('wrong secret throws', ({ assert }) => {
    const token = createJwt(validPayload, 'wrong-secret')
    assert.throws(() => verify(token), 'Invalid JWT signature')
  })

  test('malformed token throws', ({ assert }) => {
    assert.throws(() => verify('not.a.jwt.at.all'), 'Invalid JWT format')
  })

  test('wrong audience throws', ({ assert }) => {
    const token = createJwt({ ...validPayload, aud: 'other-app' })
    assert.throws(() => verify(token), 'Invalid JWT audience')
  })

  test('wrong algorithm throws', ({ assert }) => {
    const token = createJwt(validPayload, SECRET, { alg: 'none', typ: 'JWT' })
    assert.throws(() => verify(token), 'Invalid JWT algorithm')
  })

  test('dest and iss mismatch throws', ({ assert }) => {
    const token = createJwt({ ...validPayload, iss: 'https://other.myshopify.com/admin' })
    assert.throws(() => verify(token), 'JWT dest/iss mismatch')
  })

  test('missing dest and iss throws', ({ assert }) => {
    const { dest: _d, iss: _i, ...rest } = validPayload
    const token = createJwt(rest)
    assert.throws(() => verify(token), 'JWT missing or invalid dest claim')
  })

  test('missing dest throws', ({ assert }) => {
    const { dest: _d2, ...rest } = validPayload
    const token = createJwt(rest)
    assert.throws(() => verify(token), 'JWT missing or invalid dest claim')
  })

  test('plain domain dest is accepted', ({ assert }) => {
    const token = createJwt({ ...validPayload, dest: 'test.myshopify.com' })
    const result = verify(token)
    assert.equal(result.shop, 'test.myshopify.com')
  })

  test('customer id is extracted only from customer gid sub', ({ assert }) => {
    assert.equal(customerIdFromJwtSub('gid://shopify/Customer/42'), '42')
    assert.isNull(customerIdFromJwtSub('12345'))
  })
})
