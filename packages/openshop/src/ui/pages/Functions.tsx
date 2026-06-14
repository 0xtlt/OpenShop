import { useState, useEffect } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { apiFetch } from '../fetch'
import { eventValue } from '../events'
import { ConfigFieldRenderer } from '../components/ConfigFieldRenderer'
import type { BannerTone } from '../types'
import { FunctionInstances } from './functions/FunctionInstances'
import { FunctionList } from './functions/FunctionList'
import { TYPE_LABELS, type FunctionDef, type FunctionInstance } from './functions/types'

export default function Functions({ handle, action }: { handle?: string; action?: string }) {
  if (handle && action === 'new') return <FunctionForm handle={handle} />
  if (handle && action) return <FunctionForm handle={handle} instanceId={action} />
  if (handle) return <FunctionInstances handle={handle} />
  return <FunctionList />
}

// ─── Create / Edit Form ──────────────────────────────────────────────

function FunctionForm({ handle, instanceId }: { handle: string; instanceId?: string }) {
  const [fnDef, setFnDef] = useState<FunctionDef | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<string>('automatic')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [msg, setMsg] = useState<{ tone: BannerTone; text: string } | null>(null)
  const { route } = useLocation()
  const isEdit = !!instanceId
  const updateField = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

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
      const params = new URLSearchParams()
      if (fnDef?.type === 'discount') params.set('mode', mode)
      const suffix = params.toString() ? `?${params}` : ''
      const res = await apiFetch(`/api/functions/${handle}/instances/${encodeURIComponent(instanceId)}${suffix}`, {
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
      <s-page heading="Loading...">
        <s-link slot="breadcrumb-actions" href={`/functions/${handle}`}>Function</s-link>
        <s-box padding="large-500"><s-text color="subdued">Loading...</s-text></s-box>
      </s-page>
    )
  }

  const typeLabel = TYPE_LABELS[fnDef.type] ?? fnDef.type

  return (
    <>
    {isEdit && (
      <s-modal id="delete-function-instance-modal" heading="Delete instance" accessibility-label="Confirm function instance deletion">
        <s-text>This will permanently remove this function instance from Shopify.</s-text>
        <s-button slot="primary-action" variant="primary" tone="critical" onClick={remove} disabled={deleting}>
          {deleting ? 'Deleting...' : 'Delete'}
        </s-button>
        <s-button slot="secondary-actions" variant="secondary" commandFor="delete-function-instance-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    )}
    <s-page heading={isEdit ? 'Edit instance' : `New ${typeLabel}`}>
      <s-link slot="breadcrumb-actions" href={`/functions/${handle}`} onClick={(event: Event) => { event.preventDefault(); route(`/functions/${handle}`) }}>
        {fnDef.key}
      </s-link>
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
            <s-select label="Discount mode" value={mode} onChange={(event) => setMode(eventValue(event))}>
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
              return (
                <ConfigFieldRenderer
                  key={key}
                  fieldKey={key}
                  field={field}
                  value={form[key] ?? ''}
                  onChange={updateField}
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
              <s-button variant="secondary" tone="critical" commandFor="delete-function-instance-modal" command="--show" disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete instance'}
              </s-button>
            </s-stack>
          </s-box>
        )}
      </s-stack>
    </s-page>
    </>
  )
}
