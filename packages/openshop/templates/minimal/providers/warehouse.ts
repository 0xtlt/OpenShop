import { type } from 'arktype'
import { defineProvider } from 'openshop'

export const warehouse = defineProvider({
  name: 'warehouse',

  ui: {
    fields: {
      apiUrl: {
        type: 'text' as const,
        label: 'API URL',
        placeholder: 'https://warehouse.example.com/api',
        validate: type('string.url'),
      },
      apiKey: {
        type: 'password' as const,
        label: 'API Key',
        validate: type('string > 0'),
      },
    },
  },

  async checker({ config }) {
    return Boolean(config.apiUrl && config.apiKey)
  },

  methods: {
    async push(config, data: Array<Record<string, unknown>>) {
      console.log(`[warehouse] Pushing ${data.length} records to ${config.apiUrl}`)
      return true
    },
  },
})
