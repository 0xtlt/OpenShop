interface AppBridgeModal extends HTMLElement {
  hideOverlay(): void
}

interface RunActionModalsProps {
  retrying: boolean
  retryRun: (mode: 'resume' | 'reset') => Promise<void>
  deleteRun: () => Promise<void>
}

export function RunActionModals({ retrying, retryRun, deleteRun }: RunActionModalsProps) {
  return (
    <>
      <s-modal id="retry-modal" heading="Retry run" accessibility-label="Choose retry mode">
        <s-stack direction="block" gap="base">
          <s-text>How do you want to retry this run?</s-text>
          <s-button variant="primary" disabled={retrying} onClick={async () => {
            await retryRun('resume')
            ;(document.getElementById('retry-modal') as AppBridgeModal | null)?.hideOverlay()
          }}>
            Resume — pick up where it failed
          </s-button>
          <s-button variant="secondary" disabled={retrying} onClick={async () => {
            await retryRun('reset')
            ;(document.getElementById('retry-modal') as AppBridgeModal | null)?.hideOverlay()
          }}>
            Restart — discard steps and start fresh
          </s-button>
        </s-stack>
        <s-button slot="secondary-actions" variant="secondary" commandFor="retry-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>

      <s-modal id="delete-modal" heading="Delete run" accessibility-label="Confirm run deletion">
        <s-text>This will permanently delete this run, its steps, and all logs. This cannot be undone.</s-text>
        <s-button slot="primary-action" variant="primary" tone="critical" onClick={async () => {
          ;(document.getElementById('delete-modal') as AppBridgeModal | null)?.hideOverlay()
          await deleteRun()
        }}>
          Delete
        </s-button>
        <s-button slot="secondary-actions" variant="secondary" commandFor="delete-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </>
  )
}
