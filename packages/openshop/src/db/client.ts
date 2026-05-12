import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as frameworkSchema from './schema.js'

export type DbSchema = typeof frameworkSchema & Record<string, unknown>
export type Database = NodePgDatabase<DbSchema>

let _db: Database | null = null
let _pool: pg.Pool | null = null

export function getDb(): Database {
  if (_db) return _db

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('[openshop] DATABASE_URL not set')

  _pool = new pg.Pool({ connectionString: url })
  _db = drizzle(_pool, { schema: frameworkSchema })

  return _db
}

export function getPool(): pg.Pool {
  if (!_pool) getDb()
  return _pool!
}

/** Initialize DB with custom schema (dev models merged in) */
export function initDb(schema: DbSchema): Database {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('[openshop] DATABASE_URL not set')

  _pool = new pg.Pool({ connectionString: url })
  _db = drizzle(_pool, { schema })

  return _db
}
