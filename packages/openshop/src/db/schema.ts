import { pgTable, text, boolean, integer, timestamp, json, uuid, index, uniqueIndex } from 'drizzle-orm/pg-core'
import type { FlowRunStatus, LogLevel, StepStatus } from '../types.ts'

// ─── defineModel helper ─────────────────────────────────────────────

interface ModelOptions {
  /** Include a `shop` column with index (default: true) */
  shop?: boolean
  /** Include `createdAt` column (default: true) */
  createdAt?: boolean
  /** Include `updatedAt` column (default: true) */
  updatedAt?: boolean
  /** Define custom indexes/constraints for this model */
  indexes?: (table: any) => any[]
}

/**
 * Define a model with auto-generated columns:
 * - `id` (uuid, primary key)
 * - `shop` (text, indexed) — unless `{ shop: false }`
 * - `createdAt` / `updatedAt` (timestamp, default now)
 * - custom indexes via `options.indexes`
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

  return pgTable(tableName, { ...base, ...columns }, options?.indexes)
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
  status: text('status').$type<FlowRunStatus>().default('pending').notNull(),
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
}, (table) => [
  index('flow_runs_status_available_created_idx').on(table.status, table.availableAt, table.createdAt),
  index('flow_runs_shop_created_idx').on(table.shop, table.createdAt),
  index('flow_runs_shop_flow_status_idx').on(table.shop, table.flowName, table.status),
])

export const stepResults = pgTable('step_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  stepName: text('step_name').notNull(),
  attempt: integer('attempt').default(1).notNull(),
  status: text('status').$type<StepStatus>().default('pending').notNull(),
  output: json('output'),
  error: text('error'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  flowRunId: text('flow_run_id').notNull(),
}, (table) => [
  index('step_results_flow_run_idx').on(table.flowRunId),
  uniqueIndex('step_results_flow_run_step_attempt_unique').on(table.flowRunId, table.stepName, table.attempt),
])

export const providerConfigs = pgTable('provider_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull(),
  providerName: text('provider_name').notNull(),
  config: json('config').default({}),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastCheckOk: boolean('last_check_ok'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('provider_configs_shop_provider_unique').on(table.shop, table.providerName),
])

export const cronOverrides = pgTable('cron_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull(),
  cronKey: text('cron_key').notNull(), // "flow:schedule"
  enabled: boolean('enabled').default(true).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('cron_overrides_shop_cron_unique').on(table.shop, table.cronKey),
])

export const logs = pgTable('logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  flowRunId: text('flow_run_id'),
  level: text('level').$type<LogLevel>().default('info').notNull(),
  message: text('message'),
  payload: json('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('logs_flow_run_created_idx').on(table.flowRunId, table.createdAt),
])

// Re-export drizzle column builders for devs using defineModel
export { text, integer, boolean, json, timestamp, uuid, pgTable, numeric, index, uniqueIndex } from 'drizzle-orm/pg-core'

// Re-export query operators so consumers use the same drizzle-orm instance as OpenShop.
export { eq, and, or, not, gt, gte, lt, lte, ne, inArray, sql, desc, asc } from 'drizzle-orm'
