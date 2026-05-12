import { defineProvider } from 'openshop'
import { type } from 'arktype'

export const ftp = defineProvider({
  name: 'ftp',

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
        placeholder: 'wh_live_...',
        validate: type('string > 0'),
      },
      batchSize: {
        type: 'number' as const,
        label: 'Batch Size',
        placeholder: '100',
        validate: type('1 <= number <= 1000'),
      },
    },
  },

  async checker({ config }) {
    if (!config.apiUrl) return false
    console.log(`[warehouse] Checking connection to ${config.apiUrl}...`)
    return true
  },

  methods: {
    async push(config, data: string[]) {
      console.log(`[warehouse] Pushing ${data.length} records to ${config.apiUrl ?? 'unconfigured'}`)
    },
    async delete(config, data: string) {
      console.log(`[warehouse] Deleting ${data} from ${config.apiUrl ?? 'unconfigured'}`)
    },
  },
})
