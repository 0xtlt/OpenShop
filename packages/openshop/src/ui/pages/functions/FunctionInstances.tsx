import { useCallback, useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { apiJson } from '../../fetch'
import { canCreate, configurationSummary, resolveConfigurationPath, stateLabel } from './model'
import { STATE_TONES, TYPE_LABELS, type FunctionDef, type FunctionInstance } from './types'

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
      const [defs, loadedInstances] = await Promise.all([
        apiJson<FunctionDef[]>('/api/functions'),
        apiJson<FunctionInstance[]>(`/api/functions/${handle}/instances`),
      ])
      setFnDef(defs.find((d) => d.handle === handle) ?? null)
      setInstances(loadedInstances)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load function instances')
    } finally {
      setLoading(false)
    }
  }, [handle])

  useEffect(() => { load() }, [load])

  const typeLabel = fnDef ? (TYPE_LABELS[fnDef.type] ?? fnDef.type) : ''
  const createAllowed = canCreate(fnDef, instances)

  return (
    <s-page heading={fnDef?.label ?? handle}>
      <s-link slot="breadcrumb-actions" href="/functions" onClick={(event: Event) => { event.preventDefault(); route('/functions') }}>
        Functions
      </s-link>
      {createAllowed && (
        <s-button slot="primary-action" variant="primary" onClick={() => route(`/functions/${handle}/new`)}>
          Create instance
        </s-button>
      )}

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
              Settings and optional app configuration follow the capabilities exposed by Shopify.
            </s-paragraph>
            {createAllowed && (
              <s-button variant="primary" onClick={() => route(`/functions/${handle}/new`)}>
                Create first instance
              </s-button>
            )}
          </s-stack>
        </s-box>
      ) : (
        <s-section>
          <s-text color="subdued">{instances.length} instance{instances.length !== 1 ? 's' : ''} — {typeLabel}</s-text>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Label</s-table-header>
              <s-table-header listSlot="inline">State</s-table-header>
              <s-table-header listSlot="secondary">Configuration</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {instances.map((inst) => (
                <s-table-row key={inst.id}>
                  <s-table-cell>{inst.label}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATE_TONES[inst.state]}>
                      {stateLabel(inst.state)}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="small">
                      {inst.config.state === 'invalid' ? (
                        <s-badge tone="critical">{configurationSummary(inst.config)}</s-badge>
                      ) : (
                        <s-text color="subdued">{configurationSummary(inst.config)}</s-text>
                      )}
                      {resolveConfigurationPath(fnDef?.ui?.configurationPath, inst.id) && (
                        <s-link href={resolveConfigurationPath(fnDef?.ui?.configurationPath, inst.id)!}>
                          {fnDef?.ui?.configurationLabel ?? 'Configure'}
                        </s-link>
                      )}
                    </s-stack>
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
