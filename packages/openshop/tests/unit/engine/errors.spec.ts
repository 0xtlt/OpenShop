import { test } from '@japa/runner'
import {
  FlowCanceledError,
  StepTimeoutError,
  FlowTimeoutError,
  FlowConcurrencyError,
  SleepSignal,
} from '#engine/errors'

test.group('errors', () => {
  test('FlowCanceledError', ({ assert }) => {
    const err = new FlowCanceledError()
    assert.instanceOf(err, Error)
    assert.equal(err.name, 'FlowCanceledError')
    assert.equal(err.message, 'Flow was canceled')
  })

  test('StepTimeoutError', ({ assert }) => {
    const err = new StepTimeoutError('fetchData', 5000)
    assert.instanceOf(err, Error)
    assert.equal(err.name, 'StepTimeoutError')
    assert.equal(err.stepName, 'fetchData')
    assert.equal(err.timeoutMs, 5000)
    assert.include(err.message, 'fetchData')
    assert.include(err.message, '5000')
  })

  test('FlowTimeoutError', ({ assert }) => {
    const err = new FlowTimeoutError('syncOrders', 60000)
    assert.instanceOf(err, Error)
    assert.equal(err.name, 'FlowTimeoutError')
    assert.equal(err.flowName, 'syncOrders')
    assert.equal(err.timeoutMs, 60000)
  })

  test('FlowConcurrencyError', ({ assert }) => {
    const err = new FlowConcurrencyError('sync', 'test.myshopify.com', 'uuid-123')
    assert.instanceOf(err, Error)
    assert.equal(err.name, 'FlowConcurrencyError')
    assert.equal(err.flowName, 'sync')
    assert.equal(err.shop, 'test.myshopify.com')
    assert.equal(err.existingRunId, 'uuid-123')
  })

  test('SleepSignal', ({ assert }) => {
    const date = new Date('2026-06-01T00:00:00Z')
    const err = new SleepSignal(date)
    assert.instanceOf(err, Error)
    assert.equal(err.name, 'SleepSignal')
    assert.equal(err.resumeAt.toISOString(), date.toISOString())
    assert.include(err.message, '2026-06-01')
  })
})
