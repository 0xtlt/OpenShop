import { test } from '@japa/runner'
import { type } from 'arktype'
import { providerConfigIsComplete, providerFieldsForResponse } from '#server/provider-config'
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

test.group('providerFieldsForResponse', () => {
  test('returns the description of a field without its validator', ({ assert }) => {
    const definition = provider({
      apiKey: {
        type: 'password',
        label: 'API key',
        description: 'Found in your warehouse dashboard.',
        validate: type('string > 0'),
      },
    })

    const fields = providerFieldsForResponse(definition, { apiKey: 'secret-1' })

    assert.equal(fields.apiKey.description, 'Found in your warehouse dashboard.')
    assert.isTrue(fields.apiKey.hasValue)
    assert.notProperty(fields.apiKey, 'validate')
  })
})
