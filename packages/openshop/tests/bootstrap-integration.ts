import { assert } from '@japa/assert'
import { configure, processCLIArgs, run } from '@japa/runner'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

// Set env before any imports
process.env.DATABASE_URL = 'postgresql://openshop:openshop@localhost:5432/openshop_test'
process.env.ENCRYPTION_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
process.env.SHOPIFY_API_KEY = 'test-app'
process.env.SHOPIFY_API_SECRET = 'test-secret'

// Push framework schema to test DB
const cwd = resolve(import.meta.dirname, '..')
const drizzleKit = resolve(cwd, 'node_modules/.bin/drizzle-kit')
const configPath = resolve(cwd, 'tests/drizzle.config.ts')
try {
  execFileSync(drizzleKit, ['push', `--config=${configPath}`, '--force'], { cwd, stdio: 'ignore', env: { ...process.env } })
} catch (e) {
  console.error('Failed to push schema — is PostgreSQL running?', e)
  process.exit(1)
}

import { shutdownDb } from './integration/helpers.js'

processCLIArgs(process.argv.splice(2))

configure({
  files: ['tests/integration/**/*.spec.ts'],
  plugins: [assert()],
  setup: [() => () => shutdownDb()],
})

run()
