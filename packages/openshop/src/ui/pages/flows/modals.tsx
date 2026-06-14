import type { ComponentChildren, JSX } from 'preact'
import { eventValue } from '../../events'

interface AppBridgeModal extends HTMLElement {
  show(): void
  hide(): void
}

export function getModal(id: string): AppBridgeModal | null {
  return document.getElementById(id) as AppBridgeModal | null
}

type ModalButtonProps = {
  children: ComponentChildren
  variant?: 'primary'
  tone?: 'critical'
  onClick?: () => void | Promise<void>
  disabled?: boolean
}

function ModalButton({ children, ...buttonProps }: ModalButtonProps) {
  return <button {...(buttonProps as JSX.HTMLAttributes<HTMLButtonElement>)}>{children}</button>
}

interface RunFlowModalProps {
  selected: string | null
  inputJson: string
  inputError: string | null
  triggering: boolean
  setInputJson: (value: string) => void
  setInputError: (value: string | null) => void
  triggerRun: () => Promise<void>
}

export function RunFlowModal({
  selected,
  inputJson,
  inputError,
  triggering,
  setInputJson,
  setInputError,
  triggerRun,
}: RunFlowModalProps) {
  return (
    <ui-modal id="run-modal">
      <div style={{ padding: '16px' }}>
        <label htmlFor="flow-input-json" style={{ display: 'block', marginBottom: '4px', fontWeight: 600, fontSize: '13px' }}>Input (JSON)</label>
        <textarea
          id="flow-input-json"
          value={inputJson}
          onInput={(event) => { setInputJson(eventValue(event)); setInputError(null) }}
          placeholder='{ "limit": 10 }'
          rows={6}
          aria-invalid={Boolean(inputError)}
          aria-describedby={inputError ? 'flow-input-json-error' : undefined}
          style={{
            width: '100%',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '13px',
            padding: '8px 12px',
            borderRadius: '8px',
            border: inputError ? '2px solid #d72c0d' : '1px solid #c9cccf',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        {inputError && <span id="flow-input-json-error" style={{ color: '#d72c0d', fontSize: '12px' }}>{inputError}</span>}
      </div>
      <ui-title-bar title={`Run ${selected ?? ''}`}>
        <ModalButton variant="primary" onClick={triggerRun} disabled={triggering}>
          {triggering ? 'Running…' : 'Run'}
        </ModalButton>
        <ModalButton onClick={() => getModal('run-modal')?.hide()}>Cancel</ModalButton>
      </ui-title-bar>
    </ui-modal>
  )
}

interface DeleteRunsModalProps {
  checkedCount: number
  deleting: boolean
  bulkDelete: () => Promise<void>
}

export function DeleteRunsModal({ checkedCount, deleting, bulkDelete }: DeleteRunsModalProps) {
  return (
    <ui-modal id="delete-modal">
      <div style={{ padding: '16px' }}>
        <s-text>Are you sure you want to delete {checkedCount} run(s)? This action cannot be undone.</s-text>
      </div>
      <ui-title-bar title="Delete runs">
        <ModalButton variant="primary" tone="critical" onClick={bulkDelete} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete'}
        </ModalButton>
        <ModalButton onClick={() => getModal('delete-modal')?.hide()}>Cancel</ModalButton>
      </ui-title-bar>
    </ui-modal>
  )
}
