import { test } from '@japa/runner'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildServerApp, resolveBuiltRoutesDir } from '../../../src/cli/app-build.ts'

test.group('server app build', (group) => {
  let cwd: string

  group.each.setup(() => {
    cwd = mkdtempSync(join(tmpdir(), 'openshop-app-build-'))
    return () => rmSync(cwd, { recursive: true, force: true })
  })

  test('bundles config, proxy files, and public route files', async ({ assert }) => {
    writeFileSync(join(cwd, 'openshop.config.ts'), 'export default { providers: {}, flows: {} }', 'utf8')
    mkdirSync(join(cwd, 'proxy'))
    writeFileSync(join(cwd, 'proxy', 'reviews.ts'), 'export default { GET: () => ({ ok: true }) }', 'utf8')
    mkdirSync(join(cwd, 'routes'))
    writeFileSync(join(cwd, 'routes', 'callback.ts'), "export default { auth: 'none', POST: () => new Response() }", 'utf8')

    await buildServerApp(cwd)

    assert.isTrue(existsSync(join(cwd, 'dist/openshop/server/openshop.config.js')))
    assert.isTrue(existsSync(join(cwd, 'dist/openshop/server/proxy/reviews.js')))
    assert.isTrue(existsSync(join(cwd, 'dist/openshop/server/routes/callback.js')))
    assert.equal(resolveBuiltRoutesDir(cwd), join(cwd, 'dist/openshop/server/routes'))
  })
})
