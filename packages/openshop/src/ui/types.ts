import type { flowRuns, stepResults, logs, providerConfigs, mcpAuditLogs } from '../db/schema.ts'
import type { CronEntry, McpRiskLevel, ProviderFieldDef } from '../types.ts'

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

/** Row from mcp_audit_logs table (JSON-serialized) */
export type McpAuditLog = {
  [K in keyof typeof mcpAuditLogs.$inferSelect]: typeof mcpAuditLogs.$inferSelect[K] extends Date | null
    ? string | null
    : typeof mcpAuditLogs.$inferSelect[K] extends Date
      ? string
      : typeof mcpAuditLogs.$inferSelect[K]
}

export interface McpPermissionSummary {
  key: string
  label: string
  description?: string
  group: string
  riskLevel: McpRiskLevel
  source: 'core' | 'custom'
}

export interface McpCapabilitySummary {
  enabled: boolean
  permissions: Record<string, McpPermissionSummary>
  tools: Record<string, {
    name: string
    description: string
    inputSchema: unknown
    requiredPermissions: string[]
    riskLevel: McpRiskLevel
    confirmationHint: string | null
    source: 'core' | 'custom'
  }>
  resources: Record<string, {
    uri: string
    name: string
    description: string | null
    mimeType: string
    requiredPermissions: string[]
    riskLevel: McpRiskLevel
    source: 'core' | 'custom'
  }>
  defaultExpirationDays: number
  expirationOptions: Array<number | null>
}

export interface McpTokenSummary {
  id: string
  tokenId: string
  name: string
  tokenFingerprint: string
  status: 'active' | 'disabled' | 'revoked'
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
  permissions: string[]
  stalePermissions: string[]
  recentAudits?: McpAuditLog[]
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
