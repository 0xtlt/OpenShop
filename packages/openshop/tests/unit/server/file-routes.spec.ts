import { test } from '@japa/runner'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanRouteDir } from '../../../src/server/file-routes.ts'

test.group('file route scanner', (group) => {
  let routesDir: string

  group.each.setup(() => {
    routesDir = mkdtempSync(join(tmpdir(), 'openshop-file-routes-'))
    return () => rmSync(routesDir, { recursive: true, force: true })
  })

  test('maps files, ignores private entries, and prioritizes static routes', ({ assert }) => {
    writeFileSync(join(routesDir, 'index.ts'), '', 'utf8')
    writeFileSync(join(routesDir, '_private.ts'), '', 'utf8')
    mkdirSync(join(routesDir, '_shared'))
    writeFileSync(join(routesDir, '_shared', 'hidden.ts'), '', 'utf8')
    mkdirSync(join(routesDir, 'orders'))
    writeFileSync(join(routesDir, 'orders', '[id].ts'), '', 'utf8')
    writeFileSync(join(routesDir, 'orders', 'new.ts'), '', 'utf8')

    const routes = scanRouteDir(routesDir)

    assert.deepEqual(routes.map(({ routePath }) => routePath), [
      '/orders/new',
      '/orders/:id',
      '/',
    ])
  })
})
