import { useCallback, useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { apiFetch } from '../../fetch'
import { TYPE_LABELS, type FunctionDef, type FunctionInstance } from './types'

export function FunctionInstances({ handle }: { handle: string }) {
  const [instances, setInstances] = useState<FunctionInstance[]>([])
  const [fnDef, setFnDef] = useState<FunctionDef | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { route } = useLocation()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [defsRes, instRes] = await Promise.all([
        apiFetch('/api/functions'),
        apiFetch(`/api/functions/${handle}/instances`),
      ])
      const defs: FunctionDef[] = await defsRes.json()
      setFnDef(defs.find((d) => d.handle === handle) ?? null)

      if (instRes.ok) {
        setInstances(await instRes.json())
      } else {
        const data = await instRes.json()
        setError(data.error)
      }
    } finally {
      setLoading(false)
    }
  }, [handle])

  useEffect(() => { load() }, [load])

  const typeLabel = fnDef ? (TYPE_LABELS[fnDef.type] ?? fnDef.type) : ''

  return (
    <s-page heading={fnDef?.key ?? handle}>
      <s-link slot="breadcrumb-actions" href="/functions" onClick={(event: Event) => { event.preventDefault(); route('/functions') }}>
        Functions
      </s-link>
      <s-button slot="primary-action" variant="primary" onClick={() => route(`/functions/${handle}/new`)}>
        Create instance
      </s-button>

      {error && <s-banner tone="critical">{error}</s-banner>}

      {loading ? (
        <s-box padding="large-500">
          <s-text color="subdued">Loading instances from Shopify...</s-text>
        </s-box>
      ) : instances.length === 0 ? (
        <s-box padding="large-500" background="subdued" borderRadius="large">
          <s-stack gap="base" alignItems="center">
            <s-heading>No instances yet</s-heading>
            <s-paragraph>
              Create your first {typeLabel} instance to start using this function.
              Each instance has its own configuration stored as metafields on Shopify.
            </s-paragraph>
            <s-button variant="primary" onClick={() => route(`/functions/${handle}/new`)}>
              Create first instance
            </s-button>
          </s-stack>
        </s-box>
      ) : (
        <s-section>
          <s-text color="subdued">{instances.length} instance{instances.length !== 1 ? 's' : ''} — {typeLabel}</s-text>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Title</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header listSlot="secondary">Configuration</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {instances.map((inst) => (
                <s-table-row key={inst.id}>
                  <s-table-cell>{inst.title ?? '(untitled)'}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={inst.status === 'ACTIVE' || inst.enabled ? 'success' : 'warning'}>
                      {inst.status ?? (inst.enabled ? 'Active' : 'Inactive')}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text color="subdued">
                      {Object.entries(inst.config).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-button variant="secondary" onClick={() => route(`/functions/${handle}/${encodeURIComponent(inst.id)}`)}>See</s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  )
}
