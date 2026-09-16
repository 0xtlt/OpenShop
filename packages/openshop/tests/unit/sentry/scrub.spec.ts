import { test } from '@japa/runner'
import { redactUrl, scrubSentryEvent } from '../../../src/sentry/scrub.ts'

test.group('sentry scrubbing', () => {
  test('redacts session tokens and HMAC query params from URLs', ({ assert }) => {
    const redacted = redactUrl('https://app.example.com/api/runs?shop=demo.myshopify.com&id_token=secret.jwt&hmac=abc')
    assert.include(redacted, 'shop=demo.myshopify.com')
    assert.include(redacted, 'id_token=%5BFiltered%5D')
    assert.include(redacted, 'hmac=%5BFiltered%5D')
    assert.notInclude(redacted, 'secret.jwt')
  })

  test('redacts relative URLs without inventing a host', ({ assert }) => {
    const redacted = redactUrl('/auth/callback?code=oauth-code&shop=demo.myshopify.com')
    assert.equal(redacted.startsWith('/auth/callback'), true)
    assert.include(redacted, 'code=%5BFiltered%5D')
    assert.include(redacted, 'shop=demo.myshopify.com')
  })

  test('scrubs request URLs and query objects on Sentry events', ({ assert }) => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://app.example.com/proxy?signature=deadbeef&logged_in_customer_id=1',
        query_string: { signature: 'deadbeef', logged_in_customer_id: '1' },
      },
    })

    assert.include(event.request?.url ?? '', 'signature=%5BFiltered%5D')
    assert.equal(event.request?.query_string?.signature, '[Filtered]')
    assert.equal(event.request?.query_string?.logged_in_customer_id, '1')
  })
})
