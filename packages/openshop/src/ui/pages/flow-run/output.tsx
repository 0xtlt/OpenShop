import type { StepResult } from '../../types'
import { statusTone } from '../../types'

interface AppBridgeModal extends HTMLElement {
  show(): void
  hide(): void
}

const MAX_OUTPUT_CHARS = 2000

function formatSize(json: string): string {
  const bytes = new Blob([json]).size
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function buildStepRows(steps: StepResult[]) {
  const sorted = [...steps].sort((a, b) => {
    const timeDiff = new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()
    if (timeDiff !== 0) return timeDiff
    return a.id.localeCompare(b.id)
  })

  const baseIndexByName = new Map<string, number>()
  const occurrencesByName = new Map<string, number>()

  return sorted.map((step) => {
    let baseIndex = baseIndexByName.get(step.stepName)
    if (!baseIndex) {
      baseIndex = baseIndexByName.size + 1
      baseIndexByName.set(step.stepName, baseIndex)
    }

    const occurrence = (occurrencesByName.get(step.stepName) ?? 0) + 1
    occurrencesByName.set(step.stepName, occurrence)

    return {
      step,
      label: occurrence === 1 ? String(baseIndex) : `${baseIndex}.${occurrence}`,
      isRetry: occurrence > 1,
    }
  })
}

export function StepRow({ step, label, isRetry }: { step: StepResult; label: string; isRetry: boolean }) {
  const hasOutput = step.output != null

  return (
    <s-table-row>
      <s-table-cell>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: '20px', height: '20px', borderRadius: '999px',
            padding: '0 6px',
            background: '#f1f1f1', fontSize: '11px', fontWeight: 700, color: '#616161', flexShrink: 0,
          }}>
            {label}
          </span>
          <strong>{step.stepName}</strong>
          {isRetry && <span style={{ color: '#8c9196', fontSize: '12px' }}>retry</span>}
        </span>
      </s-table-cell>
      <s-table-cell>
        <s-badge tone={statusTone[step.status] ?? 'auto'}>{step.status}</s-badge>
      </s-table-cell>
      <s-table-cell>{step.durationMs != null ? `${step.durationMs}ms` : '—'}</s-table-cell>
      <s-table-cell>
        {step.error && <span style={{ color: '#d72c0d', fontSize: '13px' }}>{step.error}</span>}
        {hasOutput && (
          <s-button variant="secondary" onClick={() => {
            const modal = document.getElementById('output-modal') as AppBridgeModal | null
            if (!modal) return
            const pre = document.getElementById('output-modal-pre')
            const title = document.getElementById('output-modal-title')
            if (pre) {
              const full = JSON.stringify(step.output, null, 2)
              const truncated = full.length > MAX_OUTPUT_CHARS
              pre.textContent = truncated ? full.slice(0, MAX_OUTPUT_CHARS) + '\n…' : full
              pre.dataset.full = full
              pre.dataset.stepName = step.stepName
              pre.dataset.truncated = String(truncated)
              pre.dataset.size = formatSize(full)
              const sizeEl = document.getElementById('output-modal-size')
              if (sizeEl) sizeEl.textContent = formatSize(full)
            }
            if (title) title.setAttribute('title', `Output — ${step.stepName}`)
            modal.show()
          }}>
            Output
          </s-button>
        )}
      </s-table-cell>
    </s-table-row>
  )
}

export function OutputModal() {
  return (
    <ui-modal id="output-modal">
      <div style={{ padding: '16px' }}>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          <s-button variant="secondary" onClick={() => {
            const pre = document.getElementById('output-modal-pre')
            if (pre?.dataset.full) navigator.clipboard.writeText(pre.dataset.full)
          }}>
            Copy
          </s-button>
          <s-button variant="secondary" onClick={() => {
            const pre = document.getElementById('output-modal-pre')
            if (!pre?.dataset.full) return
            const blob = new Blob([pre.dataset.full], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `${pre.dataset.stepName ?? 'output'}.json`
            a.click()
            URL.revokeObjectURL(a.href)
          }}>
            Download
          </s-button>
          <span id="output-modal-size" style={{ color: '#8c9196', fontSize: '12px', alignSelf: 'center', marginLeft: 'auto' }} />
        </div>
        <pre
          id="output-modal-pre"
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
      <ui-title-bar id="output-modal-title" title="Output">
        <button onClick={() => (document.getElementById('output-modal') as AppBridgeModal | null)?.hide()}>Close</button>
      </ui-title-bar>
    </ui-modal>
  )
}
