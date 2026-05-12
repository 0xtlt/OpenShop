// ─── Log query engine (Grafana-style) ────────────────────────────────

export interface LogFilter {
  op: 'contains' | 'excludes' | 'regex'
  value: string
}

const DURATION_UNITS: Record<string, number> = {
  s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000,
}

export interface ParsedLogQuery {
  filters: LogFilter[]
  time: { from?: Date; to?: Date }
  context: { before: number; after: number }
}

export function parseLogQuery(q: string): ParsedLogQuery {
  const filters: LogFilter[] = []
  const time: { from?: Date; to?: Date } = {}
  const context = { before: 0, after: 0 }
  let rest = q

  rest = rest.replace(/C:(\d+)/g, (_, n) => { const v = parseInt(n, 10); context.before = Math.max(context.before, v); context.after = Math.max(context.after, v); return '' })
  rest = rest.replace(/A:(\d+)/g, (_, n) => { context.after = Math.max(context.after, parseInt(n, 10)); return '' })
  rest = rest.replace(/B:(\d+)/g, (_, n) => { context.before = Math.max(context.before, parseInt(n, 10)); return '' })
  rest = rest.replace(/\|=\s*"([^"]*)"/g, (_, v) => { filters.push({ op: 'contains', value: v.toLowerCase() }); return '' })
  rest = rest.replace(/!=\s*"([^"]*)"/g, (_, v) => { filters.push({ op: 'excludes', value: v.toLowerCase() }); return '' })
  rest = rest.replace(/\|~\s*"([^"]*)"/g, (_, v) => { filters.push({ op: 'regex', value: v }); return '' })
  rest = rest.replace(/between:(\S+?),(\S+)/gi, (_, f, t) => { const df = new Date(f); const dt = new Date(t); if (!isNaN(df.getTime())) time.from = df; if (!isNaN(dt.getTime())) time.to = dt; return '' })
  rest = rest.replace(/last:(\d+)(s|m|h|d)/gi, (_, n, u) => { const ms = parseInt(n, 10) * (DURATION_UNITS[u.toLowerCase()] ?? 0); if (ms > 0) time.from = new Date(Date.now() - ms); return '' })
  rest = rest.replace(/from:(\S+)/gi, (_, v) => { const d = new Date(v); if (!isNaN(d.getTime())) time.from = d; return '' })
  rest = rest.replace(/to:(\S+)/gi, (_, v) => { const d = new Date(v); if (!isNaN(d.getTime())) time.to = d; return '' })

  rest = rest.trim()
  if (rest) filters.push({ op: 'contains', value: rest.toLowerCase() })
  return { filters, time, context }
}

export function logSearchText(log: { message: string | null; payload: unknown }): string {
  let text = log.message ?? ''
  if (log.payload && typeof log.payload === 'object' && !Array.isArray(log.payload)) {
    text += ' ' + Object.entries(log.payload as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`).join(' ')
  }
  return text.toLowerCase()
}

export function matchesLogFilters(log: { message: string | null; payload: unknown }, filters: LogFilter[]): boolean {
  const text = logSearchText(log)
  for (const f of filters) {
    if (f.op === 'contains' && !text.includes(f.value)) return false
    if (f.op === 'excludes' && text.includes(f.value)) return false
    if (f.op === 'regex') {
      if (f.value.length > 200) return false // Guard against ReDoS
      try { if (!new RegExp(f.value, 'i').test(text)) return false }
      catch { return false }
    }
  }
  return true
}

export function applyContextExpansion<T extends { id: string }>(items: T[], matchedIds: Set<string>, ctx: { before: number; after: number }): Set<string> {
  if (ctx.before === 0 && ctx.after === 0) return matchedIds
  const visible = new Set(matchedIds)
  for (let i = 0; i < items.length; i++) {
    if (!matchedIds.has(items[i].id)) continue
    for (let j = Math.max(0, i - ctx.before); j <= Math.min(items.length - 1, i + ctx.after); j++) {
      visible.add(items[j].id)
    }
  }
  return visible
}
