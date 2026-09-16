import { test } from '@japa/runner'
import { parseTracesSampleRate, resolveSentryEnvOptions } from '../../../src/sentry/options.ts'

test.group('sentry env options', () => {
  test('is disabled when DSN is missing', ({ assert }) => {
    const options = resolveSentryEnvOptions({ NODE_ENV: 'production' })
    assert.isUndefined(options.dsn)
    assert.isFalse(options.enabled)
    assert.equal(options.environment, 'production')
    assert.equal(options.tracesSampleRate, 0)
  })

  test('enables when DSN is set', ({ assert }) => {
    const options = resolveSentryEnvOptions({
      SENTRY_DSN: 'https://key@o0.ingest.sentry.io/1',
      SENTRY_ENVIRONMENT: 'staging',
      SENTRY_RELEASE: '1.2.3',
      SENTRY_TRACES_SAMPLE_RATE: '0.2',
    })
    assert.isTrue(options.enabled)
    assert.equal(options.environment, 'staging')
    assert.equal(options.release, '1.2.3')
    assert.equal(options.tracesSampleRate, 0.2)
  })

  test('SENTRY_ENABLED=false disables even with a DSN', ({ assert }) => {
    const options = resolveSentryEnvOptions({
      SENTRY_DSN: 'https://key@o0.ingest.sentry.io/1',
      SENTRY_ENABLED: 'false',
    })
    assert.isFalse(options.enabled)
  })

  test('clamps traces sample rate to 0..1', ({ assert }) => {
    assert.equal(parseTracesSampleRate(undefined), 0)
    assert.equal(parseTracesSampleRate(''), 0)
    assert.equal(parseTracesSampleRate('nope'), 0)
    assert.equal(parseTracesSampleRate('-1'), 0)
    assert.equal(parseTracesSampleRate('2'), 1)
    assert.equal(parseTracesSampleRate('0.5'), 0.5)
  })

  test('falls back to NODE_ENV then development', ({ assert }) => {
    assert.equal(resolveSentryEnvOptions({}).environment, 'development')
    assert.equal(resolveSentryEnvOptions({ NODE_ENV: 'test' }).environment, 'test')
  })
})
