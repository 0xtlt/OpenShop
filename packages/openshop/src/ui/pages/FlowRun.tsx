import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { apiFetch } from '../fetch'
import { eventValue } from '../events'
import type { RunDetail, LogEntry } from '../types'
import { statusTone } from '../types'
import { LogsSection } from './flow-run/LogsSection'
import { OutputModal, StepRow, buildStepRows } from './flow-run/output'
import { RunActionModals } from './flow-run/RunActionModals'

export default function FlowRun({ id }: { id?: string }) {
  const { route } = useLocation()
  // Init state from URL search params
  const initParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  const [run, setRun] = useState<RunDetail | null>(null)
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([])
  const [totalLogs, setTotalLogs] = useState(0)
  const [query, setQuery] = useState(initParams.get('q') ?? '')
  const [levels, setLevels] = useState<Set<string>>(() => {
    const l = initParams.get('levels')
    return l ? new Set(l.split(',').filter(Boolean)) : new Set(['info', 'warn', 'error'])
  })
  const [showHelp, setShowHelp] = useState(false)
  const [levelCounts, setLevelCounts] = useState<Record<string, number>>({})
  const [newLogIds, setNewLogIds] = useState<Set<string>>(new Set())
  const knownLogIdsRef = useRef<Set<string>>(new Set())
  const initialLoadRef = useRef(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync state → URL search params (App Bridge auto-syncs via replaceState)
  const syncUrl = useCallback((q: string, lvls: Set<string>) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    const lvlStr = [...lvls].join(',')
    if (lvlStr !== 'info,warn,error') params.set('levels', lvlStr)
    const search = params.toString()
    const url = `${window.location.pathname}${search ? `?${search}` : ''}`
    history.replaceState(null, '', url)
  }, [])

  // Fetch run details (no logs)
  useEffect(() => {
    if (!id) return
    const load = async () => {
      const res = await apiFetch(`/api/runs/${id}`)
      if (res.ok) setRun(await res.json())
    }
    load()
    const iv = setInterval(load, 3000)
    return () => clearInterval(iv)
  }, [id])

  // Fetch logs with filters (server-side)
  const levelsKey = [...levels].sort().join(',')

  const fetchLogs = useCallback(async () => {
    if (!id) return
    // Fetch filtered logs
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    params.set('levels', levelsKey)
    const res = await apiFetch(`/api/runs/${id}/logs?${params}`)
    if (res.ok) {
      const data = await res.json()
      if (initialLoadRef.current) {
        for (const log of data.logs) knownLogIdsRef.current.add(log.id)
        initialLoadRef.current = false
      } else {
        const fresh = new Set<string>()
        for (const log of data.logs) {
          if (!knownLogIdsRef.current.has(log.id)) fresh.add(log.id)
          knownLogIdsRef.current.add(log.id)
        }
        if (fresh.size > 0) {
          setNewLogIds(fresh)
          setTimeout(() => setNewLogIds(new Set()), 5000)
        }
      }
      setFilteredLogs(data.logs)
      setTotalLogs(data.total)
    }
    // Fetch all logs once for level counts (same request cycle, no extra interval)
    const allRes = await apiFetch(`/api/runs/${id}/logs?levels=info,warn,error`)
    if (allRes.ok) {
      const allData = await allRes.json()
      const counts: Record<string, number> = { info: 0, warn: 0, error: 0 }
      for (const l of allData.logs) counts[l.level] = (counts[l.level] ?? 0) + 1
      setLevelCounts(counts)
    }
  }, [id, query, levelsKey])

  useEffect(() => {
    fetchLogs()
    const iv = setInterval(fetchLogs, 3000)
    return () => clearInterval(iv)
  }, [fetchLogs])


  const handleQueryInput = (event: Event) => {
    const val = eventValue(event)
    setQuery(val)
    syncUrl(val, levels)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchLogs(), 300)
  }

  const toggleLevel = (level: string) => {
    const next = new Set(levels)
    if (next.has(level)) next.delete(level)
    else next.add(level)
    setLevels(next)
    syncUrl(query, next)
  }

  const [retrying, setRetrying] = useState(false)

  const toast = (message: string) => window.shopify?.toast?.show(message)

  const retryRun = async (mode: 'resume' | 'reset') => {
    if (!id || retrying) return
    setRetrying(true)
    try {
      const res = await apiFetch(`/api/runs/${id}/retry?mode=${mode}`, { method: 'POST' })
      if (res.ok) {
        const updated = await apiFetch(`/api/runs/${id}`)
        if (updated.ok) setRun(await updated.json())
        toast(mode === 'reset' ? 'Run restarted' : 'Run resumed')
      } else {
        const data = await res.json().catch(() => null)
        toast(data?.error ?? 'Failed to retry run')
      }
    } finally {
      setRetrying(false)
    }
  }

  const deleteRun = async () => {
    if (!id) return
    const res = await apiFetch(`/api/runs/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast('Run deleted')
      route(`/flows/${run?.flowName}`)
    } else {
      const data = await res.json().catch(() => null)
      toast(data?.error ?? 'Failed to delete run')
    }
  }

  if (!run) {
    return <s-page heading="Run"><s-section><s-spinner /></s-section></s-page>
  }

  const dur = run.startedAt && run.completedAt
    ? `${((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
    : run.status === 'running' ? 'Running…' : '—'
  const stepRows = buildStepRows(run.steps)

  return (
    <>
    <OutputModal />
    <RunActionModals retrying={retrying} retryRun={retryRun} deleteRun={deleteRun} />

    <s-page heading={`Run #${run.id}`}>
      <s-link
        slot="breadcrumb-actions"
        href={`/flows/${run.flowName}`}
        onClick={(e: Event) => { e.preventDefault(); route(`/flows/${run.flowName}`) }}
      >
        {run.flowName}
      </s-link>
      {['failed', 'completed', 'canceled'].includes(run.status) && (
        <>
          <s-button slot="secondary-actions" variant="secondary" commandFor="delete-modal" command="--show" tone="critical">
            Delete
          </s-button>
          <s-button slot="primary-action" variant="primary" disabled={retrying} commandFor="retry-modal" command="--show">
            Retry
          </s-button>
        </>
      )}

      {run.error && <s-banner tone="critical" heading="Error">{run.error}</s-banner>}

      {/* Summary */}
      <s-section heading="Summary">
        <s-stack direction="inline" gap="large-200" alignItems="center">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text color="subdued">Status</s-text>
            <s-badge tone={statusTone[run.status] ?? 'auto'}>{run.status}</s-badge>
          </s-stack>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text color="subdued">Duration</s-text>
            <s-text type="strong">{dur}</s-text>
          </s-stack>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text color="subdued">Started</s-text>
            <s-text>{run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      {/* Steps */}
      <s-section padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Step</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header listSlot="labeled">Duration</s-table-header>
            <s-table-header></s-table-header>
          </s-table-header-row>
          <s-table-body>
            {stepRows.map(({ step, label, isRetry }) => (
              <StepRow key={step.id} step={step} label={label} isRetry={isRetry} />
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <LogsSection
        runId={id}
        query={query}
        levels={levels}
        levelCounts={levelCounts}
        filteredLogs={filteredLogs}
        totalLogs={totalLogs}
        newLogIds={newLogIds}
        showHelp={showHelp}
        onQueryInput={handleQueryInput}
        onToggleHelp={() => setShowHelp(!showHelp)}
        onToggleLevel={toggleLevel}
      />
    </s-page>
    </>
  )
}
