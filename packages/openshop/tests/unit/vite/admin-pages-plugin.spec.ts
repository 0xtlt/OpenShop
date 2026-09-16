import { test } from '@japa/runner'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { renderAdminActionsClientModule } from '../../../src/vite/admin-pages-plugin.ts'

test('renders typed client references without server handler code', ({ assert }) => {
  const directory = mkdtempSync(join(tmpdir(), 'openshop-admin-plugin-'))
  try {
    const serverFile = join(directory, 'actions.server.ts')
    writeFileSync(serverFile, `
      export const load = defineAdminLoader({
        handler: () => ({ secret: process.env.SECRET }),
      })
      export const save = defineAdminAction({
        input: schema,
        handler: () => ({ ok: true }),
      })
    `)
    const result = renderAdminActionsClientModule({
      id: 'reviews',
      path: '/reviews',
      routePattern: '/reviews',
      sourceFile: join(directory, 'page.tsx'),
      serverFile,
    })

    assert.include(result, 'export const load = createAdminFunctionReference({ kind: "loader"')
    assert.include(result, 'export const save = createAdminFunctionReference({ kind: "action"')
    assert.notInclude(result, 'process.env.SECRET')
    assert.notInclude(result, 'handler:')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
