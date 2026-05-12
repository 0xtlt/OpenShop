import { useState, useEffect, useCallback } from 'preact/hooks'
import { apiFetch } from '../fetch'
import type { InputEvent, ProviderSummary } from '../types'

export default function Providers() {
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [idx, setIdx] = useState(0)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null)

  const toForm = (cfg: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, String(v ?? '')]))

  const load = useCallback(async () => {
    const res = await apiFetch('/api/providers')
    const data: Provider[] = await res.json()
    setProviders(data)
    if (data.length > 0) setForm(toForm(data[idx]?.config ?? {}))
  }, [idx])

  useEffect(() => { load() }, [load])

  const switchProvider = (newIdx: number) => {
    setIdx(newIdx)
    setForm(toForm(providers[newIdx]?.config ?? {}))
    setMsg(null)
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
            onChange={(e: InputEvent) => switchProvider(Number(e.target.value))}
          >
            {providers.map((pr, i) => (
              <s-option key={pr.name} value={String(i)}>{pr.name}</s-option>
            ))}
          </s-select>
        </s-section>
      )}

      <s-section heading={p?.name ?? 'Provider'}>
        {p && Object.entries(p.fields).map(([key, field]) => {
          if (field.type === 'password') {
            return (
              <s-password-field
                key={key}
                label={field.label}
                placeholder={field.placeholder}
                value={form[key] ?? ''}
                onInput={(e: InputEvent) => setForm({ ...form, [key]: e.target.value })}
              />
            )
          }
          if (field.type === 'number') {
            return (
              <s-number-field
                key={key}
                label={field.label}
                placeholder={field.placeholder}
                value={form[key] ?? ''}
                onInput={(e: InputEvent) => setForm({ ...form, [key]: e.target.value })}
              />
            )
          }
          if (field.type === 'checkbox') {
            return (
              <s-checkbox
                key={key}
                label={field.label}
                checked={form[key] === 'true'}
                onChange={(e: InputEvent) => setForm({ ...form, [key]: String(e.target.checked) })}
              />
            )
          }
          if (field.type === 'select' && field.options) {
            return (
              <s-select
                key={key}
                label={field.label}
                value={form[key] ?? ''}
                onChange={(e: InputEvent) => setForm({ ...form, [key]: e.target.value })}
              >
                {field.options.map((o) => <s-option key={o.value} value={o.value}>{o.label}</s-option>)}
              </s-select>
            )
          }
          return (
            <s-text-field
              key={key}
              label={field.label}
              placeholder={field.placeholder}
              value={form[key] ?? ''}
              onInput={(e: InputEvent) => setForm({ ...form, [key]: e.target.value })}
            />
          )
        })}
      </s-section>

      {p?.lastCheckedAt && (
        <s-section>
          <s-text color="subdued">Last checked: {new Date(p.lastCheckedAt).toLocaleString()}</s-text>
        </s-section>
      )}
    </s-page>
  )
}
