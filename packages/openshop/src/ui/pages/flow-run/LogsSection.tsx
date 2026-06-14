import { apiFetch } from '../../fetch'
import type { LogEntry } from '../../types'

const logLevelColor: Record<string, string> = {
  info: '#2e72d2',
  warn: '#b98900',
  error: '#d72c0d',
}

interface LogsSectionProps {
  runId?: string
  query: string
  levels: Set<string>
  levelCounts: Record<string, number>
  filteredLogs: LogEntry[]
  totalLogs: number
  newLogIds: Set<string>
  showHelp: boolean
  onQueryInput: (event: Event) => void
  onToggleHelp: () => void
  onToggleLevel: (level: string) => void
}

async function downloadLogs(runId: string | undefined, query: string, levels: Set<string>, format: 'json' | 'csv') {
  if (!runId) return
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  params.set('levels', [...levels].join(','))
  params.set('format', format)
  const res = await apiFetch(`/api/runs/${runId}/logs/export?${params}`)
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `run-${runId}-logs.${format}`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function LogsSection({
  runId,
  query,
  levels,
  levelCounts,
  filteredLogs,
  totalLogs,
  newLogIds,
  showHelp,
  onQueryInput,
  onToggleHelp,
  onToggleLevel,
}: LogsSectionProps) {
  return (
    <s-section heading="Logs">
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ flex: 1 }}>
          <s-search-field
            label="Search logs"
            labelAccessibilityVisibility="exclusive"
            placeholder='|= "text" != "exclude" |~ "regex" C:3'
            value={query}
            onInput={onQueryInput}
          />
        </div>
        <s-button
          variant="secondary"
          accessibilityLabel="Show log query syntax"
          aria-expanded={showHelp}
          onClick={onToggleHelp}
        >
          ?
        </s-button>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        {(['info', 'warn', 'error'] as const).map((lvl) => (
          <s-button
            key={lvl}
            variant={levels.has(lvl) ? 'primary' : 'secondary'}
            onClick={() => onToggleLevel(lvl)}
          >
            {lvl.toUpperCase()} ({levelCounts[lvl] ?? 0})
          </s-button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#8c9196', alignSelf: 'center' }}>
          {filteredLogs.length}/{totalLogs} logs
        </span>
        <s-button variant="secondary" onClick={() => downloadLogs(runId, query, levels, 'json')}>JSON</s-button>
        <s-button variant="secondary" onClick={() => downloadLogs(runId, query, levels, 'csv')}>CSV</s-button>
      </div>

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
          }}
        >
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
  )
}
