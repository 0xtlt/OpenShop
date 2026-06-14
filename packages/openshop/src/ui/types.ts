import type { flowRuns, stepResults, logs, providerConfigs } from '../db/schema.ts'
import type { CronEntry, ProviderFieldDef } from '../types.ts'

// ─── Inferred from Drizzle schema ───────────────────────────────────

/** Row from flow_runs table (JSON-serialized: dates become strings) */
export type FlowRun = {
  [K in keyof typeof flowRuns.$inferSelect]: typeof flowRuns.$inferSelect[K] extends Date | null
    ? string | null
    : typeof flowRuns.$inferSelect[K] extends Date
      ? string
      : typeof flowRuns.$inferSelect[K]
}

/** Row from step_results table (JSON-serialized) */
export type StepResult = {
  [K in keyof typeof stepResults.$inferSelect]: typeof stepResults.$inferSelect[K] extends Date | null
    ? string | null
    : typeof stepResults.$inferSelect[K] extends Date
      ? string
      : typeof stepResults.$inferSelect[K]
}

/** Row from logs table (JSON-serialized) + optional _matched flag from search */
export type LogEntry = {
  [K in keyof typeof logs.$inferSelect]: typeof logs.$inferSelect[K] extends Date | null
    ? string | null
    : typeof logs.$inferSelect[K] extends Date
      ? string
      : typeof logs.$inferSelect[K]
} & { _matched?: boolean }

// ─── API response types (composed) ──────────────────────────────────

/** GET /api/flows response item */
export interface FlowSummary {
  name: string
  crons: Pick<CronEntry, 'schedule'>[]
  inputSchema: unknown
}

/** GET /api/runs/:id response */
export interface RunDetail extends FlowRun {
  steps: StepResult[]
}

/** GET /api/crons response item */
export interface CronItem extends CronEntry {
  index: number
  key: string
  enabled: boolean
}

/** GET /api/providers response item */
export type ProviderFieldSummary = Omit<ProviderFieldDef, 'validate'> & {
  hasValue?: boolean
}

export interface ProviderSummary {
  name: string
  fields: Record<string, ProviderFieldSummary>
  config: Record<string, unknown>
  lastCheckedAt: string | null
  lastCheckOk: boolean | null
}

// ─── Shared constants ───────────────────────────────────────────────

export type BannerTone = 'auto' | 'info' | 'success' | 'critical' | 'warning'
export type BadgeTone = BannerTone | 'neutral' | 'caution'

export const statusTone: Record<string, BadgeTone> = {
  completed: 'success',
  failed: 'critical',
  running: 'warning',
  pending: 'info',
  canceled: 'neutral',
  sleeping: 'info',
}
