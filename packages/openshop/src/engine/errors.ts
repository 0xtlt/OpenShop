export class FlowCanceledError extends Error {
  constructor() {
    super('Flow was canceled')
    this.name = 'FlowCanceledError'
  }
}

export class StepTimeoutError extends Error {
  readonly stepName: string
  readonly timeoutMs: number

  constructor(stepName: string, timeoutMs: number) {
    super(`Step "${stepName}" timed out after ${timeoutMs}ms`)
    this.name = 'StepTimeoutError'
    this.stepName = stepName
    this.timeoutMs = timeoutMs
  }
}

export class FlowTimeoutError extends Error {
  readonly flowName: string
  readonly timeoutMs: number

  constructor(flowName: string, timeoutMs: number) {
    super(`Flow "${flowName}" timed out after ${timeoutMs}ms`)
    this.name = 'FlowTimeoutError'
    this.flowName = flowName
    this.timeoutMs = timeoutMs
  }
}

export class FlowConcurrencyError extends Error {
  readonly flowName: string
  readonly shop: string
  readonly existingRunId: string

  constructor(flowName: string, shop: string, existingRunId: string) {
    super(`Flow "${flowName}" is already running for shop "${shop}" (run #${existingRunId})`)
    this.name = 'FlowConcurrencyError'
    this.flowName = flowName
    this.shop = shop
    this.existingRunId = existingRunId
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
