import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { apiFetch } from '../fetch'
import { eventValue } from '../events'
import type { RunDetail, LogEntry, StepResult } from '../types'
import { statusTone } from '../types'

interface AppBridgeModal extends HTMLElement {
  show(): void
  hide(): void
  showOverlay(): void
  hideOverlay(): void
}

const logLevelColor: Record<string, string> = {
  info: '#2e72d2',
  warn: '#b98900',
  error: '#d72c0d',
}

const MAX_OUTPUT_CHARS = 2000

function formatSize(json: string): string {
  const bytes = new Blob([json]).size
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function buildStepRows(steps: StepResult[]) {
  const sorted = [...steps].sort((a, b) => {
    const timeDiff = new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()
    if (timeDiff !== 0) return timeDiff
    return a.id.localeCompare(b.id)
  })

  const baseIndexByName = new Map<string, number>()
  const occurrencesByName = new Map<string, number>()

  return sorted.map((step) => {
    let baseIndex = baseIndexByName.get(step.stepName)
    if (!baseIndex) {
      baseIndex = baseIndexByName.size + 1
      baseIndexByName.set(step.stepName, baseIndex)
    }

    const occurrence = (occurrencesByName.get(step.stepName) ?? 0) + 1
    occurrencesByName.set(step.stepName, occurrence)

    return {
      step,
      label: occurrence === 1 ? String(baseIndex) : `${baseIndex}.${occurrence}`,
      isRetry: occurrence > 1,
    }
  })
}

function StepRow({ step, label, isRetry }: { step: StepResult; label: string; isRetry: boolean }) {
  const hasOutput = step.output != null

  return (
    <s-table-row>
      <s-table-cell>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: '20px', height: '20px', borderRadius: '999px',
            padding: '0 6px',
            background: '#f1f1f1', fontSize: '11px', fontWeight: 700, color: '#616161', flexShrink: 0,
          }}>
            {label}
          </span>
          <strong>{step.stepName}</strong>
          {isRetry && <span style={{ color: '#8c9196', fontSize: '12px' }}>retry</span>}
        </span>
      </s-table-cell>
      <s-table-cell>
        <s-badge tone={statusTone[step.status] ?? 'auto'}>{step.status}</s-badge>
      </s-table-cell>
      <s-table-cell>{step.durationMs != null ? `${step.durationMs}ms` : '—'}</s-table-cell>
      <s-table-cell>
        {step.error && <span style={{ color: '#d72c0d', fontSize: '13px' }}>{step.error}</span>}
        {hasOutput && (
          <s-button variant="secondary" onClick={() => {
            const modal = document.getElementById('output-modal') as AppBridgeModal | null
            if (!modal) return
            const pre = document.getElementById('output-modal-pre')
            const title = document.getElementById('output-modal-title')
            if (pre) {
              const full = JSON.stringify(step.output, null, 2)
              const truncated = full.length > MAX_OUTPUT_CHARS
              pre.textContent = truncated ? full.slice(0, MAX_OUTPUT_CHARS) + '\n…' : full
              pre.dataset.full = full
              pre.dataset.stepName = step.stepName
              pre.dataset.truncated = String(truncated)
              pre.dataset.size = formatSize(full)
              const sizeEl = document.getElementById('output-modal-size')
              if (sizeEl) sizeEl.textContent = formatSize(full)
            }
            if (title) title.setAttribute('title', `Output — ${step.stepName}`)
            modal.show()
          }}>
            Output
          </s-button>
        )}
      </s-table-cell>
    </s-table-row>
  )
}

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
    {/* Output modal */}
    <ui-modal id="output-modal">
      <div style={{ padding: '16px' }}>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          <s-button variant="secondary" onClick={() => {
            const pre = document.getElementById('output-modal-pre')
            if (pre?.dataset.full) navigator.clipboard.writeText(pre.dataset.full)
          }}>
            Copy
          </s-button>
          <s-button variant="secondary" onClick={() => {
            const pre = document.getElementById('output-modal-pre')
            if (!pre?.dataset.full) return
            const blob = new Blob([pre.dataset.full], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `${pre.dataset.stepName ?? 'output'}.json`
            a.click()
            URL.revokeObjectURL(a.href)
          }}>
            Download
          </s-button>
          <span id="output-modal-size" style={{ color: '#8c9196', fontSize: '12px', alignSelf: 'center', marginLeft: 'auto' }} />
        </div>
        <pre
          id="output-modal-pre"
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '12px',
            lineHeight: '1.5',
            background: '#fafafa',
            borderRadius: '6px',
            padding: '8px 12px',
            overflow: 'auto',
            maxHeight: '60vh',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
            border: '1px solid #e3e3e3',
          }}
        />
      </div>
      <ui-title-bar id="output-modal-title" title="Output">
        <button onClick={() => (document.getElementById('output-modal') as AppBridgeModal | null)?.hide()}>Close</button>
      </ui-title-bar>
    </ui-modal>

    {/* Retry modal */}
    <s-modal id="retry-modal" heading="Retry run" accessibility-label="Choose retry mode">
      <s-stack direction="block" gap="base">
        <s-text>How do you want to retry this run?</s-text>
        <s-button variant="primary" disabled={retrying} onClick={async () => {
          await retryRun('resume')
          ;(document.getElementById('retry-modal') as AppBridgeModal | null)?.hideOverlay()
        }}>
          Resume — pick up where it failed
        </s-button>
        <s-button variant="secondary" disabled={retrying} onClick={async () => {
          await retryRun('reset')
          ;(document.getElementById('retry-modal') as AppBridgeModal | null)?.hideOverlay()
        }}>
          Restart — discard steps and start fresh
        </s-button>
      </s-stack>
      <s-button slot="secondary-actions" variant="secondary" commandFor="retry-modal" command="--hide">
        Cancel
      </s-button>
    </s-modal>

    {/* Delete confirmation modal */}
    <s-modal id="delete-modal" heading="Delete run" accessibility-label="Confirm run deletion">
      <s-text>This will permanently delete this run, its steps, and all logs. This cannot be undone.</s-text>
      <s-button slot="primary-action" variant="primary" tone="critical" onClick={async () => {
        ;(document.getElementById('delete-modal') as AppBridgeModal | null)?.hideOverlay()
        await deleteRun()
      }}>
        Delete
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" commandFor="delete-modal" command="--hide">
        Cancel
      </s-button>
    </s-modal>

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

      {/* Logs */}
      <s-section heading="Logs">
        {/* Search bar */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ flex: 1 }}>
            <s-search-field
              label="Search logs"
              labelAccessibilityVisibility="exclusive"
              placeholder='|= "text" != "exclude" |~ "regex" C:3'
              value={query}
              onInput={handleQueryInput}
            />
          </div>
          <s-button
            variant="secondary"
            accessibilityLabel="Show log query syntax"
            aria-expanded={showHelp}
            onClick={() => setShowHelp(!showHelp)}
          >
            ?
          </s-button>
        </div>

        {/* Level toggles + export */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
          {(['info', 'warn', 'error'] as const).map((lvl) => (
            <s-button
              key={lvl}
              variant={levels.has(lvl) ? 'primary' : 'secondary'}
              onClick={() => toggleLevel(lvl)}
            >
              {lvl.toUpperCase()} ({levelCounts[lvl] ?? 0})
            </s-button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#8c9196', alignSelf: 'center' }}>
            {filteredLogs.length}/{totalLogs} logs
          </span>
          <s-button variant="secondary" onClick={async () => {
            const params = new URLSearchParams()
            if (query) params.set('q', query)
            params.set('levels', [...levels].join(','))
            params.set('format', 'json')
            const res = await apiFetch(`/api/runs/${id}/logs/export?${params}`)
            const blob = await res.blob()
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `run-${id}-logs.json`
            a.click()
            URL.revokeObjectURL(a.href)
          }}>JSON</s-button>
          <s-button variant="secondary" onClick={async () => {
            const params = new URLSearchParams()
            if (query) params.set('q', query)
            params.set('levels', [...levels].join(','))
            params.set('format', 'csv')
            const res = await apiFetch(`/api/runs/${id}/logs/export?${params}`)
            const blob = await res.blob()
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `run-${id}-logs.csv`
            a.click()
            URL.revokeObjectURL(a.href)
          }}>CSV</s-button>
        </div>

        {/* Help */}
        {showHelp && (
          <div style={{ marginBottom: '12px' }}>
            <s-banner tone="info" heading="Query syntax">
              <div style={{ fontFamily: 'monospace', fontSize: '12px', lineHeight: '2' }}>
                <div><strong>|= "text"</strong> — Contains (case-insensitive)</div>
                <div><strong>!= "text"</strong> — Excludes</div>
                <div><strong>|~ "regex"</strong> — Regex match</div>
                <div><strong>C:N</strong> — Show N context lines around matches</div>
                <div><strong>B:N / A:N</strong> — Before / After context only</div>
                <div><strong>last:5m</strong> — Last 5 minutes (s/m/h/d)</div>
                <div><strong>from:ISO to:ISO</strong> — Absolute date range</div>
                <div><strong>between:start,end</strong> — Date range shorthand</div>
                <div>Free text — Simple substring search</div>
                <div style={{ marginTop: '4px' }}>Example: <code>|= "order" != "retry" last:1h C:2</code></div>
              </div>
            </s-banner>
          </div>
        )}

        {/* Log viewer */}
        {filteredLogs.length === 0 ? (
          <s-text color="subdued">{totalLogs === 0 ? 'No logs.' : 'No matching logs.'}</s-text>
        ) : (
          <div
            tabIndex={0}
            role="log"
            aria-label="Run logs"
            style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '12px',
            lineHeight: '1.7',
            maxHeight: '500px',
            overflowY: 'auto',
            borderRadius: '8px',
            background: '#fafafa',
            padding: '8px 12px',
          }}>
            <style>{`
              @keyframes logSlideIn {
                from { opacity: 0; max-height: 0; transform: translateY(-4px); }
                to { opacity: 1; max-height: 80px; transform: translateY(0); }
              }
              .log-line-new { animation: logSlideIn 0.4s ease-out both; }
              .log-line-highlight { background: #fff3cd; }
              .log-line-fade { transition: background 3s ease-out; background: transparent; }
            `}</style>
            {filteredLogs.map((log) => {
              const isNew = newLogIds.has(log.id)
              const isSearchMatch = log._matched === true && query
              return (
              <div
                key={log.id}
                className={isNew ? 'log-line-new log-line-highlight' : 'log-line-fade'}
                style={{
                  display: 'flex',
                  gap: '10px',
                  padding: '1px 4px',
                  borderRadius: '3px',
                  overflow: 'hidden',
                  opacity: log._matched === false ? 0.5 : undefined,
                  background: !isNew && isSearchMatch ? '#fff8e1' : undefined,
                }}
              >
                <span style={{ color: '#8c9196', flexShrink: 0, minWidth: '75px' }}>
                  {new Date(log.createdAt ?? 0).toLocaleTimeString()}
                </span>
                <span style={{
                  color: logLevelColor[log.level] ?? 'inherit',
                  fontWeight: 700,
                  flexShrink: 0,
                  minWidth: '40px',
                }}>
                  {log.level.toUpperCase()}
                </span>
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {log.message}
                  {log.payload && Object.keys(log.payload).length > 0 && (
                    <span style={{ color: '#8c9196' }}>
                      {' '}{Object.entries(log.payload).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}
                    </span>
                  )}
                </span>
              </div>
              )
            })}
          </div>
        )}
      </s-section>
    </s-page>
    </>
  )
}
