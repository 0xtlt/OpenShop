import { test } from '@japa/runner'
import { apiFetch } from '../../../src/ui/fetch.ts'

type TestGlobal = typeof globalThis & { window?: { shopify?: { idToken?: () => Promise<string> } } }

test.group('apiFetch', (group) => {
  const g = globalThis as TestGlobal
  let originalFetch: typeof globalThis.fetch
  let originalWindow: TestGlobal['window']
  let receivedInit: RequestInit | undefined

  group.each.setup(() => {
    originalFetch = globalThis.fetch
    originalWindow = g.window
    receivedInit = undefined
    globalThis.fetch = async (_input, init) => {
      receivedInit = init
      return new Response('ok')
    }

    return () => {
      globalThis.fetch = originalFetch
      if (originalWindow === undefined) delete g.window
      else g.window = originalWindow
    }
  })

  test('adds an App Bridge session token when available', async ({ assert }) => {
    g.window = { shopify: { idToken: async () => 'session-token' } }

    await apiFetch('/api/providers')

    const headers = new Headers(receivedInit?.headers)
    assert.equal(headers.get('Authorization'), 'Bearer session-token')
  })

  test('preserves existing request headers', async ({ assert }) => {
    g.window = { shopify: { idToken: async () => 'session-token' } }

    await apiFetch('/api/providers', { headers: { 'X-Test': 'kept' } })

    const headers = new Headers(receivedInit?.headers)
    assert.equal(headers.get('Authorization'), 'Bearer session-token')
    assert.equal(headers.get('X-Test'), 'kept')
  })

  test('continues without Authorization outside Shopify admin', async ({ assert }) => {
    g.window = {}

    await apiFetch('/api/providers')

    const headers = new Headers(receivedInit?.headers)
    assert.isFalse(headers.has('Authorization'))
  })

  test('continues without Authorization when token retrieval fails', async ({ assert }) => {
    g.window = {
      shopify: {
        idToken: async () => {
          throw new Error('not ready')
        },
      },
    }

    await apiFetch('/api/providers')

    const headers = new Headers(receivedInit?.headers)
    assert.isFalse(headers.has('Authorization'))
  })
})
