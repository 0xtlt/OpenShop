import { test } from '@japa/runner'
import { providerConfigIsComplete } from '#server/provider-config'
import type { ProviderDefinition } from '#types'

function provider(fields: ProviderDefinition['ui']['fields']): ProviderDefinition {
  return { name: 'warehouse', ui: { fields }, methods: {} }
}

test.group('providerConfigIsComplete', () => {
  test('is incomplete when a required field is missing', ({ assert }) => {
    const definition = provider({
      endpoint: { type: 'text', label: 'Endpoint' },
      apiKey: { type: 'password', label: 'API key' },
    })

    assert.isFalse(providerConfigIsComplete(definition, {}))
    assert.isFalse(providerConfigIsComplete(definition, { endpoint: 'https://warehouse.test' }))
    assert.isFalse(providerConfigIsComplete(definition, { endpoint: 'https://warehouse.test', apiKey: '' }))
  })

  test('is complete when required values are saved, including secrets', ({ assert }) => {
    const definition = provider({
      endpoint: { type: 'text', label: 'Endpoint' },
      apiKey: { type: 'password', label: 'API key' },
      note: { type: 'text', label: 'Note', required: false },
      enabled: { type: 'checkbox', label: 'Enabled' },
      retries: { type: 'number', label: 'Retries' },
    })

    assert.isTrue(providerConfigIsComplete(definition, {
      endpoint: 'https://warehouse.test',
      apiKey: 'secret-1',
      enabled: false,
      retries: 0,
    }))
  })

  test('treats a provider with no required fields as configured', ({ assert }) => {
    assert.isTrue(providerConfigIsComplete(provider({}), {}))
    assert.isTrue(providerConfigIsComplete(provider({
      note: { type: 'text', label: 'Note', required: false },
    }), {}))
  })
})
