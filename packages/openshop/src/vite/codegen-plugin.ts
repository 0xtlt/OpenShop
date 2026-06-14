import { dirname } from 'node:path'
import { watch } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Plugin } from 'vite'
import { findConfig, findBin, findGeneratedFile, patchScalars, generateBridge } from './codegen-utils'

/**
 * Vite plugin that runs Shopify GraphQL codegen.
 * - On dev: runs codegen in watch mode alongside the dev server
 * - On build: runs codegen once before the build
 * - After codegen: generates a bridge file that types shopify.graphql() calls
 */
export function openshopCodegen(): Plugin {
  let codegenProcess: ChildProcess | null = null

  function cleanup() {
    if (codegenProcess) {
      codegenProcess.kill()
      codegenProcess = null
    }
  }

  return {
    name: 'openshop-codegen',

    configureServer(server) {
      server.httpServer?.on('close', cleanup)
      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)
    },

    async configResolved(config) {
      const cwd = process.cwd()
      const configPath = findConfig(cwd)
      const binPath = findBin(cwd)

      if (!configPath || !binPath) return

      if (config.command === 'serve') {
        console.log('[openshop] Starting GraphQL codegen watcher...')
        codegenProcess = spawn(binPath, ['--config', configPath, '--watch'], {
          cwd,
          stdio: ['ignore', 'inherit', 'inherit'],
        })

        // Watch for codegen output changes to regenerate bridge + patch scalars
        const generatedPath = findGeneratedFile(cwd)
        if (generatedPath) {
          watch(dirname(generatedPath), (_, filename) => {
            if (filename?.endsWith('.types.d.ts')) patchScalars(cwd)
            if (filename?.endsWith('.generated.d.ts')) generateBridge(cwd)
          })
        }

        // Post-process on startup (codegen output may already exist)
        patchScalars(cwd)
        generateBridge(cwd)
      } else {
        console.log('[openshop] Running GraphQL codegen...')
        const exitCode = await new Promise<number>((resolve) => {
          const proc = spawn(binPath, ['--config', configPath], {
            cwd,
            stdio: ['ignore', 'inherit', 'inherit'],
          })
          proc.on('close', (code) => resolve(code ?? 1))
        })
        if (exitCode !== 0) {
          throw new Error(`[openshop] Codegen failed (exit ${exitCode})`)
        }
        patchScalars(cwd)
        generateBridge(cwd)
        console.log('[openshop] Types generated.')
      }
    },

    closeBundle() {
      cleanup()
    },
  }
}
