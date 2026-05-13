import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { test } from '@japa/runner'
import { getDb } from '#db/client'
import {
  baselineProjectMigrations,
  getProjectMigrationStatus,
  migrateFrameworkSchema,
  migrateProjectSchema,
} from '../../../src/cli/schema.ts'

function createProjectWithMigrations(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'openshop-migrations-'))
  const drizzle = resolve(dir, 'drizzle')
  mkdirSync(resolve(drizzle, 'meta'), { recursive: true })
  writeFileSync(resolve(drizzle, 'meta', '_journal.json'), JSON.stringify({
    version: '7',
    dialect: 'postgresql',
    entries: [
      { idx: 0, version: '7', when: 9_990_000_000_000, tag: '0000_project_init', breakpoints: true },
      { idx: 1, version: '7', when: 9_990_000_000_001, tag: '0001_project_next', breakpoints: true },
    ],
  }, null, 2))
  writeFileSync(resolve(drizzle, '0000_project_init.sql'), `
CREATE TABLE IF NOT EXISTS openshop_project_migration_test (
  id integer PRIMARY KEY
);
`)
  writeFileSync(resolve(drizzle, '0001_project_next.sql'), `
ALTER TABLE openshop_project_migration_test ADD COLUMN IF NOT EXISTS name text;
`)
  return dir
}

test.group('schema migrations', (group) => {
  group.each.setup(async () => {
    await getDb().execute(sql`DROP TABLE IF EXISTS drizzle.__openshop_project_migrations`)
    await getDb().execute(sql`DROP TABLE IF EXISTS openshop_project_migration_test`)
  })

  test('framework migration does not apply project migrations', async ({ assert }) => {
    const dir = createProjectWithMigrations()

    try {
      await migrateFrameworkSchema(dir, { silent: true })

      const table = await getDb().execute(sql<{ to_regclass: string | null }>`
        SELECT to_regclass('public.openshop_project_migration_test')
      `)

      assert.isNull(table.rows[0]?.to_regclass ?? null)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('baseline adopts initial project migration and leaves later migrations pending', async ({ assert }) => {
    const dir = createProjectWithMigrations()

    try {
      await baselineProjectMigrations(dir, { silent: true })

      const statusAfterBaseline = await getProjectMigrationStatus(dir)
      assert.deepEqual(statusAfterBaseline.applied, ['0000_project_init'])
      assert.deepEqual(statusAfterBaseline.pending, ['0001_project_next'])

      await getDb().execute(sql`
        CREATE TABLE openshop_project_migration_test (
          id integer PRIMARY KEY
        )
      `)
      await migrateProjectSchema(dir, { silent: true })

      const columns = await getDb().execute(sql<{ column_name: string }>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'openshop_project_migration_test'
        ORDER BY column_name
      `)

      assert.deepEqual(columns.rows.map((row) => row.column_name), ['id', 'name'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
