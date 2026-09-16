import { test } from '@japa/runner'
import {
  applySentryConfig,
  initOpenShopSentry,
  isOpenShopSentryEnabled,
  resetOpenShopSentryForTests,
  setSentrySdkLoader,
  type OpenShopSentrySdk,
} from '../../../src/sentry/init.ts'
import { captureException } from '../../../src/sentry/reporter.ts'

function fakeSdk(inits: unknown[]): OpenShopSentrySdk {
  const tags: Record<string, string> = {}
  return {
    init(options) {
      inits.push(options)
    },
    withScope(callback) {
      callback({
        setTag(key, value) {
          tags[key] = value
        },
        setContext() {},
      })
    },
    withIsolationScope(callback) {
      return callback()
    },
    captureException() {
      return 'event-id'
    },
    async flush() {
      return true
    },
    async close() {
      return true
    },
    getGlobalScope() {
      return {
        setTag(key, value) {
          tags[key] = value
        },
      }
    },
  }
}

test.group('sentry init', (group) => {
  const originalDsn = process.env.SENTRY_DSN

  group.each.setup(() => {
    resetOpenShopSentryForTests()
    delete process.env.SENTRY_DSN
  })

  group.each.teardown(() => {
    resetOpenShopSentryForTests()
    if (originalDsn === undefined) delete process.env.SENTRY_DSN
    else process.env.SENTRY_DSN = originalDsn
  })

  test('does not load the SDK without a DSN', async ({ assert }) => {
    let loaded = false
    setSentrySdkLoader(async () => {
      loaded = true
      return fakeSdk([])
    })

    assert.isFalse(await initOpenShopSentry({ process: 'web' }))
    assert.isFalse(loaded)
    assert.isFalse(isOpenShopSentryEnabled())
  })

  test('initializes the SDK from SENTRY_DSN', async ({ assert }) => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/1'
    const inits: Array<Record<string, unknown>> = []
    setSentrySdkLoader(async () => fakeSdk(inits))

    assert.isTrue(await initOpenShopSentry({ process: 'worker' }))
    assert.isTrue(isOpenShopSentryEnabled())
    assert.lengthOf(inits, 1)
    assert.equal(inits[0]!.dsn, 'https://key@o0.ingest.sentry.io/1')
    assert.equal((inits[0]!.initialScope as { tags: Record<string, string> }).tags['openshop.process'], 'worker')
    assert.equal(inits[0]!.sendDefaultPii, false)
    assert.equal(inits[0]!.tracesSampleRate, 0)
  })

  test('is idempotent', async ({ assert }) => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/1'
    const inits: unknown[] = []
    setSentrySdkLoader(async () => fakeSdk(inits))

    await initOpenShopSentry()
    await initOpenShopSentry()
    assert.lengthOf(inits, 1)
  })

  test('applySentryConfig sets tags after init', async ({ assert }) => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/1'
    const tags: Record<string, string> = {}
    setSentrySdkLoader(async () => {
      const sdk = fakeSdk([])
      sdk.getGlobalScope = () => ({
        setTag(key, value) {
          tags[key] = value
        },
      })
      return sdk
    })

    await initOpenShopSentry()
    applySentryConfig({ tags: { region: 'eu' } })
    assert.equal(tags.region, 'eu')
  })

  test('applySentryConfig enabled=false stops later captures', async ({ assert }) => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/1'
    let captured = 0
    setSentrySdkLoader(async () => {
      const sdk = fakeSdk([])
      sdk.captureException = () => {
        captured += 1
        return 'event-id'
      }
      return sdk
    })

    await initOpenShopSentry()
    captureException(new Error('before'), { mechanism: 'cli' })
    applySentryConfig({ enabled: false })
    captureException(new Error('after'), { mechanism: 'cli' })
    assert.equal(captured, 1)
  })
})
