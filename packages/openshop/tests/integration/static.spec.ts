import { test } from '@japa/runner'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from '#server/index'
import { createConfig, truncateAll } from './helpers.ts'

const simpleFlow = { name: 'static-flow', async run() {} }

test.group('Static files and SPA fallback', (group) => {
  let staticRoot: string
  let app: Awaited<ReturnType<typeof createServer>>

  group.setup(async () => {
    staticRoot = mkdtempSync(join(tmpdir(), 'openshop-static-test-'))
    writeFileSync(join(staticRoot, 'index.html'), '<html><body>spa-shell</body></html>', 'utf8')
    writeFileSync(join(staticRoot, 'asset.txt'), 'plain asset', 'utf8')
    const config = createConfig({ 'static-flow': simpleFlow })
    app = await createServer(() => config, { staticDir: staticRoot })
  })

  group.teardown(() => {
    rmSync(staticRoot, { recursive: true, force: true })
  })

  group.each.setup(() => truncateAll())

  test('GET serves file from staticDir', async ({ assert }) => {
    const res = await app.request('http://localhost/asset.txt')
    assert.equal(res.status, 200)
    assert.include(await res.text(), 'plain asset')
  })

  test('GET unknown path falls back to index.html', async ({ assert }) => {
    const res = await app.request('http://localhost/admin/deep/route')
    assert.equal(res.status, 200)
    const text = await res.text()
    assert.include(text, 'spa-shell')
  })
})
