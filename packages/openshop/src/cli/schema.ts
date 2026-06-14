import { dirname, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
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

type MigrationRunMode = 'strict' | 'adopt-existing-first'

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

export async function migrateProjectSchema(cwd: string, options?: { silent?: boolean; adoptExistingFirst?: boolean }) {
  const projectMigrationsFolder = resolveProjectMigrationsFolder(cwd)
  if (!projectMigrationsFolder) {
    if (!options?.silent) console.log('[openshop] No project migrations found')
    return
  }

  await migrateProjectMigrations(projectMigrationsFolder, {
    mode: options?.adoptExistingFirst ? 'adopt-existing-first' : 'strict',
    silent: options?.silent,
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

async function migrateProjectMigrations(folder: string, options: { mode: MigrationRunMode; silent?: boolean }): Promise<void> {
  await ensureMigrationsTable(PROJECT_MIGRATIONS_TABLE)
  const lastApplied = await lastAppliedCreatedAt(PROJECT_MIGRATIONS_TABLE)
  const migrations = readMigrationFiles({ migrationsFolder: folder })
    .filter((migration) => lastApplied == null || migration.folderMillis > lastApplied)

  for (const [index, migration] of migrations.entries()) {
    try {
      await runMigrationStatements(migration)
      await insertMigration(PROJECT_MIGRATIONS_TABLE, migration)
    } catch (error) {
      if (options.mode === 'adopt-existing-first' && index === 0 && isAlreadyExistsError(error)) {
        await insertMigration(PROJECT_MIGRATIONS_TABLE, migration)
        if (!options.silent) {
          const tag = migrationNameByCreatedAt(folder).get(migration.folderMillis) ?? String(migration.folderMillis)
          console.warn(`[openshop] Project migration already reflected in database, marking as applied: ${tag}`)
        }
        continue
      }
      throw error
    }
  }
}

async function runMigrationStatements(migration: MigrationMeta): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    for (const statement of migration.sql) {
      if (!statement.trim()) continue
      await tx.execute(sql.raw(statement))
    }
  })
}

function isAlreadyExistsError(error: unknown): boolean {
  const code = sqlErrorCode(error)
  if (code && ['42P06', '42P07', '42701', '42710'].includes(code)) return true

  const message = errorMessage(error).toLowerCase()
  return /\balready exists\b/.test(message)
}

function sqlErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string') return code
  const cause = (error as { cause?: unknown }).cause
  if (!cause || typeof cause !== 'object') return undefined
  const causeCode = (cause as { code?: unknown }).code
  return typeof causeCode === 'string' ? causeCode : undefined
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.message}\n${error.cause instanceof Error ? error.cause.message : ''}`
  return String(error)
}

export async function migrateSchema(cwd: string, options?: { silent?: boolean }) {
  const projectMigrationsFolder = resolveProjectMigrationsFolder(cwd)

  if (projectMigrationsFolder) {
    await migrateProjectMigrations(projectMigrationsFolder, {
      mode: 'adopt-existing-first',
      silent: options?.silent,
    })
  }

  await migrateFrameworkSchema(cwd, options)

  if (!options?.silent && projectMigrationsFolder) {
    console.log('[openshop] Framework and project migrations applied')
  }
}
