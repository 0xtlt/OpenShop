import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pushSchema } from './schema.ts'

export async function runTests(args: string[]) {
  const cwd = process.cwd()
  const testEntry = resolve(cwd, 'tests', 'bootstrap.ts')

  if (!existsSync(testEntry)) {
    console.error('[openshop] tests/bootstrap.ts not found.')
    console.error('[openshop] Create a test bootstrap file to get started.')
    process.exit(1)
  }

  process.env.DATABASE_URL ??= 'postgresql://openshop:openshop@localhost:5432/openshop'

  try {
    pushSchema(cwd, { silent: true })
  } catch { /* already done */ }

  try {
    execFileSync(process.execPath, [testEntry, ...args], { cwd, stdio: 'inherit', env: process.env })
  } catch {
    process.exit(1)
  }
}
