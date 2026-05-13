import { dirname, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { getDb } from '#db/client'

const MIGRATIONS_SCHEMA = 'drizzle'
const FRAMEWORK_MIGRATIONS_TABLE = '__openshop_migrations'
const PROJECT_MIGRATIONS_TABLE = '__openshop_project_migrations'

type DrizzleJournal = {
  entries: Array<{
    idx: number
    when: number
    tag: string
    breakpoints: boolean
  }>
}

export type MigrationStatus = {
  folder: string | null
  applied: string[]
  pending: string[]
}

function hasDrizzleJournal(folder: string): boolean {
  return existsSync(resolve(folder, 'meta', '_journal.json'))
}

export function resolveFrameworkMigrationsFolder(cwd: string): string {
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

export function resolveProjectMigrationsFolder(cwd: string): string | null {
  const folder = resolve(cwd, 'drizzle')
  return hasDrizzleJournal(folder) ? folder : null
}

function readJournal(folder: string): DrizzleJournal {
  return JSON.parse(readFileSync(resolve(folder, 'meta', '_journal.json'), 'utf8')) as DrizzleJournal
}

function migrationNameByCreatedAt(folder: string): Map<number, string> {
  return new Map(readJournal(folder).entries.map((entry) => [entry.when, entry.tag]))
}

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows
  }
  return []
}

async function ensureMigrationsTable(table: string) {
  const db = getDb()
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}`)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(table)} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `)
}

async function lastAppliedCreatedAt(table: string): Promise<number | null> {
  const db = getDb()
  await ensureMigrationsTable(table)
  const result = await db.execute(sql<{ created_at: string | number | null }>`
    SELECT created_at
    FROM ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(table)}
    ORDER BY created_at DESC
    LIMIT 1
  `)
  const row = rowsFromResult<{ created_at: string | number | null }>(result)[0]
  if (row?.created_at == null) return null
  return Number(row.created_at)
}

async function getMigrationStatus(folder: string | null, table: string): Promise<MigrationStatus> {
  if (!folder) return { folder: null, applied: [], pending: [] }

  const lastApplied = await lastAppliedCreatedAt(table)
  const entries = readJournal(folder).entries
  const applied = entries.filter((entry) => lastApplied != null && entry.when <= lastApplied).map((entry) => entry.tag)
  const pending = entries.filter((entry) => lastApplied == null || entry.when > lastApplied).map((entry) => entry.tag)

  return { folder, applied, pending }
}

export async function getFrameworkMigrationStatus(cwd: string): Promise<MigrationStatus> {
  return getMigrationStatus(resolveFrameworkMigrationsFolder(cwd), FRAMEWORK_MIGRATIONS_TABLE)
}

export async function getProjectMigrationStatus(cwd: string): Promise<MigrationStatus> {
  return getMigrationStatus(resolveProjectMigrationsFolder(cwd), PROJECT_MIGRATIONS_TABLE)
}

export async function warnAboutPendingProjectMigrations(cwd: string): Promise<void> {
  const status = await getProjectMigrationStatus(cwd)
  if (status.pending.length === 0) return

  console.warn(`[openshop] ${status.pending.length} project migration(s) pending: ${status.pending.join(', ')}`)
  console.warn('[openshop] Run `openshop migrate project` to apply project migrations.')
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

export async function migrateFrameworkSchema(cwd: string, options?: { silent?: boolean }) {
  await migrate(getDb(), {
    migrationsFolder: resolveFrameworkMigrationsFolder(cwd),
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: FRAMEWORK_MIGRATIONS_TABLE,
  })

  if (!options?.silent) {
    console.log('[openshop] Framework migrations applied')
  }
}

export async function migrateProjectSchema(cwd: string, options?: { silent?: boolean }) {
  const projectMigrationsFolder = resolveProjectMigrationsFolder(cwd)
  if (!projectMigrationsFolder) {
    if (!options?.silent) console.log('[openshop] No project migrations found')
    return
  }

  await migrate(getDb(), {
    migrationsFolder: projectMigrationsFolder,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: PROJECT_MIGRATIONS_TABLE,
  })

  if (!options?.silent) {
    console.log('[openshop] Project migrations applied')
  }
}

export async function baselineProjectMigrations(cwd: string, options?: { to?: string; silent?: boolean }) {
  const projectMigrationsFolder = resolveProjectMigrationsFolder(cwd)
  if (!projectMigrationsFolder) {
    if (!options?.silent) console.log('[openshop] No project migrations found')
    return
  }

  const migrations = readMigrationFiles({ migrationsFolder: projectMigrationsFolder })
  if (migrations.length === 0) {
    if (!options?.silent) console.log('[openshop] No project migrations found')
    return
  }

  const namesByCreatedAt = migrationNameByCreatedAt(projectMigrationsFolder)
  const baselineTo = options?.to ?? namesByCreatedAt.get(migrations[0]!.folderMillis)
  const baselineIndex = migrations.findIndex((migration) => namesByCreatedAt.get(migration.folderMillis) === baselineTo)
  if (baselineIndex === -1) {
    throw new Error(`[openshop] Project migration not found: ${baselineTo}`)
  }

  await ensureMigrationsTable(PROJECT_MIGRATIONS_TABLE)
  const lastApplied = await lastAppliedCreatedAt(PROJECT_MIGRATIONS_TABLE)
  const migrationsToAdopt = migrations.slice(0, baselineIndex + 1)
    .filter((migration) => lastApplied == null || migration.folderMillis > lastApplied)

  for (const migration of migrationsToAdopt) {
    await insertMigration(PROJECT_MIGRATIONS_TABLE, migration)
  }

  if (!options?.silent) {
    const adopted = migrationsToAdopt.map((migration) => namesByCreatedAt.get(migration.folderMillis) ?? String(migration.folderMillis))
    console.log(adopted.length > 0
      ? `[openshop] Project migrations baselined: ${adopted.join(', ')}`
      : '[openshop] Project migrations already baselined')
  }
}

async function insertMigration(table: string, migration: MigrationMeta): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(table)} ("hash", "created_at")
    VALUES (${migration.hash}, ${migration.folderMillis})
  `)
}

export async function printMigrationStatus(cwd: string): Promise<void> {
  const [framework, project] = await Promise.all([
    getFrameworkMigrationStatus(cwd),
    getProjectMigrationStatus(cwd),
  ])

  printStatusGroup('Framework', framework)
  printStatusGroup('Project', project)
}

function printStatusGroup(label: string, status: MigrationStatus): void {
  console.log(`${label} migrations:`)
  if (!status.folder) {
    console.log('  folder: none')
    console.log('  applied: 0')
    console.log('  pending: 0')
    return
  }

  console.log(`  folder: ${status.folder}`)
  console.log(`  applied: ${status.applied.length}${status.applied.length ? ` (${status.applied.join(', ')})` : ''}`)
  console.log(`  pending: ${status.pending.length}${status.pending.length ? ` (${status.pending.join(', ')})` : ''}`)
}

export async function migrateSchema(cwd: string, options?: { silent?: boolean }) {
  await migrateFrameworkSchema(cwd, options)
}
