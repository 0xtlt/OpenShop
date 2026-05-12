import { useState, useEffect } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { apiFetch } from '../fetch'
import type { FlowRun, CronItem, ProviderSummary } from '../types'
import { statusTone } from '../types'

function timeAgo(date: string | null): string {
  if (!date) return '—'
  const ms = Date.now() - new Date(date).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

export default function Home() {
  const { route } = useLocation()
  const [flowCount, setFlowCount] = useState(0)
  const [recentRuns, setRecentRuns] = useState<FlowRun[]>([])
  const [crons, setCrons] = useState<CronItem[]>([])
  const [providers, setProviders] = useState<ProviderSummary[]>([])

  useEffect(() => {
    const load = async () => {
      const [fRes, rRes, cRes, pRes] = await Promise.all([
        apiFetch('/api/flows'),
        apiFetch('/api/runs?limit=10'),
        apiFetch('/api/crons'),
        apiFetch('/api/providers'),
      ])
      const flows = await fRes.json()
      setFlowCount(flows.length)
      setRecentRuns(await rRes.json())
      setCrons(await cRes.json())
      setProviders(await pRes.json())
    }
    load()
    const iv = setInterval(load, 10_000)
    return () => clearInterval(iv)
  }, [])

  const failed = recentRuns.filter((r) => r.status === 'failed')
  const lastRun = recentRuns[0]
  const enabledCrons = crons.filter((c) => c.enabled).length
  const disabledCrons = crons.filter((c) => !c.enabled).length

  return (
    <s-page heading="Dashboard">
      {/* Alerts */}
      {failed.length > 0 && (
        <s-banner tone="critical" heading={`${failed.length} failed run${failed.length > 1 ? 's' : ''}`}>
          {failed.slice(0, 3).map((r) => (
            <s-paragraph key={r.id}>
              <s-text type="strong">{r.flowName}</s-text> — {timeAgo(r.createdAt)}{' '}
              <s-link href={`/runs/${r.id}`}>View</s-link>
            </s-paragraph>
          ))}
        </s-banner>
      )}

      {/* Stats */}
      <s-section>
        <s-query-container>
          <s-grid
            gridTemplateColumns="@container (inline-size > 500px) 1fr 1fr 1fr 1fr, 1fr 1fr"
            gap="base"
          >
            <s-grid-item>
              <s-box padding="base" background="subdued" borderRadius="base" borderWidth="base" borderColor="base">
                <s-stack gap="small-200">
                  <s-text color="subdued">Flows</s-text>
                  <s-heading>{flowCount}</s-heading>
                </s-stack>
              </s-box>
            </s-grid-item>
            <s-grid-item>
              <s-box padding="base" background="subdued" borderRadius="base" borderWidth="base" borderColor="base">
                <s-stack gap="small-200">
                  <s-text color="subdued">Crons</s-text>
                  <s-stack direction="inline" gap="small-200" alignItems="baseline">
                    <s-heading>{enabledCrons}</s-heading>
                    {disabledCrons > 0 && <s-text color="subdued">({disabledCrons} disabled)</s-text>}
                  </s-stack>
                </s-stack>
              </s-box>
            </s-grid-item>
            <s-grid-item>
              <s-box padding="base" background="subdued" borderRadius="base" borderWidth="base" borderColor="base">
                <s-stack gap="small-200">
                  <s-text color="subdued">Providers</s-text>
                  <s-heading>{providers.length}</s-heading>
                </s-stack>
              </s-box>
            </s-grid-item>
            <s-grid-item>
              <s-box padding="base" background="subdued" borderRadius="base" borderWidth="base" borderColor="base">
                <s-stack gap="small-200">
                  <s-text color="subdued">Last activity</s-text>
                  <s-heading>{lastRun ? timeAgo(lastRun.createdAt) : '—'}</s-heading>
                </s-stack>
              </s-box>
            </s-grid-item>
          </s-grid>
        </s-query-container>
      </s-section>

      {/* Recent runs */}
      <s-section heading="Recent runs">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Flow</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header listSlot="labeled">When</s-table-header>
            <s-table-header listSlot="labeled">Duration</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {recentRuns.length === 0 && (
              <s-table-row>
                <s-table-cell><s-text color="subdued">No runs yet</s-text></s-table-cell>
                <s-table-cell />
                <s-table-cell />
                <s-table-cell />
              </s-table-row>
            )}
            {recentRuns.slice(0, 5).map((r) => {
              const durMs = r.startedAt && r.completedAt
                ? Math.max(0, new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime())
                : null
              const dur = durMs !== null
                ? durMs >= 1000 ? `${(durMs / 1000).toFixed(1)}s` : `${durMs}ms`
                : r.status === 'running' ? '…' : '—'
              return (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-link href={`/runs/${r.id}`} tone="neutral">
                      <s-text type="strong">{r.flowName}</s-text>
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={statusTone[r.status] ?? 'auto'}>{r.status}</s-badge>
                  </s-table-cell>
                  <s-table-cell><s-text color="subdued">{timeAgo(r.createdAt)}</s-text></s-table-cell>
                  <s-table-cell><s-text color="subdued">{dur}</s-text></s-table-cell>
                </s-table-row>
              )
            })}
          </s-table-body>
        </s-table>
        <s-box paddingBlockStart="base">
          <s-button variant="plain" onClick={() => route('/flows')}>View all runs</s-button>
        </s-box>
      </s-section>

      {/* Providers */}
      <s-section heading="Providers">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Name</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header></s-table-header>
          </s-table-header-row>
          <s-table-body>
            {providers.map((p) => (
              <s-table-row key={p.name}>
                <s-table-cell><s-text type="strong">{p.name}</s-text></s-table-cell>
                <s-table-cell>
                  <s-badge tone={p.lastCheckOk === true ? 'success' : p.lastCheckOk === false ? 'critical' : 'warning'}>
                    {p.lastCheckOk === true ? 'Connected' : p.lastCheckOk === false ? 'Error' : 'Not configured'}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>
                  <s-button variant="secondary" onClick={() => route('/providers')}>Configure</s-button>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  )
}
