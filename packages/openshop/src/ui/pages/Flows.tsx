import { useState, useEffect, useRef } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { apiFetch, apiJson } from '../fetch'
import { eventValue } from '../events'
import type { FlowSummary, FlowRun } from '../types'
import { FlowListTable } from './flows/FlowListTable'
import { RunsTable } from './flows/RunsTable'
import { DeleteRunsModal, RunFlowModal, getModal } from './flows/modals'
import { schemaToExample, type ArkJsonSchema } from './flows/schema-example'

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

  return (
    <>
    <style>{`@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }`}</style>
    <RunFlowModal
      selected={selected}
      inputJson={inputJson}
      inputError={inputError}
      triggering={triggering}
      setInputJson={setInputJson}
      setInputError={setInputError}
      triggerRun={triggerRun}
    />
    <DeleteRunsModal checkedCount={checkedIds.size} deleting={deleting} bulkDelete={bulkDelete} />

    <s-page heading="Flows">
      <FlowListTable
        flows={flows}
        onRun={(flow) => {
          setSelected(flow.name)
          const example = schemaToExample(flow.inputSchema as ArkJsonSchema | null)
          setInputJson(example ? JSON.stringify(example, null, 2) : '{}')
          setInputError(null)
          getModal('run-modal')?.show()
        }}
      />

      {error && <s-banner tone="critical" heading="Run failed">{error}</s-banner>}

      <RunsTable
        filter={filter}
        runs={runs}
        pageRuns={pageRuns}
        loadingRuns={loadingRuns}
        page={page}
        pageSize={pageSize}
        checkedIds={checkedIds}
        deleting={deleting}
        searchInput={searchInput}
        allChecked={allChecked}
        onSearchInput={onSearchInput}
        onNextPage={() => setPage(page + 1)}
        onPreviousPage={() => setPage(page - 1)}
        toggleAll={toggleAll}
        toggleCheck={toggleCheck}
        confirmBulkDelete={confirmBulkDelete}
      />
    </s-page>
    </>
  )
}
