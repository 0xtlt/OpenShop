import { test } from '@japa/runner'
import { FlowCanceledError, FlowConcurrencyError, SleepSignal } from '../../../src/engine/errors.ts'
import {
  captureException,
  resetSentryReporter,
  setExceptionReporter,
  shouldIgnoreException,
  type ExceptionContext,
} from '../../../src/sentry/reporter.ts'

test.group('sentry reporter', (group) => {
  group.each.teardown(() => resetSentryReporter())

  test('ignores flow cancellation, sleep signals, and concurrency rejects', ({ assert }) => {
    assert.isTrue(shouldIgnoreException(new FlowCanceledError()))
    assert.isTrue(shouldIgnoreException(new SleepSignal(new Date())))
    assert.isTrue(shouldIgnoreException(new FlowConcurrencyError('sync', 'demo.myshopify.com', 'run-1')))
    assert.isFalse(shouldIgnoreException(new Error('boom')))
  })

  test('forwards unexpected errors to the reporter', ({ assert }) => {
    const captured: Array<{ error: unknown; context: ExceptionContext }> = []
    setExceptionReporter({
      captureException(error, context) {
        captured.push({ error, context })
      },
    })

    captureException(new Error('boom'), { mechanism: 'flow', flow: 'syncOrders', shop: 'demo.myshopify.com' })
    captureException(new FlowCanceledError(), { mechanism: 'flow', flow: 'syncOrders' })

    assert.lengthOf(captured, 1)
    assert.equal((captured[0]!.error as Error).message, 'boom')
    assert.equal(captured[0]!.context.flow, 'syncOrders')
  })

  test('wraps non-Error throws', ({ assert }) => {
    const captured: unknown[] = []
    setExceptionReporter({
      captureException(error) {
        captured.push(error)
      },
    })

    captureException('nope', { mechanism: 'cli' })
    assert.instanceOf(captured[0], Error)
    assert.equal((captured[0] as Error).message, 'nope')
  })
})
