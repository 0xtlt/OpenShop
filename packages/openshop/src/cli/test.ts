import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pushSchema } from './schema.js'

function resolveTsx(cwd: string): string | null {
  try {
    const require = createRequire(resolve(cwd, 'package.json'))
    return require.resolve('tsx')
  } catch {
    try {
      return createRequire(import.meta.url).resolve('tsx')
    } catch {
      return null
    }
  }
}

export async function runTests(args: string[]) {
  const cwd = process.cwd()
  const testEntry = resolve(cwd, 'tests', 'bootstrap.ts')

  if (!existsSync(testEntry)) {
    console.error('[openshop] tests/bootstrap.ts not found.')
    console.error('[openshop] Create a test bootstrap file to get started.')
    process.exit(1)
  }

  // Prisma setup — merges framework + dev schemas
  process.env.DATABASE_URL ??= 'postgresql://openshop:openshop@localhost:5432/openshop'

  try {
    pushSchema(cwd, { silent: true })
  } catch { /* already done */ }

  const tsx = resolveTsx(cwd)
  if (!tsx) {
    console.error('[openshop] tsx not found. Add it to your dev dependencies:')
    console.error('  npm install -D tsx')
    process.exit(1)
  }

  try {
    execFileSync(process.execPath, ['--import', tsx, testEntry, ...args], { cwd, stdio: 'inherit', env: process.env })
  } catch {
    process.exit(1)
  }
}
