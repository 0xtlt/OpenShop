import { test } from '@japa/runner'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  adminPagesPlugin,
  isServerOnlyAdminPageImport,
  renderAdminActionsClientModule,
} from '../../../src/vite/admin-pages-plugin.ts'

test('renders typed client references without server handler code', ({ assert }) => {
  const directory = mkdtempSync(join(tmpdir(), 'openshop-admin-plugin-'))
  try {
    const serverFile = join(directory, 'actions.server.ts')
    writeFileSync(serverFile, `
      export const load: Loader = defineAdminLoader<{ query: string }, Result>({
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

test('rejects server-only page imports and rewrites local actions', ({ assert }) => {
  const directory = mkdtempSync(join(tmpdir(), 'openshop-admin-plugin-'))
  try {
    const sourceFile = join(directory, 'admin', 'pages', 'reviews', 'page.tsx')
    const serverFile = join(directory, 'admin', 'pages', 'reviews', 'actions.server.ts')
    const page = {
      id: 'reviews',
      path: '/reviews',
      routePattern: '/reviews',
      sourceFile,
      serverFile,
    }
    const plugin = adminPagesPlugin([page])
    const resolveId = plugin.resolveId
    if (typeof resolveId !== 'function') assert.fail('Expected a resolveId hook')
    const resolveImport = (source: string) => resolveId.call(
      {} as never,
      source,
      sourceFile,
      {} as never,
    )

    for (const source of ['#db/client', 'openshop', 'node:fs', '../other/actions.server.ts']) {
      assert.isTrue(isServerOnlyAdminPageImport(source))
      assert.throws(
        () => resolveImport(source),
        `Server-only import "${source}" is not allowed`,
      )
    }
    assert.equal(resolveImport('./actions.server.ts'), '\0virtual:openshop-admin-actions:reviews')
    assert.isFalse(isServerOnlyAdminPageImport('openshop/admin'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
