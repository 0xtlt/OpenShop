import { test } from '@japa/runner'
import { Hono } from 'hono'
import {
  captureSentryException,
  flushSentry,
  initializeSentry,
  installSentryMiddleware,
} from '../../../src/runtime/sentry.ts'
import type { OpenShopConfig } from '../../../src/types.ts'

function config(sentry?: OpenShopConfig['sentry']): OpenShopConfig {
  return { providers: {}, flows: {}, sentry }
}

test.group('Sentry runtime', () => {
  test('stays inactive when omitted and captures configured backend errors', async ({ assert }) => {
    const disabledConfig = config()
    assert.isFalse(initializeSentry(disabledConfig))
    captureSentryException(disabledConfig, new Error('ignored'), { operation: 'flow' })
    assert.isTrue(await flushSentry(disabledConfig))

    const events: Array<Record<string, any>> = []
    const enabledConfig = config({
      dsn: 'https://public@example.com/1',
      tracesSampleRate: 0,
      beforeSend(event) {
        events.push(event)
        return null
      },
    })

    assert.isTrue(initializeSentry(enabledConfig))
    captureSentryException(enabledConfig, new Error('flow failed'), {
      operation: 'flow',
      tags: { flow: 'sync-orders', run_id: 'run-1', attempt: 2, will_retry: false },
      extra: { source: 'worker' },
    })

    const app = new Hono()
    assert.isTrue(installSentryMiddleware(app, enabledConfig))
    app.onError((error, c) => {
      c.error = error
      return c.text('Internal Server Error', 500)
    })
    app.get('/boom', () => {
      throw new Error('request failed')
    })

    const response = await app.request('/boom')
    assert.equal(response.status, 500)
    assert.isTrue(await flushSentry(enabledConfig))

    const flowEvent = events.find((event) =>
      event.exception?.values?.some((value: { value?: string }) => value.value === 'flow failed'),
    )
    assert.isDefined(flowEvent)
    assert.equal(flowEvent!.tags?.['openshop.operation'], 'flow')
    assert.equal(flowEvent!.tags?.['openshop.flow'], 'sync-orders')
    assert.equal(flowEvent!.tags?.['openshop.run_id'], 'run-1')
    assert.equal(flowEvent!.tags?.['openshop.attempt'], 2)
    assert.equal(flowEvent!.contexts?.openshop?.source, 'worker')

    const requestEvent = events.find((event) =>
      event.exception?.values?.some((value: { value?: string }) => value.value === 'request failed'),
    )
    assert.isDefined(requestEvent)
  })
})
