import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { getDb } from '#db/client'

function hasDrizzleJournal(folder: string): boolean {
  return existsSync(resolve(folder, 'meta', '_journal.json'))
}

function resolveFrameworkMigrationsFolder(cwd: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '..', 'drizzle'),
    resolve(here, '..', '..', 'drizzle'),
  ]

  try {
    const requireFromCwd = createRequire(resolve(cwd, 'package.json'))
    const drizzleEntry = requireFromCwd.resolve('openshop/drizzle')
    candidates.push(resolve(dirname(drizzleEntry), '..', '..', 'drizzle'))
  } catch { /* package may be running from source */ }

  const folder = candidates.find(hasDrizzleJournal)
  if (!folder) {
    throw new Error('[openshop] Framework migrations not found. Reinstall openshop or run from the package root.')
  }

  return folder
}

function resolveProjectMigrationsFolder(cwd: string): string | null {
  const folder = resolve(cwd, 'drizzle')
  return hasDrizzleJournal(folder) ? folder : null
}

/**
 * Push database schema using drizzle-kit.
 * No codegen needed — Drizzle types are inferred from TypeScript.
 */
export function pushSchema(cwd: string, options?: { silent?: boolean }) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[openshop] Refusing drizzle-kit push --force in production. Run `openshop migrate` before starting OpenShop.')
  }

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

export async function migrateSchema(cwd: string, options?: { silent?: boolean }) {
  await migrate(getDb(), {
    migrationsFolder: resolveFrameworkMigrationsFolder(cwd),
    migrationsSchema: 'drizzle',
    migrationsTable: '__openshop_migrations',
  })

  const projectMigrationsFolder = resolveProjectMigrationsFolder(cwd)
  if (projectMigrationsFolder) {
    await migrate(getDb(), {
      migrationsFolder: projectMigrationsFolder,
      migrationsSchema: 'drizzle',
      migrationsTable: '__openshop_project_migrations',
    })
  }

  if (!options?.silent) {
    console.log(projectMigrationsFolder
      ? '[openshop] Framework and project migrations applied'
      : '[openshop] Framework migrations applied')
  }
}
