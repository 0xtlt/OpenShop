import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { apiJson } from '../../fetch'
import { TYPE_LABELS, type FunctionDef } from './types'

export function FunctionList() {
  const [functions, setFunctions] = useState<FunctionDef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { route } = useLocation()

  useEffect(() => {
    apiJson<FunctionDef[]>('/api/functions')
      .then(setFunctions)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Unable to load functions'))
      .finally(() => setLoading(false))
  }, [])

  if (loading || error || !functions.length) {
    return (
      <s-page heading="Functions">
        {error && <s-banner tone="critical">{error}</s-banner>}
        <s-box padding="large-500">
          <s-stack gap="base">
            {loading ? (
              <s-text color="subdued">Loading function catalogue...</s-text>
            ) : !error ? (
              <>
                <s-heading>No functions configured</s-heading>
                <s-paragraph>
                  Define Shopify Functions in your openshop.config.ts to manage their Shopify owners from here.
                </s-paragraph>
              </>
            ) : null}
          </s-stack>
        </s-box>
      </s-page>
    )
  }

  return (
    <s-page heading="Functions">
      <s-stack gap="large-100">
        {functions.map((fn) => (
          <s-box key={fn.handle} padding="large-100" background="base" border="base" borderRadius="large">
            <s-stack direction="inline" justifyContent="space-between" alignItems="center">
              <s-stack gap="small">
                <s-heading>{fn.label}</s-heading>
                <s-stack direction="inline" gap="base">
                  <s-badge>{TYPE_LABELS[fn.type] ?? fn.type}</s-badge>
                  {fn.capabilities.singleton && <s-badge tone="info">Singleton</s-badge>}
                </s-stack>
                <s-text color="subdued">
                  {Object.keys(fn.settingsFields).length} settings field{Object.keys(fn.settingsFields).length === 1 ? '' : 's'}
                  {Object.keys(fn.configFields).length > 0
                    ? ` · ${Object.keys(fn.configFields).length} config field${Object.keys(fn.configFields).length === 1 ? '' : 's'}`
                    : ''}
                </s-text>
              </s-stack>
              <s-button onClick={() => route(`/functions/${fn.handle}`)}>Manage</s-button>
            </s-stack>
          </s-box>
        ))}
      </s-stack>
    </s-page>
  )
}
