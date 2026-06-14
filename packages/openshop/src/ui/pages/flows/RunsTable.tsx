import type { FlowRun } from '../../types'
import { statusTone } from '../../types'

interface RunsTableProps {
  filter: string | null
  runs: FlowRun[]
  pageRuns: FlowRun[]
  loadingRuns: boolean
  page: number
  pageSize: number
  checkedIds: Set<string>
  deleting: boolean
  searchInput: string
  allChecked: boolean
  onSearchInput: (event: Event) => void
  onNextPage: () => void
  onPreviousPage: () => void
  toggleAll: () => void
  toggleCheck: (id: string) => void
  confirmBulkDelete: () => void
}

function duration(run: FlowRun) {
  if (!run.startedAt || !run.completedAt) return run.status === 'running' ? '…' : '—'
  const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 0) return `Today at ${time}`
  if (diffDays === 1) return `Yesterday at ${time}`
  if (diffDays < 7) return `${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`
}

export function RunsTable({
  filter,
  runs,
  pageRuns,
  loadingRuns,
  page,
  pageSize,
  checkedIds,
  deleting,
  searchInput,
  allChecked,
  onSearchInput,
  onNextPage,
  onPreviousPage,
  toggleAll,
  toggleCheck,
  confirmBulkDelete,
}: RunsTableProps) {
  return (
    <s-section heading={filter ? `Runs — ${filter}` : 'Runs'}>
      <s-section padding="none">
        <s-table
          loading={loadingRuns}
          paginate
          hasPreviousPage={page > 0}
          hasNextPage={runs.length > pageSize}
          onNextPage={onNextPage}
          onPreviousPage={onPreviousPage}
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
            {pageRuns.map((run) => (
              <s-table-row key={run.id} clickDelegate={`run-link-${run.id}`}>
                <s-table-cell>
                  <span onClick={(event) => event.stopPropagation()}>
                    <s-checkbox
                      label={`Select run ${run.id.slice(0, 8)}`}
                      labelAccessibilityVisibility="exclusive"
                      checked={checkedIds.has(run.id)}
                      onChange={() => toggleCheck(run.id)}
                    />
                  </span>
                </s-table-cell>
                <s-table-cell>
                  <s-link id={`run-link-${run.id}`} href={`/runs/${run.id}`}>#{run.id.slice(0, 8)}</s-link>
                </s-table-cell>
                {!filter && <s-table-cell>{run.flowName}</s-table-cell>}
                <s-table-cell>
                  <s-badge tone={statusTone[run.status] ?? 'auto'}>{run.status}</s-badge>
                </s-table-cell>
                <s-table-cell>{run.startedAt ? formatDate(run.startedAt) : '—'}</s-table-cell>
                <s-table-cell>{duration(run)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-section>
  )
}
