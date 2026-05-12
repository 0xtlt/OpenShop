export class FlowCanceledError extends Error {
  constructor() {
    super('Flow was canceled')
    this.name = 'FlowCanceledError'
  }
}

export class StepTimeoutError extends Error {
  constructor(public stepName: string, public timeoutMs: number) {
    super(`Step "${stepName}" timed out after ${timeoutMs}ms`)
    this.name = 'StepTimeoutError'
  }
}

export class FlowTimeoutError extends Error {
  constructor(public flowName: string, public timeoutMs: number) {
    super(`Flow "${flowName}" timed out after ${timeoutMs}ms`)
    this.name = 'FlowTimeoutError'
  }
}

export class FlowConcurrencyError extends Error {
  constructor(public flowName: string, public shop: string, public existingRunId: string) {
    super(`Flow "${flowName}" is already running for shop "${shop}" (run #${existingRunId})`)
    this.name = 'FlowConcurrencyError'
  }
}

export class SleepSignal extends Error {
  readonly resumeAt: Date
  constructor(resumeAt: Date) {
    super(`Flow sleeping until ${resumeAt.toISOString()}`)
    this.name = 'SleepSignal'
    this.resumeAt = resumeAt
  }
}
