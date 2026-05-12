import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as frameworkSchema from './schema.ts'

export type DbSchema = typeof frameworkSchema & Record<string, unknown>
export type Database = NodePgDatabase<DbSchema>

let _db: Database | null = null
let _pool: pg.Pool | null = null

function poolOptions(url: string): pg.PoolConfig {
  return {
    connectionString: url,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.PGPOOL_CONNECTION_TIMEOUT_MS ?? 5_000),
  }
}

export function getDb(): Database {
  if (_db) return _db

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('[openshop] DATABASE_URL not set')

  _pool = new pg.Pool(poolOptions(url))
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

  if (_pool) void _pool.end()
  _pool = new pg.Pool(poolOptions(url))
  _db = drizzle(_pool, { schema })

  return _db
}

export async function closeDb(): Promise<void> {
  const pool = _pool
  _pool = null
  _db = null
  if (pool) await pool.end()
}
