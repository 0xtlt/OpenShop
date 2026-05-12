import type { flowRuns, stepResults, logs, providerConfigs } from '../db/schema.js'
import type { CronEntry, ProviderFieldDef } from '../types.js'

/** Event type for Polaris web component input/change events */
export interface InputEvent extends Event {
  target: EventTarget & { value: string; checked?: boolean }
}

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
export interface ProviderSummary {
  name: string
  fields: Record<string, ProviderFieldDef>
  config: Record<string, unknown>
  lastCheckedAt: string | null
  lastCheckOk: boolean | null
}

// ─── Shared constants ───────────────────────────────────────────────

export const statusTone: Record<string, string> = {
  completed: 'success',
  failed: 'critical',
  running: 'warning',
  pending: 'info',
  canceled: 'neutral',
  sleeping: 'info',
}
