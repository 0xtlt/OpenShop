import type { ComponentChildren, JSX } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { apiFetch, apiJson } from '../fetch'
import { eventValue } from '../events'
import type { FlowSummary, FlowRun } from '../types'
import { statusTone } from '../types'

interface AppBridgeModal extends HTMLElement {
  show(): void
  hide(): void
}

function getModal(id: string): AppBridgeModal | null {
  return document.getElementById(id) as AppBridgeModal | null
}

type ModalButtonProps = {
  children: ComponentChildren
  variant?: 'primary'
  tone?: 'critical'
  onClick?: () => void | Promise<void>
  disabled?: boolean
}

function ModalButton({ children, ...buttonProps }: ModalButtonProps) {
  return <button {...(buttonProps as JSX.HTMLAttributes<HTMLButtonElement>)}>{children}</button>
}

type ArkJsonSchema =
  | { domain: 'object'; required?: { key: string; value: ArkJsonSchema }[]; optional?: { key: string; value: ArkJsonSchema }[] }
  | { domain: 'number'; divisor?: number; min?: { rule: number }; max?: { rule: number } }
  | { domain: 'string'; pattern?: string; minLength?: number; maxLength?: number }
  | { domain: 'boolean' }
  | { unit: unknown }
  | string

function schemaToExample(schema: ArkJsonSchema | null): Record<string, unknown> | null {
  if (!schema || typeof schema === 'string') return null
  if (!('domain' in schema) || schema.domain !== 'object') return null
  const obj: Record<string, unknown> = {}
  for (const { key, value } of [...(schema.required ?? []), ...(schema.optional ?? [])]) {
    obj[key] = valueExample(value)
  }
  return Object.keys(obj).length ? obj : null
}

function valueExample(v: ArkJsonSchema): unknown {
  if (typeof v === 'string') return v === 'number' ? 0 : v === 'boolean' ? false : ''
  if ('unit' in v) return v.unit
  if (!('domain' in v)) return null
  switch (v.domain) {
    case 'number': return v.min?.rule != null ? v.min.rule + 1 : 0
    case 'string': return ''
    case 'boolean': return false
    case 'object': return schemaToExample(v) ?? {}
    default: return null
  }
}

