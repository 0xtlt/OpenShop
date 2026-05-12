import { test } from '@japa/runner'
import { createApiShutdownHandler } from '../../../src/cli/api-lifecycle.ts'

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

test.group('api lifecycle', () => {
  test('notifies listener closure before waiting for worker drain', async ({ assert }) => {
    const events: string[] = []
    const workerStop = createDeferred()

    const server = {
      close(callback: (error?: Error | null) => void) {
        events.push('server-close')
        setTimeout(() => callback(), 0)
      },
      closeIdleConnections() {
        events.push('server-close-idle')
      },
      closeAllConnections() {
        events.push('server-close-all')
      },
    }

    const shutdown = createApiShutdownHandler({
      server: server as any,
      stopScheduler: () => {
        events.push('scheduler-stop')
      },
      stopWorker: async () => {
        events.push('worker-stop-start')
        await workerStop.promise
        events.push('worker-stop-end')
      },
      notifyListenerClosed: () => {
        events.push('listener-closed')
      },
    })

    const shutdownPromise = shutdown()
    await new Promise((r) => setTimeout(r, 10))

    assert.deepEqual(events, [
      'server-close',
      'server-close-idle',
      'server-close-all',
      'listener-closed',
      'scheduler-stop',
      'worker-stop-start',
    ])

    workerStop.resolve()
    await shutdownPromise

    assert.deepEqual(events, [
      'server-close',
      'server-close-idle',
      'server-close-all',
      'listener-closed',
      'scheduler-stop',
      'worker-stop-start',
      'worker-stop-end',
    ])
  })
})
