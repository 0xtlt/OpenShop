type ManagedProcessMessage = 'listener-closed'

type ManagedProcessEvents = {
  exit: [code: number | null, signal: NodeJS.Signals | null]
  message: [message: unknown]
}

export interface ManagedProcess {
  exitCode?: number | null
  pid?: number
  kill(signal?: NodeJS.Signals): boolean
  on<Event extends keyof ManagedProcessEvents>(event: Event, listener: (...args: ManagedProcessEvents[Event]) => void): this
  once<Event extends keyof ManagedProcessEvents>(event: Event, listener: (...args: ManagedProcessEvents[Event]) => void): this
  off<Event extends keyof ManagedProcessEvents>(event: Event, listener: (...args: ManagedProcessEvents[Event]) => void): this
}

export interface SpawnedProcess<TProcess extends ManagedProcess> {
  process: TProcess
  ready: Promise<void>
}

interface ApiProcessRestartCoordinatorOptions<TProcess extends ManagedProcess> {
  spawn: () => SpawnedProcess<TProcess>
  listenerCloseTimeoutMs?: number
  processExitGraceMs?: number
  onQueuedRestart?: (reason: string) => void
  onRestartStart?: (reason: string, currentProcess: TProcess | null) => void
  onListenerClosed?: (process: TProcess, via: 'message' | 'exit') => void
  onListenerCloseTimeout?: (process: TProcess) => void
  onRespawn?: (process: TProcess) => void
  onForceKill?: (process: TProcess) => void
}

const DEFAULT_LISTENER_CLOSE_TIMEOUT_MS = 5_000
const DEFAULT_PROCESS_EXIT_GRACE_MS = 35_000

export class ApiProcessRestartCoordinator<TProcess extends ManagedProcess> {
  #currentProcess: TProcess | null
  #restartPromise: Promise<void> | null = null
  #pendingReason: string | null = null
  #options: Required<Pick<ApiProcessRestartCoordinatorOptions<TProcess>, 'spawn' | 'listenerCloseTimeoutMs' | 'processExitGraceMs'>> &
    Omit<ApiProcessRestartCoordinatorOptions<TProcess>, 'spawn' | 'listenerCloseTimeoutMs' | 'processExitGraceMs'>

  constructor(options: ApiProcessRestartCoordinatorOptions<TProcess>, currentProcess: TProcess | null = null) {
    this.#options = {
      ...options,
      listenerCloseTimeoutMs: options.listenerCloseTimeoutMs ?? DEFAULT_LISTENER_CLOSE_TIMEOUT_MS,
      processExitGraceMs: options.processExitGraceMs ?? DEFAULT_PROCESS_EXIT_GRACE_MS,
    }
    this.#currentProcess = currentProcess
  }

  get currentProcess() {
    return this.#currentProcess
  }

  async requestRestart(reason: string): Promise<void> {
    if (this.#restartPromise) {
      if (!this.#pendingReason) {
        this.#pendingReason = reason
        this.#options.onQueuedRestart?.(reason)
      }
      return this.#restartPromise
    }

    this.#restartPromise = this.#runRestartLoop(reason)
    try {
      await this.#restartPromise
    } finally {
      this.#restartPromise = null
    }
  }

  async #runRestartLoop(initialReason: string): Promise<void> {
    let reason: string | null = initialReason

    while (reason) {
      this.#pendingReason = null
      this.#options.onRestartStart?.(reason, this.#currentProcess)

      if (this.#currentProcess) {
        await this.#stopCurrentProcessForRestart(this.#currentProcess)
      }

      const nextProcess = this.#options.spawn()
      this.#currentProcess = nextProcess.process
      this.#options.onRespawn?.(nextProcess.process)
      await nextProcess.ready

      reason = this.#pendingReason
    }
  }

  async #stopCurrentProcessForRestart(process: TProcess): Promise<void> {
    if (!hasExited(process)) {
      process.kill('SIGTERM')
    }

    const listenerState = await waitForListenerClosedOrExit(process, this.#options.listenerCloseTimeoutMs)

    if (listenerState === 'timeout') {
      this.#options.onListenerCloseTimeout?.(process)
      await waitForExitWithGrace(process, this.#options.processExitGraceMs, () => {
        this.#options.onForceKill?.(process)
      })
      return
    }

    this.#options.onListenerClosed?.(process, listenerState)
    scheduleForceKill(process, this.#options.processExitGraceMs, () => {
      this.#options.onForceKill?.(process)
    })
  }
}

function hasExited(process: ManagedProcess): boolean {
  return process.exitCode !== undefined && process.exitCode !== null
}

async function waitForListenerClosedOrExit(process: ManagedProcess, timeoutMs: number): Promise<'message' | 'exit' | 'timeout'> {
  if (hasExited(process)) return 'exit'

  return await new Promise((resolve) => {
    const onMessage = (message: unknown) => {
      if (message !== 'listener-closed') return
      cleanup()
      resolve('message')
    }

    const onExit = () => {
      cleanup()
      resolve('exit')
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve('timeout')
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      process.off('message', onMessage)
      process.off('exit', onExit)
    }

    process.on('message', onMessage)
    process.once('exit', onExit)
  })
}

async function waitForExitWithGrace(process: ManagedProcess, timeoutMs: number, onForceKill: () => void): Promise<void> {
  if (hasExited(process)) return

  await new Promise<void>((resolve) => {
    const onExit = () => {
      clearTimeout(timer)
      resolve()
    }

    const timer = setTimeout(() => {
      onForceKill()
      process.kill('SIGKILL')
    }, timeoutMs)

    process.once('exit', onExit)
  })
}

function scheduleForceKill(process: ManagedProcess, timeoutMs: number, onForceKill: () => void): void {
  if (hasExited(process)) return

  const timer = setTimeout(() => {
    if (hasExited(process)) return
    onForceKill()
    process.kill('SIGKILL')
  }, timeoutMs)

  process.once('exit', () => clearTimeout(timer))
}

export const DEV_RESTART_INTERNALS = {
  waitForListenerClosedOrExit,
  waitForExitWithGrace,
  scheduleForceKill,
}
