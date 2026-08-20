import { test } from '@japa/runner'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { watchAppDirectories } from '../../../src/cli/dev-watch.ts'

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for filesystem event')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test('watches a user directory created after startup', async ({ assert }) => {
  const cwd = mkdtempSync(join(tmpdir(), 'openshop-dev-watch-'))
  const events: string[] = []
  const stop = watchAppDirectories(cwd, ['routes'], (source) => events.push(source))

  try {
    mkdirSync(join(cwd, 'routes'))
    await waitFor(() => events.some((source) => source === 'routes'))

    writeFileSync(join(cwd, 'routes', 'callback.ts'), '', 'utf8')
    await waitFor(() => events.some((source) => source === 'callback.ts'))

    assert.includeMembers(events, ['routes', 'callback.ts'])
  } finally {
    stop()
    rmSync(cwd, { recursive: true, force: true })
  }
})
