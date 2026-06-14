import { desc, eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { logs } from '#db/schema'
import { applyContextExpansion, matchesLogFilters, parseLogQuery } from '#server/log-query'

type LogRow = typeof logs.$inferSelect
type LogResponseRow = LogRow & { _matched?: boolean }

interface RunLogOptions {
  query: string
  levelsParam: string
  includeContext: boolean
}

export async function getFilteredRunLogs(flowRunId: string, options: RunLogOptions): Promise<{ logs: LogResponseRow[]; total: number }> {
  const allLogs = await getDb().select().from(logs).where(eq(logs.flowRunId, flowRunId)).orderBy(desc(logs.createdAt))
  const activeLevels = new Set(options.levelsParam.split(',').filter(Boolean))
  let filtered = allLogs.filter((log) => activeLevels.has(log.level))
  const parsed = parseLogQuery(options.query)

  if (parsed.time.from || parsed.time.to) {
    filtered = filtered.filter((log) => {
      const time = new Date(log.createdAt).getTime()
      if (parsed.time.from && time < parsed.time.from.getTime()) return false
      if (parsed.time.to && time > parsed.time.to.getTime()) return false
      return true
    })
  }

  if (parsed.filters.length === 0) {
    return { logs: filtered, total: allLogs.length }
  }

  const matchedIds = new Set<string>()
  for (const log of filtered) {
    if (matchesLogFilters(log, parsed.filters)) matchedIds.add(log.id)
  }

  if (!options.includeContext) {
    return { logs: filtered.filter((log) => matchedIds.has(log.id)), total: allLogs.length }
  }

  const visibleIds = applyContextExpansion(filtered, matchedIds, parsed.context)
  return {
    logs: filtered
      .filter((log) => visibleIds.has(log.id))
      .map((log) => ({ ...log, _matched: matchedIds.has(log.id) })),
    total: allLogs.length,
  }
}

export function createLogExportResponse(runId: string, format: string, filtered: LogResponseRow[]): Response {
  const filename = `run-${runId}-logs.${format}`

  if (format === 'csv') {
    const header = 'id,level,message,payload,createdAt'
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
    const rows = filtered.map((log) =>
      [log.id, log.level, escape(log.message ?? ''), escape(JSON.stringify(log.payload ?? '')), log.createdAt.toISOString()].join(','),
    )
    const csv = [header, ...rows].join('\n')
    return new Response(csv, {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` },
    })
  }

  return new Response(JSON.stringify(filtered, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}
