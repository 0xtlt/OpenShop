#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const builtCli = resolve(here, '../dist/cli.js')

function runNode(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' })
  if (result.error) {
    console.error(`[openshop] Failed to start Node.js CLI: ${result.error.message}`)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

if (existsSync(builtCli)) {
  runNode([builtCli, ...process.argv.slice(2)])
}

console.error('[openshop] Built CLI not found.')
console.error('[openshop] Run `pnpm --filter openshop run build:cli` before using the local CLI.')
process.exit(1)
