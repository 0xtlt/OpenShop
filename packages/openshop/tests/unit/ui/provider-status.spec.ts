import { test } from '@japa/runner'
import { providerConnectionStatus } from '../../../src/ui/provider-status.ts'

test.group('provider connection status', () => {
  test('keeps an unsaved provider separate from a saved one that has not been checked', ({ assert }) => {
    assert.deepEqual(providerConnectionStatus({ configured: false, lastCheckOk: null }), {
      tone: 'warning',
      label: 'Not configured',
    })
    assert.deepEqual(providerConnectionStatus({ configured: true, lastCheckOk: null }), {
      tone: 'info',
      label: 'Configured',
    })
  })

  test('uses the last health check when the provider is configured', ({ assert }) => {
    assert.deepEqual(providerConnectionStatus({ configured: true, lastCheckOk: true }), {
      tone: 'success',
      label: 'Connected',
    })
    assert.deepEqual(providerConnectionStatus({ configured: true, lastCheckOk: false }), {
      tone: 'critical',
      label: 'Error',
    })
  })

  test('does not report a connection for missing required config', ({ assert }) => {
    assert.deepEqual(providerConnectionStatus({ configured: false, lastCheckOk: true }), {
      tone: 'warning',
      label: 'Not configured',
    })
  })
})
