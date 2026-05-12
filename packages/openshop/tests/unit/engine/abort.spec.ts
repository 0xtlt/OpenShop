import { test } from '@japa/runner'
import { registerAbort, cancelRun, cleanupAbort } from '#engine/abort'

test.group('abort', () => {
  test('registerAbort returns a non-aborted signal', ({ assert }) => {
    const signal = registerAbort('test-1')
    assert.instanceOf(signal, AbortSignal)
    assert.isFalse(signal.aborted)
    cleanupAbort('test-1')
  })

  test('cancelRun returns true and aborts the signal', ({ assert }) => {
    const signal = registerAbort('test-2')
    const result = cancelRun('test-2')
    assert.isTrue(result)
    assert.isTrue(signal.aborted)
  })

  test('cancelRun returns false for unknown run', ({ assert }) => {
    assert.isFalse(cancelRun('nonexistent'))
  })

  test('cleanupAbort makes subsequent cancel return false', ({ assert }) => {
    registerAbort('test-3')
    cleanupAbort('test-3')
    assert.isFalse(cancelRun('test-3'))
  })

  test('two runs are independent', ({ assert }) => {
    const signalA = registerAbort('run-a')
    const signalB = registerAbort('run-b')
    cancelRun('run-a')
    assert.isTrue(signalA.aborted)
    assert.isFalse(signalB.aborted)
    cleanupAbort('run-b')
  })

  test('double cleanup does not throw', ({ assert }) => {
    registerAbort('test-4')
    cleanupAbort('test-4')
    cleanupAbort('test-4') // should not throw
    assert.isFalse(cancelRun('test-4'))
  })
})
