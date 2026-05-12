import { pgTable, text, boolean, integer, timestamp, json, uuid } from 'drizzle-orm/pg-core'

// ─── defineModel helper ─────────────────────────────────────────────

interface ModelOptions {
  /** Include a `shop` column with index (default: true) */
  shop?: boolean
  /** Include `createdAt` column (default: true) */
  createdAt?: boolean
  /** Include `updatedAt` column (default: true) */
  updatedAt?: boolean
}

/**
 * Define a model with auto-generated columns:
 * - `id` (uuid, primary key)
 * - `shop` (text, indexed) — unless `{ shop: false }`
 * - `createdAt` / `updatedAt` (timestamp, default now)
 */
export function defineModel<TName extends string>(
  tableName: TName,
  columns: Record<string, any>,
  options?: ModelOptions,
) {
  const includeShop = options?.shop !== false
  const includeCreatedAt = options?.createdAt !== false
  const includeUpdatedAt = options?.updatedAt !== false

  const base: Record<string, any> = {
    id: uuid('id').primaryKey().defaultRandom(),
  }

  if (includeShop) base.shop = text('shop').notNull()
  if (includeCreatedAt) base.createdAt = timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  if (includeUpdatedAt) base.updatedAt = timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()

  return pgTable(tableName, { ...base, ...columns })
}

// ─── Framework schema ───────────────────────────────────────────────

export const installations = pgTable('installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').unique().notNull(),
  accessToken: text('access_token'),
  scopes: text('scopes'),
  nonce: text('nonce'),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
  uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
})

export const flowRuns = pgTable('flow_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull(),
  flowName: text('flow_name').notNull(),
  status: text('status').default('pending').notNull(),
  input: json('input'),
  error: text('error'),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  parentRunId: text('parent_run_id'),
  attempts: integer('attempts').default(0).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }),
  workerId: text('worker_id'),
  retryPolicy: json('retry_policy'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const stepResults = pgTable('step_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  stepName: text('step_name').notNull(),
  status: text('status').default('pending').notNull(),
  output: json('output'),
  error: text('error'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  flowRunId: text('flow_run_id').notNull(),
})

export const providerConfigs = pgTable('provider_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull(),
  providerName: text('provider_name').notNull(),
  config: json('config').default({}),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastCheckOk: boolean('last_check_ok'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const cronOverrides = pgTable('cron_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull(),
  cronKey: text('cron_key').notNull(), // "flow:schedule"
  enabled: boolean('enabled').default(true).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const logs = pgTable('logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  flowRunId: text('flow_run_id'),
  level: text('level').default('info').notNull(),
  message: text('message'),
  payload: json('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Re-export drizzle column builders for devs using defineModel
export { text, integer, boolean, json, timestamp, uuid, pgTable, numeric } from 'drizzle-orm/pg-core'

// Re-export query operators (consumers must use these to avoid duplicate drizzle-orm instances with bun link)
export { eq, and, or, not, gt, gte, lt, lte, ne, inArray, sql, desc, asc } from 'drizzle-orm'
