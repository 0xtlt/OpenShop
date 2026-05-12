const controllers = new Map<string, AbortController>()

export function registerAbort(runId: string): AbortSignal {
  const ctrl = new AbortController()
  controllers.set(runId, ctrl)
  return ctrl.signal
}

export function cancelRun(runId: string): boolean {
  const ctrl = controllers.get(runId)
  if (!ctrl) return false
  ctrl.abort()
  controllers.delete(runId)
  return true
}

export function cleanupAbort(runId: string): void {
  controllers.delete(runId)
}
