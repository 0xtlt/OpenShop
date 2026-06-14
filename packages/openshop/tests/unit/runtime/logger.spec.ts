import { test } from '@japa/runner'
import { getRuntimeLogger, setRuntimeLogger, type RuntimeLogger } from '../../../src/runtime/logger.ts'

test.group('runtime logger', () => {
  test('sets a runtime logger and returns the previous logger', ({ assert }) => {
    const original = getRuntimeLogger()
    const messages: string[] = []
    const customLogger: RuntimeLogger = {
      info: (message) => messages.push(`info:${message}`),
      warn: (message) => messages.push(`warn:${message}`),
      error: (message) => messages.push(`error:${message}`),
    }

    const previous = setRuntimeLogger(customLogger)

    try {
      assert.strictEqual(previous, original)
      getRuntimeLogger().info('hello')
      assert.deepEqual(messages, ['info:hello'])
    } finally {
      setRuntimeLogger(original)
    }
  })
})
