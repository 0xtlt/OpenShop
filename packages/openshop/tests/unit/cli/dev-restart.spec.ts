import { EventEmitter } from 'node:events'
import { test } from '@japa/runner'
import { ApiProcessRestartCoordinator } from '../../../src/cli/dev-restart.ts'

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

class FakeProcess extends EventEmitter {
  exitCode: number | null = null
  pid?: number
  killSignals: NodeJS.Signals[] = []

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.killSignals.push(signal)

    if (signal === 'SIGKILL') {
      setTimeout(() => this.emitExit(137, 'SIGKILL'), 0)
    }

    return true
  }

  emitMessage(message: unknown) {
    this.emit('message', message)
  }

  emitExit(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    this.exitCode = code
    this.emit('exit', code, signal)
  }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

test.group('dev restart coordinator', () => {
  test('coalesces concurrent reload requests into one queued follow-up restart', async ({ assert }) => {
    const initial = new FakeProcess(1)
    const spawnQueue: Array<{ process: FakeProcess; ready: ReturnType<typeof createDeferred> }> = []
    const queuedReasons: string[] = []

    const coordinator = new ApiProcessRestartCoordinator<FakeProcess>({
      spawn: () => {
        const process = new FakeProcess(spawnQueue.length + 2)
        const ready = createDeferred()
        spawnQueue.push({ process, ready })
        return { process, ready: ready.promise }
      },
      onQueuedRestart: (reason) => queuedReasons.push(reason),
      listenerCloseTimeoutMs: 25,
      processExitGraceMs: 50,
    }, initial)

    const firstRestart = coordinator.requestRestart('flows/test.ts')
    const secondRestart = coordinator.requestRestart('providers/test.ts')
    const thirdRestart = coordinator.requestRestart('functions/test.ts')

    assert.deepEqual(queuedReasons, ['providers/test.ts'])
    assert.equal(spawnQueue.length, 0)

    initial.emitMessage('listener-closed')
    await flushMicrotasks()

    assert.equal(spawnQueue.length, 1)
    assert.deepEqual(initial.killSignals, ['SIGTERM'])

    spawnQueue[0]!.ready.resolve()
    await flushMicrotasks()

    assert.deepEqual(spawnQueue[0]!.process.killSignals, ['SIGTERM'])

    spawnQueue[0]!.process.emitMessage('listener-closed')
    await flushMicrotasks()

    assert.equal(spawnQueue.length, 2)

    spawnQueue[1]!.ready.resolve()
    await Promise.all([firstRestart, secondRestart, thirdRestart])

    assert.equal(coordinator.currentProcess?.pid, spawnQueue[1]!.process.pid)
  })

  test('waits for listener closure before respawning', async ({ assert }) => {
    const initial = new FakeProcess(10)
    const ready = createDeferred()
    let spawnCount = 0

    const coordinator = new ApiProcessRestartCoordinator<FakeProcess>({
      spawn: () => {
        spawnCount++
        return { process: new FakeProcess(11), ready: ready.promise }
      },
      listenerCloseTimeoutMs: 25,
      processExitGraceMs: 50,
    }, initial)

    const restartPromise = coordinator.requestRestart('proxy/route.ts')
    await flushMicrotasks()

    assert.equal(spawnCount, 0)

    initial.emitMessage('listener-closed')
    await flushMicrotasks()

    assert.equal(spawnCount, 1)

    ready.resolve()
    await restartPromise
  })

  test('force-kills stale processes that stay alive after listener closure', async ({ assert }) => {
    const initial = new FakeProcess(20)
    const forcedKills: number[] = []

    const coordinator = new ApiProcessRestartCoordinator<FakeProcess>({
      spawn: () => ({
        process: new FakeProcess(21),
        ready: Promise.resolve(),
      }),
      onForceKill: (process) => {
        if (process.pid) forcedKills.push(process.pid)
      },
      listenerCloseTimeoutMs: 25,
      processExitGraceMs: 20,
    }, initial)

    const restartPromise = coordinator.requestRestart('functions/reload.ts')
    initial.emitMessage('listener-closed')
    await flushMicrotasks()
    await restartPromise
    await new Promise((r) => setTimeout(r, 40))

    assert.deepEqual(initial.killSignals, ['SIGTERM', 'SIGKILL'])
    assert.deepEqual(forcedKills, [20])
  })
})
