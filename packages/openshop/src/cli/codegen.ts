import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { runCodegenOnce } from '../vite/codegen-utils'

/**
 * Run GraphQL codegen.
 */
export async function runCodegen(watch = false) {
  const cwd = process.cwd()
  if (!watch) {
    try {
      runCodegenOnce(cwd)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    }
    return
  }

  const configPath =
    existsSync(resolve(cwd, '.graphqlrc.ts')) ? resolve(cwd, '.graphqlrc.ts') :
    existsSync(resolve(cwd, 'codegen.ts')) ? resolve(cwd, 'codegen.ts') :
    null

  if (!configPath) {
    console.error('[openshop] No .graphqlrc.ts or codegen.ts found.')
    process.exit(1)
  }

  console.log(`[openshop] Running GraphQL codegen${watch ? ' (watch mode)' : ''}...`)

  const args = ['--config', configPath]
  if (watch) args.push('--watch')

  // Use locally installed CLI (not bunx) so plugins resolve from project node_modules
  const binPath = resolve(cwd, 'node_modules', '.bin', 'graphql-codegen')

  if (!existsSync(binPath)) {
    console.error('[openshop] @graphql-codegen/cli not found. Add it to your dependencies:')
    console.error('  pnpm add -D @graphql-codegen/cli @shopify/api-codegen-preset')
    process.exit(1)
  }

  const { spawn } = await import('node:child_process')

  const exitCode = await new Promise<number>((resolve) => {
    const proc = spawn(binPath, args, { cwd, stdio: 'inherit' })
    proc.on('close', (code) => resolve(code ?? 1))
  })

  if (exitCode !== 0) {
    console.error(`[openshop] Codegen failed (exit ${exitCode})`)
    process.exit(exitCode)
  }

  // Watch mode is post-processed by the Vite plugin file watcher.
}
