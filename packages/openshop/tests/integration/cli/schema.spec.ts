import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { test } from '@japa/runner'
import { getDb } from '#db/client'
import {
  getClientMigrationStatus,
  migrateSchema,
} from '../../../src/cli/schema.ts'

function createProjectWithMigrations(options?: { invalidFirstMigration?: boolean }): string {
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
  writeFileSync(resolve(drizzle, '0000_project_init.sql'), options?.invalidFirstMigration
    ? 'SELECT * FROM table_that_does_not_exist;'
    : `
CREATE TABLE openshop_project_migration_test (
  id integer PRIMARY KEY
);
`)
  writeFileSync(resolve(drizzle, '0001_project_next.sql'), `
ALTER TABLE openshop_project_migration_test ADD COLUMN IF NOT EXISTS name text;
`)
  return dir
}

test.group('client-owned schema migrations', (group) => {
  group.each.setup(async () => {
    await getDb().execute(sql`DROP TABLE IF EXISTS drizzle.__drizzle_migrations`)
    await getDb().execute(sql`DROP TABLE IF EXISTS openshop_project_migration_test`)
  })

  test('migrate fails when client migrations are missing', async ({ assert }) => {
    const dir = mkdtempSync(resolve(tmpdir(), 'openshop-migrations-empty-'))

    try {
      await assert.rejects(
        () => migrateSchema(dir, { silent: true }),
        /No client migrations found/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('migrate applies client migrations from ./drizzle', async ({ assert }) => {
    const dir = createProjectWithMigrations()

    try {
      await migrateSchema(dir, { silent: true })

      const status = await getClientMigrationStatus(dir)
      assert.deepEqual(status.applied, ['0000_project_init', '0001_project_next'])
      assert.deepEqual(status.pending, [])

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

  test('migrate does not load drizzle config or require generation tooling', async ({ assert }) => {
    const dir = createProjectWithMigrations()
    writeFileSync(resolve(dir, 'drizzle.config.ts'), 'throw new Error("migrate must not load drizzle.config.ts")\n')

    try {
      await migrateSchema(dir, { silent: true })

      const status = await getClientMigrationStatus(dir)
      assert.deepEqual(status.applied, ['0000_project_init', '0001_project_next'])
      assert.deepEqual(status.pending, [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('status reports pending client migrations before migrate', async ({ assert }) => {
    const dir = createProjectWithMigrations()

    try {
      const status = await getClientMigrationStatus(dir)
      assert.deepEqual(status.applied, [])
      assert.deepEqual(status.pending, ['0000_project_init', '0001_project_next'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('migrate fails on real migration errors', async ({ assert }) => {
    const dir = createProjectWithMigrations({ invalidFirstMigration: true })

    try {
      await assert.rejects(() => migrateSchema(dir, { silent: true }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
