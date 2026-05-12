import { assert } from '@japa/assert'
import { configure, processCLIArgs, run } from '@japa/runner'

// Set encryption key before any crypto imports
process.env.ENCRYPTION_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
process.env.SHOPIFY_API_KEY = 'test-app'

processCLIArgs(process.argv.splice(2))

configure({
  files: ['tests/unit/**/*.spec.ts'],
  plugins: [assert()],
})

run()
