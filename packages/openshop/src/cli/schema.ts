import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { getDb } from '#db/client'

const MIGRATIONS_SCHEMA = 'drizzle'
const MIGRATIONS_TABLE = '__drizzle_migrations'

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

type DrizzleKitCommand = 'generate' | 'check'

function hasDrizzleJournal(folder: string): boolean {
  return existsSync(resolve(folder, 'meta', '_journal.json'))
}

export function resolveClientMigrationsFolder(cwd: string): string | null {
  const folder = resolve(cwd, 'drizzle')
  return hasDrizzleJournal(folder) ? folder : null
}

export function resolveClientDrizzleConfig(cwd: string): string {
  return resolve(cwd, 'drizzle.config.ts')
}

function readJournal(folder: string): DrizzleJournal {
  return JSON.parse(readFileSync(resolve(folder, 'meta', '_journal.json'), 'utf8')) as DrizzleJournal
}

function journalEntryCount(folder: string): number {
  return readJournal(folder).entries.length
}

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows
  }
  return []
}

async function ensureMigrationsTable() {
  const db = getDb()
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}`)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `)
}

async function lastAppliedCreatedAt(): Promise<number | null> {
  const db = getDb()
  await ensureMigrationsTable()
  const result = await db.execute(sql<{ created_at: string | number | null }>`
    SELECT created_at
    FROM ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}
    ORDER BY created_at DESC
    LIMIT 1
  `)
  const row = rowsFromResult<{ created_at: string | number | null }>(result)[0]
  if (row?.created_at == null) return null
  return Number(row.created_at)
}

export async function getClientMigrationStatus(cwd: string): Promise<MigrationStatus> {
  const folder = resolveClientMigrationsFolder(cwd)
  if (!folder) return { folder: null, applied: [], pending: [] }

  const lastApplied = await lastAppliedCreatedAt()
  const entries = readJournal(folder).entries
  const applied = entries.filter((entry) => lastApplied != null && entry.when <= lastApplied).map((entry) => entry.tag)
  const pending = entries.filter((entry) => lastApplied == null || entry.when > lastApplied).map((entry) => entry.tag)

  return { folder, applied, pending }
}

function drizzleKitBinName(): string {
  return process.platform === 'win32' ? 'drizzle-kit.cmd' : 'drizzle-kit'
}

function resolveDrizzleKitBin(cwd: string, options?: { allowBundled?: boolean }): string {
  const binName = drizzleKitBinName()
  const local = resolve(cwd, 'node_modules', '.bin', binName)
  if (existsSync(local)) return local

  if (options?.allowBundled) {
    const here = import.meta.dirname
    const candidates = [
      resolve(here, '..', 'node_modules', '.bin', binName),
      resolve(here, '..', '..', 'node_modules', '.bin', binName),
      resolve(here, '..', '..', '..', 'node_modules', '.bin', binName),
    ]
    const bundled = candidates.find((candidate) => existsSync(candidate))
    if (bundled) return bundled
  }

  throw new Error('[openshop] drizzle-kit not found. Run `pnpm install` in your OpenShop project before running migration commands.')
}

export function runDrizzleKit(
  cwd: string,
  command: DrizzleKitCommand,
  args: string[] = [],
  options?: { allowBundled?: boolean; silent?: boolean },
) {
  const bin = resolveDrizzleKitBin(cwd, { allowBundled: options?.allowBundled })
  const result = spawnSync(bin, [command, ...args], {
    cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: options?.silent ? 'pipe' : 'inherit',
  })

  if (result.status !== 0) {
    const detail = options?.silent
      ? `\n${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd()
      : ''
    throw new Error(`[openshop] drizzle-kit ${command} failed with exit code ${result.status}${detail ? `\n${detail}` : ''}`)
  }
}

export function generateClientMigrations(cwd: string, args: string[] = [], options?: { allowBundled?: boolean }) {
  const allowProduction = args.includes('--allow-generate-in-production')
  const filteredArgs = args.filter((arg) => arg !== '--allow-generate-in-production')

  if (process.env.NODE_ENV === 'production' && !allowProduction) {
    throw new Error('[openshop] Refusing to generate migrations in production. Generate migrations locally, commit them, then run `openshop migrate` during deploy.')
  }

  const configPath = resolveClientDrizzleConfig(cwd)
  const hasConfigArg = filteredArgs.some((arg) => arg === '--config' || arg.startsWith('--config='))
  if (!hasConfigArg && !existsSync(configPath)) {
    throw new Error('[openshop] drizzle.config.ts not found. Create one before generating migrations.')
  }

  runDrizzleKit(cwd, 'generate', [...(hasConfigArg ? [] : [`--config=${configPath}`]), ...filteredArgs], {
    allowBundled: options?.allowBundled,
  })
}

export function checkClientMigrations(cwd: string) {
  const configPath = resolveClientDrizzleConfig(cwd)
  if (!existsSync(configPath)) {
    throw new Error('[openshop] drizzle.config.ts not found. Create one before checking migrations.')
  }

  runDrizzleKit(cwd, 'check', [`--config=${configPath}`])

  const folder = resolveClientMigrationsFolder(cwd)
  if (folder) assertClientMigrationsCoverCurrentSchema(cwd, folder)
}

function assertClientMigrationsCoverCurrentSchema(cwd: string, folder: string) {
  const configPath = resolveClientDrizzleConfig(cwd)
  if (!existsSync(configPath)) return

  const tmp = mkdtempSync(resolve(tmpdir(), 'openshop-migration-check-'))
  const tmpMigrations = resolve(tmp, 'drizzle')
  const tmpConfig = resolve(tmp, 'drizzle.config.mjs')
  const before = journalEntryCount(folder)

  try {
    cpSync(folder, tmpMigrations, { recursive: true })
    writeFileSync(tmpConfig, [
      `import config from ${JSON.stringify(pathToFileURL(configPath).href)}`,
      `export default { ...config, out: ${JSON.stringify(tmpMigrations)} }`,
      '',
    ].join('\n'))
    runDrizzleKit(cwd, 'generate', [`--config=${tmpConfig}`], { allowBundled: true, silent: true })

    const after = journalEntryCount(tmpMigrations)
    if (after > before) {
      throw new Error('[openshop] The current Drizzle schema is not covered by ./drizzle migrations. Run `openshop migrate generate`, review and commit the generated SQL, then run `openshop migrate`.')
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export async function migrateSchema(cwd: string, options?: { silent?: boolean }) {
  const folder = resolveClientMigrationsFolder(cwd)
  if (!folder) {
    throw new Error('[openshop] No client migrations found in ./drizzle. Run `openshop migrate generate`, review the generated SQL, then run `openshop migrate`.')
  }

  const migrations = readMigrationFiles({ migrationsFolder: folder })
  if (migrations.length === 0) {
    throw new Error('[openshop] No migration files found in ./drizzle. Run `openshop migrate generate`, review the generated SQL, then run `openshop migrate`.')
  }

  await migrate(getDb(), {
    migrationsFolder: folder,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  })

  if (!options?.silent) {
    console.log('[openshop] Client migrations applied')
  }
}
