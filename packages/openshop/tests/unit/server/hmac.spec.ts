import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { verifyQueryHmac, verifyWebhookHmac } from '#server/hmac'

const SECRET = 'test-hmac-secret'

function signQuery(params: Record<string, string>, secret = SECRET): Record<string, string> {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  const hmac = createHmac('sha256', secret).update(message).digest('hex')
  return { ...params, hmac }
}

function signBody(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64')
}

test.group('verifyQueryHmac', () => {
  test('valid signed query returns true', ({ assert }) => {
    const query = signQuery({ shop: 'test.myshopify.com', timestamp: '123456' })
    assert.isTrue(verifyQueryHmac(query, SECRET))
  })

  test('missing hmac returns false', ({ assert }) => {
    assert.isFalse(verifyQueryHmac({ shop: 'test.myshopify.com' }, SECRET))
  })

  test('wrong hmac returns false', ({ assert }) => {
    const query = signQuery({ shop: 'test.myshopify.com' })
    query.hmac = 'deadbeef'
    assert.isFalse(verifyQueryHmac(query, SECRET))
  })

  test('param order does not matter', ({ assert }) => {
    const query = signQuery({ z: '1', a: '2', m: '3' })
    assert.isTrue(verifyQueryHmac(query, SECRET))
  })
})

test.group('verifyWebhookHmac', () => {
  test('valid body hmac returns true', ({ assert }) => {
    const body = '{"id":123,"name":"order"}'
    const hmac = signBody(body)
    assert.isTrue(verifyWebhookHmac(body, hmac, SECRET))
  })

  test('wrong hmac returns false', ({ assert }) => {
    const body = '{"id":123}'
    assert.isFalse(verifyWebhookHmac(body, 'wrong-hmac', SECRET))
  })

  test('different body returns false', ({ assert }) => {
    const body = '{"id":123}'
    const hmac = signBody('{"id":456}')
    assert.isFalse(verifyWebhookHmac(body, hmac, SECRET))
  })
})
