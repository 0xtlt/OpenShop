import { useState, useEffect, useCallback } from 'preact/hooks'
import { apiFetch, apiJson } from '../fetch'
import { eventValue } from '../events'
import { ConfigFieldRenderer } from '../components/ConfigFieldRenderer'
import type { BannerTone, ProviderSummary } from '../types'

export default function Providers() {
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [idx, setIdx] = useState(0)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [msg, setMsg] = useState<{ tone: BannerTone; text: string } | null>(null)

  const toForm = (cfg: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, String(v ?? '')]))

  const load = useCallback(async () => {
    try {
      const data = await apiJson<ProviderSummary[]>('/api/providers')
      setProviders(data)
      if (data.length > 0) setForm(toForm(data[idx]?.config ?? {}))
    } catch (error) {
      setMsg({ tone: 'critical', text: error instanceof Error ? error.message : String(error) })
    }
  }, [idx])

  useEffect(() => { load() }, [load])

  const switchProvider = (newIdx: number) => {
    setIdx(newIdx)
    setForm(toForm(providers[newIdx]?.config ?? {}))
    setMsg(null)
  }

  const updateField = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const p = providers[idx]

  const save = async () => {
    if (!p) return
    setSaving(true); setMsg(null)
    try {
      const res = await apiFetch(`/api/providers/${p.name}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: form }),
      })
      const data = await res.json()
      setMsg(res.ok
        ? { tone: 'success', text: 'Saved.' }
        : { tone: 'critical', text: data.error ?? 'Error' })
      if (res.ok) load()
    } finally { setSaving(false) }
  }

  const check = async () => {
    if (!p) return
    setChecking(true); setMsg(null)
    try {
      const res = await apiFetch(`/api/providers/${p.name}/check`, { method: 'POST' })
      const data = await res.json()
      setMsg({ tone: data.ok ? 'success' : 'critical', text: data.ok ? 'Connection OK!' : (data.error ?? 'Failed') })
      load()
    } finally { setChecking(false) }
  }

  if (!providers.length) {
    return (
      <s-page heading="Providers">
        <s-section><s-text color="subdued">No providers registered.</s-text></s-section>
      </s-page>
    )
  }

  return (
    <s-page heading="Providers">
      <s-button-group slot="secondary-actions">
        <s-button variant="secondary" onClick={check} disabled={checking}>
          {checking ? 'Testing…' : 'Test connection'}
        </s-button>
      </s-button-group>
      <s-button slot="primary-action" variant="primary" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </s-button>

      {msg && <s-banner tone={msg.tone}>{msg.text}</s-banner>}

      {providers.length > 1 && (
        <s-section>
          <s-select
            label="Provider"
            value={String(idx)}
            onChange={(event) => switchProvider(Number(eventValue(event)))}
          >
            {providers.map((pr, i) => (
              <s-option key={pr.name} value={String(i)}>{pr.name}</s-option>
            ))}
          </s-select>
        </s-section>
      )}

      <s-section heading={p?.name ?? 'Provider'}>
        {p && Object.entries(p.fields).map(([key, field]) => (
          <ConfigFieldRenderer
            key={key}
            fieldKey={key}
            field={field}
            value={form[key] ?? ''}
            onChange={updateField}
          />
        ))}
      </s-section>

      {p?.lastCheckedAt && (
        <s-section>
          <s-text color="subdued">Last checked: {new Date(p.lastCheckedAt).toLocaleString()}</s-text>
        </s-section>
      )}
    </s-page>
  )
}