export default function Flows({ name }: { name?: string }) {
  const { route } = useLocation()
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [runs, setRuns] = useState<FlowRun[]>([])
  const [selected, setSelected] = useState<string | null>(null) // flow to run (modal only)
  const filter = name ?? null // runs filter comes ONLY from the URL route param
  const [triggering, setTriggering] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [page, setPage] = useState(0)
  const pageSize = 25
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [inputJson, setInputJson] = useState('{}')
  const [inputError, setInputError] = useState<string | null>(null)
  const initQ = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('q') ?? '' : ''
  const [searchInput, setSearchInput] = useState(initQ)
  const [search, setSearch] = useState(initQ)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const syncSearchUrl = (val: string) => {
    const params = new URLSearchParams(window.location.search)
    if (val) params.set('q', val)
    else params.delete('q')
    const qs = params.toString()
    history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
  }

  const onSearchInput = (event: Event) => {
    const val = eventValue(event)
    setSearchInput(val)
    syncSearchUrl(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearch(val), 300)
  }

  useEffect(() => {
    apiFetch('/api/flows').then((r) => r.json()).then(setFlows)
  }, [])

  // Reset page and selection when filter or search changes
  useEffect(() => { setPage(0); setCheckedIds(new Set()) }, [filter, search])
  useEffect(() => { setCheckedIds(new Set()) }, [page])

  useEffect(() => {
    setLoadingRuns(true)
    const params = new URLSearchParams({ limit: String(pageSize + 1), offset: String(page * pageSize) })
    if (search) params.set('search', search)
    const base = filter ? `/api/flows/${filter}/runs` : '/api/runs'
    const url = `${base}?${params}`
    let inFlight = false
    let canceled = false
    const load = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const data = await apiJson<FlowRun[]>(url)
        if (!canceled) {
          setRuns(data)
          setError(null)
        }
      } catch (err) {
        if (!canceled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        inFlight = false
        if (!canceled) setLoadingRuns(false)
      }
    }
    load()
    const iv = setInterval(load, 5000)
    return () => { canceled = true; clearInterval(iv) }
  }, [filter, search, page, refreshKey])

  const triggerRun = async () => {
    if (!selected) return

    // Validate JSON
    let input: Record<string, unknown>
    try {
      input = JSON.parse(inputJson)
      setInputError(null)
    } catch {
      setInputError('Invalid JSON')
      return
    }

    setTriggering(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/flows/${selected}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      const data = await res.json()

      // Close modal
      ;getModal('run-modal')?.hide()

      if (!res.ok) {
        setError(data.error)
      } else {
        window.shopify?.toast?.show(`Flow "${selected}" started`)
        route(`/runs/${data.runId}`)
      }
    } finally {
      setTriggering(false)
    }
  }

  const pageRuns = runs.slice(0, pageSize)
  const allChecked = pageRuns.length > 0 && pageRuns.every((r) => checkedIds.has(r.id))

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (allChecked) {
      setCheckedIds(new Set())
    } else {
      setCheckedIds(new Set(pageRuns.map((r) => r.id)))
    }
  }

  const confirmBulkDelete = () => {
    if (checkedIds.size === 0) return
    getModal('delete-modal')?.show()
  }

  const bulkDelete = async () => {
    if (checkedIds.size === 0) return
    setDeleting(true)
    getModal('delete-modal')?.hide()
    try {
      const res = await apiFetch('/api/runs/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...checkedIds] }),
      })
      const data = await res.json()
      if (res.ok) {
        window.shopify?.toast?.show(`Deleted ${data.deleted} run(s)${data.skipped ? `, ${data.skipped} skipped (active)` : ''}`)
        setCheckedIds(new Set())
        setRefreshKey((k) => k + 1)
      } else {
        setError(data.error)
      }
    } finally {
      setDeleting(false)
    }
  }

  const duration = (run: FlowRun) => {
    if (!run.startedAt || !run.completedAt) return run.status === 'running' ? '…' : '—'
    const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (diffDays === 0) return `Today at ${time}`
    if (diffDays === 1) return `Yesterday at ${time}`
    if (diffDays < 7) return `${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`
    return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`
  }


  return (
    <>
    <style>{`@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }`}</style>
    {/* App Bridge modal — renders at admin level, no z-index issues */}
    <ui-modal id="run-modal">
      <div style={{ padding: '16px' }}>
        <label htmlFor="flow-input-json" style={{ display: 'block', marginBottom: '4px', fontWeight: 600, fontSize: '13px' }}>Input (JSON)</label>
        <textarea
          id="flow-input-json"
          value={inputJson}
          onInput={(event) => { setInputJson(eventValue(event)); setInputError(null) }}
          placeholder='{ "limit": 10 }'
          rows={6}
          aria-invalid={Boolean(inputError)}
          aria-describedby={inputError ? 'flow-input-json-error' : undefined}
          style={{
            width: '100%',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '13px',
            padding: '8px 12px',
            borderRadius: '8px',
            border: inputError ? '2px solid #d72c0d' : '1px solid #c9cccf',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        {inputError && <span id="flow-input-json-error" style={{ color: '#d72c0d', fontSize: '12px' }}>{inputError}</span>}
      </div>
      <ui-title-bar title={`Run ${selected ?? ''}`}>
        <ModalButton variant="primary" onClick={triggerRun} disabled={triggering}>
          {triggering ? 'Running…' : 'Run'}
        </ModalButton>
        <ModalButton onClick={() => getModal('run-modal')?.hide()}>Cancel</ModalButton>
      </ui-title-bar>
    </ui-modal>

    <ui-modal id="delete-modal">
      <div style={{ padding: '16px' }}>
        <s-text>Are you sure you want to delete {checkedIds.size} run(s)? This action cannot be undone.</s-text>
      </div>
      <ui-title-bar title="Delete runs">
        <ModalButton variant="primary" tone="critical" onClick={bulkDelete} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete'}
        </ModalButton>
        <ModalButton onClick={() => getModal('delete-modal')?.hide()}>Cancel</ModalButton>
      </ui-title-bar>
    </ui-modal>

    <s-page heading="Flows">
      {/* Flow list */}
      <s-section padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Flow</s-table-header>
            <s-table-header listSlot="secondary">Schedule</s-table-header>
            <s-table-header listSlot="inline">Type</s-table-header>
            <s-table-header></s-table-header>
          </s-table-header-row>
          <s-table-body>
            {flows.map((f) => (
              <s-table-row key={f.name}>
                <s-table-cell>{f.name}</s-table-cell>
                <s-table-cell>
                  {f.crons.length === 0 ? '—' : f.crons.map((cr, i) => (
                    <code key={i} style={{ display: 'block', fontSize: '13px', background: '#f1f1f1', padding: '2px 6px', borderRadius: '4px', marginBottom: i < f.crons.length - 1 ? '4px' : 0 }}>
                      {cr.schedule}
                    </code>
                  ))}
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={f.crons.length ? 'info' : 'neutral'}>
                    {f.crons.length ? 'Scheduled' : 'Manual'}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>
                  <s-button variant="primary" onClick={() => {
                    setSelected(f.name)
                    const example = schemaToExample(f.inputSchema as ArkJsonSchema | null)
                    setInputJson(example ? JSON.stringify(example, null, 2) : '{}')
                    setInputError(null)
                    getModal('run-modal')?.show()
                  }}>
                    Run
                  </s-button>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      {error && <s-banner tone="critical" heading="Run failed">{error}</s-banner>}

      {/* Runs */}
      <s-section heading={filter ? `Runs — ${filter}` : 'Runs'}>
        <s-section padding="none">
          <s-table
            loading={loadingRuns}
            paginate
            hasPreviousPage={page > 0}
            hasNextPage={runs.length > pageSize}
            onNextPage={() => setPage(page + 1)}
            onPreviousPage={() => setPage(page - 1)}
          >
            <s-search-field
              slot="filters"
              label="Search runs"
              labelAccessibilityVisibility="exclusive"
              placeholder="Search by flow name, status, or ID..."
              value={searchInput}
              onInput={onSearchInput}
            />
            <s-table-header-row>
              <s-table-header>
                <div style={{ position: 'relative' }}>
                  <s-checkbox label="Select all runs" labelAccessibilityVisibility="exclusive" checked={allChecked} onChange={toggleAll} />
                  {checkedIds.size > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: '50%', left: 0,
                      transform: 'translateY(-50%)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      whiteSpace: 'nowrap',
                      background: '#f7f7f7',
                      paddingRight: '999px',
                      marginRight: '-999px',
                      animation: 'fade-in 150ms ease',
                    }}>
                      <s-checkbox label="Select all runs" labelAccessibilityVisibility="exclusive" checked={allChecked} onChange={toggleAll} />
                      <span style={{ paddingLeft: '8px' }}><s-text color="subdued">{checkedIds.size} selected</s-text></span>
                      <s-button variant="tertiary" tone="critical" onClick={confirmBulkDelete} disabled={deleting}>
                        {deleting ? 'Deleting…' : 'Delete'}
                      </s-button>
                    </div>
                  )}
                </div>
              </s-table-header>
              <s-table-header listSlot="primary">Run</s-table-header>
              {!filter && <s-table-header listSlot="secondary">Flow</s-table-header>}
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header listSlot="labeled">Started</s-table-header>
              <s-table-header listSlot="labeled">Duration</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {pageRuns.length === 0 && !loadingRuns && (
                <s-table-row>
                  <s-table-cell />
                  <s-table-cell><s-text color="subdued">No runs yet</s-text></s-table-cell>
                  {!filter && <s-table-cell />}
                  <s-table-cell />
                  <s-table-cell />
                  <s-table-cell />
                </s-table-row>
              )}
              {pageRuns.map((r) => (
                <s-table-row key={r.id} clickDelegate={`run-link-${r.id}`}>
                  <s-table-cell>
                    <span onClick={(event) => event.stopPropagation()}>
                      <s-checkbox
                        label={`Select run ${r.id.slice(0, 8)}`}
                        labelAccessibilityVisibility="exclusive"
                        checked={checkedIds.has(r.id)}
                        onChange={() => toggleCheck(r.id)}
                      />
                    </span>
                  </s-table-cell>
                  <s-table-cell>
                    <s-link id={`run-link-${r.id}`} href={`/runs/${r.id}`}>#{r.id.slice(0, 8)}</s-link>
                  </s-table-cell>
                  {!filter && <s-table-cell>{r.flowName}</s-table-cell>}
                  <s-table-cell>
                    <s-badge tone={statusTone[r.status] ?? 'auto'}>{r.status}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{r.startedAt ? formatDate(r.startedAt) : '—'}</s-table-cell>
                  <s-table-cell>{duration(r)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      </s-section>
    </s-page>
    </>
  )
}
