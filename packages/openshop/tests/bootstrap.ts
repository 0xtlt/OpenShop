import { assert } from '@japa/assert'
import { configure, processCLIArgs, run } from '@japa/runner'

// Set encryption key before any crypto imports
process.env.ENCRYPTION_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
process.env.SHOPIFY_API_KEY = 'test-app'

import { installNetworkGuard } from './network-guard.ts'

// Any request to a non-local address fails the run, even when the code under test swallows the error.
const networkGuard = installNetworkGuard()

processCLIArgs(process.argv.splice(2))

configure({
  files: ['tests/unit/**/*.spec.ts'],
  plugins: [assert()],
  setup: [
    () => () => networkGuard.report(),
  ],
})

run()
