import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { apiFetch } from '../../fetch'
import { TYPE_LABELS, type FunctionDef } from './types'

export function FunctionList() {
  const [functions, setFunctions] = useState<FunctionDef[]>([])
  const { route } = useLocation()

  useEffect(() => {
    apiFetch('/api/functions').then((r) => r.json()).then(setFunctions)
  }, [])

  if (!functions.length) {
    return (
      <s-page heading="Functions">
        <s-box padding="large-500">
          <s-stack gap="base">
            <s-heading>No functions configured</s-heading>
            <s-paragraph>
              Define Shopify Functions in your openshop.config.ts to manage discount, cart transform,
              and other function instances from here.
            </s-paragraph>
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
                <s-heading>{fn.key}</s-heading>
                <s-stack direction="inline" gap="base">
                  <s-badge>{TYPE_LABELS[fn.type] ?? fn.type}</s-badge>
                  {fn.modes && fn.modes.length > 1 && (
                    <s-badge tone="info">{fn.modes.join(', ')}</s-badge>
                  )}
                </s-stack>
                <s-text color="subdued">{Object.keys(fn.fields).length} config fields</s-text>
              </s-stack>
              <s-button onClick={() => route(`/functions/${fn.handle}`)}>Manage</s-button>
            </s-stack>
          </s-box>
        ))}
      </s-stack>
    </s-page>
  )
}
