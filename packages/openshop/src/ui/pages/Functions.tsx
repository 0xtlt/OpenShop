import { useState, useEffect, useCallback } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { apiFetch } from '../fetch'
import type { InputEvent } from '../types'

interface FunctionField {
  type: 'text' | 'password' | 'number' | 'select' | 'checkbox'
  label: string
  placeholder?: string
  options?: { label: string; value: string }[]
}

interface FunctionDef {
  key: string
  type: string
  handle: string
  modes?: string[]
  supportsUpdate: boolean
  fields: Record<string, FunctionField>
}

interface FunctionInstance {
  id: string
  title?: string
  status?: string
  enabled?: boolean
  config: Record<string, unknown>
}

const TYPE_LABELS: Record<string, string> = {
  discount: 'Discount',
  'cart-transform': 'Cart Transform',
  'delivery-customization': 'Delivery Customization',
  'payment-customization': 'Payment Customization',
  'checkout-validation': 'Checkout Validation',
  'fulfillment-constraints': 'Fulfillment Constraints',
}

export default function Functions({ handle, action }: { handle?: string; action?: string }) {
  if (handle && action === 'new') return <FunctionForm handle={handle} />
  if (handle && action) return <FunctionForm handle={handle} instanceId={action} />
  if (handle) return <FunctionInstances handle={handle} />
  return <FunctionList />
}

// ─── Function List ───────────────────────────────────────────────────

function FunctionList() {
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

// ─── Instances List ──────────────────────────────────────────────────

function FunctionInstances({ handle }: { handle: string }) {
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
    <s-page heading={fnDef?.key ?? handle} backAction={{ url: '/functions' }}>
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
            <s-table-header>
              <s-table-header-cell>Title</s-table-header-cell>
              <s-table-header-cell>Status</s-table-header-cell>
              <s-table-header-cell>Configuration</s-table-header-cell>
              <s-table-header-cell></s-table-header-cell>
            </s-table-header>
            <s-table-body>
              {instances.map((inst) => (
                <s-table-row key={inst.id}>
                  <s-table-cell>{inst.title ?? '(untitled)'}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={inst.status === 'ACTIVE' || inst.enabled ? 'success' : 'attention'}>
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

// ─── Create / Edit Form ──────────────────────────────────────────────

function FunctionForm({ handle, instanceId }: { handle: string; instanceId?: string }) {
  const [fnDef, setFnDef] = useState<FunctionDef | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<string>('automatic')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null)
  const { route } = useLocation()
  const isEdit = !!instanceId

  useEffect(() => {
    apiFetch('/api/functions').then((r) => r.json()).then((defs: FunctionDef[]) => {
      const def = defs.find((d) => d.handle === handle)
      if (def) {
        setFnDef(def)
        if (def.modes?.length) setMode(def.modes[0])
      }
    })

    if (instanceId) {
      apiFetch(`/api/functions/${handle}/instances`).then((r) => r.json()).then((instances: FunctionInstance[]) => {
        const inst = instances.find((i) => i.id === decodeURIComponent(instanceId))
        if (inst?.config) {
          setForm(Object.fromEntries(Object.entries(inst.config).map(([k, v]) => [k, String(v ?? '')])))
        }
      })
    }
  }, [handle, instanceId])

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const endpoint = isEdit
        ? `/api/functions/${handle}/instances/${encodeURIComponent(instanceId!)}`
        : `/api/functions/${handle}/instances`
      const res = await apiFetch(endpoint, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: form, mode }),
      })
      const data = await res.json()
      if (res.ok) {
        setMsg({ tone: 'success', text: isEdit ? 'Updated.' : 'Created.' })
        if (!isEdit) route(`/functions/${handle}`)
      } else {
        setMsg({ tone: 'critical', text: data.error ?? 'Error' })
      }
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!instanceId) return
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/functions/${handle}/instances/${encodeURIComponent(instanceId)}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        route(`/functions/${handle}`)
      } else {
        const data = await res.json()
        setMsg({ tone: 'critical', text: data.error ?? 'Delete failed' })
      }
    } finally {
      setDeleting(false)
    }
  }

  if (!fnDef) {
    return (
      <s-page heading="Loading..." backAction={{ url: `/functions/${handle}` }}>
        <s-box padding="large-500"><s-text color="subdued">Loading...</s-text></s-box>
      </s-page>
    )
  }

  const typeLabel = TYPE_LABELS[fnDef.type] ?? fnDef.type

  return (
    <s-page heading={isEdit ? 'Edit instance' : `New ${typeLabel}`} backAction={{ url: `/functions/${handle}` }}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        disabled={saving || (isEdit && !fnDef.supportsUpdate)}
      >
        {saving ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save' : 'Create')}
      </s-button>

      <s-stack gap="large-100">
        {msg && <s-banner tone={msg.tone}>{msg.text}</s-banner>}

        {isEdit && !fnDef.supportsUpdate && (
          <s-banner tone="warning">
            This function type does not support updates. Delete and recreate to change configuration.
          </s-banner>
        )}

        {fnDef.modes && fnDef.modes.length > 1 && (
          <s-box padding="large-100" background="base" border="base" borderRadius="large">
            <s-select label="Discount mode" value={mode} onChange={(e: InputEvent) => setMode(e.target.value)}>
              {fnDef.modes.map((m) => (
                <s-option key={m} value={m}>{m === 'automatic' ? 'Automatic discount' : 'Discount code'}</s-option>
              ))}
            </s-select>
          </s-box>
        )}

        <s-box padding="large-100" background="base" border="base" borderRadius="large">
          <s-stack gap="base">
            <s-heading>Configuration</s-heading>
            {Object.entries(fnDef.fields).map(([key, field]) => {
              if (field.type === 'number') {
                return (
                  <s-number-field
                    key={key} label={field.label} placeholder={field.placeholder}
                    value={form[key] ?? ''}
                    onInput={(e: InputEvent) => setForm({ ...form, [key]: e.target.value })}
                  />
                )
              }
              if (field.type === 'checkbox') {
                return (
                  <s-checkbox
                    key={key} label={field.label}
                    checked={form[key] === 'true'}
                    onChange={(e: InputEvent) => setForm({ ...form, [key]: String(e.target.checked) })}
                  />
                )
              }
              return (
                <s-text-field
                  key={key} label={field.label} placeholder={field.placeholder}
                  value={form[key] ?? ''}
                  onInput={(e: InputEvent) => setForm({ ...form, [key]: e.target.value })}
                />
              )
            })}
          </s-stack>
        </s-box>

        {isEdit && (
          <s-box padding="large-100" background="base" border="base" borderRadius="large">
            <s-stack gap="base">
              <s-heading>Danger zone</s-heading>
              <s-paragraph>This will permanently remove this function instance from Shopify.</s-paragraph>
              <s-button variant="destructive" onClick={remove} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete instance'}
              </s-button>
            </s-stack>
          </s-box>
        )}
      </s-stack>
    </s-page>
  )
}
