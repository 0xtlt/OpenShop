import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

/**
 * Push database schema using drizzle-kit.
 * No codegen needed — Drizzle types are inferred from TypeScript.
 */
export function pushSchema(cwd: string, options?: { silent?: boolean }) {
  const configPath = resolve(cwd, 'drizzle.config.ts')
  if (!existsSync(configPath)) {
    console.warn('[openshop] No drizzle.config.ts found, skipping schema push')
    return
  }

  const bin = resolve(cwd, 'node_modules', '.bin', 'drizzle-kit')
  if (!existsSync(bin)) {
    console.warn('[openshop] drizzle-kit not found, skipping schema push')
    return
  }

  const result = spawnSync(bin, ['push', `--config=${configPath}`, '--force'], {
    cwd,
    encoding: 'utf8',
    env: process.env,
  })

  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  if (!options?.silent) {
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
  }

  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`[openshop] drizzle-kit push failed with exit code ${result.status}`)

  // drizzle-kit can print prompt errors while still exiting with code 0.
  if (/\bError:\s/.test(`${stdout}\n${stderr}`)) {
    throw new Error('[openshop] drizzle-kit push reported errors')
  }
}
