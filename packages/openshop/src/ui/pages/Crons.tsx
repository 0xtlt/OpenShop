import { useState, useEffect } from 'preact/hooks'
import { apiFetch } from '../fetch'
import type { CronItem } from '../types'

interface AppBridgeModal extends HTMLElement {
  show(): void
  hide(): void
}

export default function Crons() {
  const [crons, setCrons] = useState<CronItem[]>([])
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/crons').then((r) => r.json()).then(setCrons)
  }, [])

  const toggle = async (cron: CronItem) => {
    setToggling(cron.key)
    try {
      const res = await apiFetch('/api/crons/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: cron.key, enabled: !cron.enabled }),
      })
      if (res.ok) {
        setCrons((prev) => prev.map((c) => c.key === cron.key ? { ...c, enabled: !c.enabled } : c))
      }
    } finally {
      setToggling(null)
    }
  }

  const showInput = (cron: CronItem) => {
    const modal = document.getElementById('cron-input-modal') as AppBridgeModal | null
    if (!modal) return
    const pre = document.getElementById('cron-input-pre')
    const title = document.getElementById('cron-input-title')
    const json = JSON.stringify(cron.input, null, 2)
    if (pre) {
      pre.textContent = json
      pre.dataset.full = json
    }
    if (title) title.setAttribute('title', `Input — ${cron.name ?? cron.flow}`)
    modal.show()
  }

  const shopsLabel = (shops: string | string[]) => {
    if (Array.isArray(shops)) return shops.join(', ')
    return String(shops)
  }

  return (
    <>
    <ui-modal id="cron-input-modal">
      <div style={{ padding: '16px' }}>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          <s-button variant="secondary" onClick={() => {
            const pre = document.getElementById('cron-input-pre')
            if (pre?.dataset.full) navigator.clipboard.writeText(pre.dataset.full)
          }}>
            Copy
          </s-button>
        </div>
        <pre
          id="cron-input-pre"
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '12px',
            lineHeight: '1.5',
            background: '#fafafa',
            borderRadius: '6px',
            padding: '8px 12px',
            overflow: 'auto',
            maxHeight: '60vh',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
            border: '1px solid #e3e3e3',
          }}
        />
      </div>
      <ui-title-bar id="cron-input-title" title="Input">
        <button onClick={() => (document.getElementById('cron-input-modal') as AppBridgeModal | null)?.hide()}>Close</button>
      </ui-title-bar>
    </ui-modal>

    <s-page heading="Crons">
      <s-section padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Name</s-table-header>
            <s-table-header listSlot="secondary">Schedule</s-table-header>
            <s-table-header listSlot="labeled">Shops</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header></s-table-header>
          </s-table-header-row>
          <s-table-body>
            {crons.length === 0 && (
              <s-table-row>
                <s-table-cell><s-text color="subdued">No crons configured</s-text></s-table-cell>
                <s-table-cell />
                <s-table-cell />
                <s-table-cell />
                <s-table-cell />
              </s-table-row>
            )}
            {crons.map((c) => (
              <s-table-row key={c.key}>
                <s-table-cell>
                  <strong>{c.name ?? c.flow}</strong>
                  {c.name && <div style={{ fontSize: '12px', color: '#8c9196' }}>{c.flow}</div>}
                </s-table-cell>
                <s-table-cell>
                  <code style={{ fontSize: '13px', background: '#f1f1f1', padding: '2px 6px', borderRadius: '4px' }}>
                    {c.schedule}
                  </code>
                </s-table-cell>
                <s-table-cell>{shopsLabel(c.shops)}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={c.enabled ? 'success' : 'neutral'}>
                    {c.enabled ? 'Enabled' : 'Disabled'}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>
                  <span style={{ display: 'flex', gap: '6px' }}>
                    {c.input && (
                      <s-button variant="secondary" onClick={() => showInput(c)}>Input</s-button>
                    )}
                    <s-button
                      variant={c.enabled ? 'secondary' : 'primary'}
                      onClick={() => toggle(c)}
                      disabled={toggling === c.key}
                    >
                      {toggling === c.key ? '...' : c.enabled ? 'Disable' : 'Enable'}
                    </s-button>
                  </span>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
    </>
  )
}
