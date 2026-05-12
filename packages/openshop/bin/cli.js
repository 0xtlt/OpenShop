#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const builtCli = resolve(here, '../dist/cli.js')
const sourceCli = resolve(here, 'cli.ts')
const command = process.argv[2]

function runNode(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' })
  if (result.error) {
    console.error(`[openshop] Failed to start Node.js CLI: ${result.error.message}`)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

function resolveLocalTsx() {
  try {
    const require = createRequire(resolve(process.cwd(), 'package.json'))
    return require.resolve('tsx')
  } catch {
    try {
      const require = createRequire(import.meta.url)
      return require.resolve('tsx')
    } catch {
      return null
    }
  }
}

if (existsSync(builtCli)) {
  const tsx = command === 'init' ? null : resolveLocalTsx()
  const args = tsx
    ? ['--import', tsx, builtCli, ...process.argv.slice(2)]
    : [builtCli, ...process.argv.slice(2)]
  runNode(args)
}

const tsx = resolveLocalTsx()
if (!tsx) {
  console.error('[openshop] Built CLI not found and tsx is unavailable.')
  console.error('[openshop] Run `npm run build:cli` in the openshop package, or install tsx for local development.')
  process.exit(1)
}

runNode(['--import', tsx, sourceCli, ...process.argv.slice(2)])
