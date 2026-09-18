import { test } from '@japa/runner'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  discoverCustomAdminPages,
  validateCustomAdminNavigation,
} from '../../../src/cli/admin-pages.ts'
import { customAdminRouteShapeKey } from '../../../src/config/custom-pages.ts'

test('custom admin route shape ignores dynamic parameter names', ({ assert }) => {
  assert.equal(
    customAdminRouteShapeKey('/orders/:id/items/:itemId'),
    customAdminRouteShapeKey('/orders/:orderId/items/:sku'),
  )
  assert.notEqual(
    customAdminRouteShapeKey('/reviews/:id'),
    customAdminRouteShapeKey('/products/:id'),
  )
  assert.notEqual(
    customAdminRouteShapeKey('/reviews'),
    customAdminRouteShapeKey('/reviews/:id'),
  )
})

test.group('custom admin page discovery', (group) => {
  let cwd: string

  group.each.setup(() => {
    cwd = mkdtempSync(join(tmpdir(), 'openshop-admin-pages-'))
    return () => rmSync(cwd, { recursive: true, force: true })
  })

  test('discovers static, nested, and dynamic pages', ({ assert }) => {
    mkdirSync(join(cwd, 'admin/pages/reviews/[id]'), { recursive: true })
    writeFileSync(join(cwd, 'admin/pages/reviews/page.tsx'), 'export default {}')
    writeFileSync(join(cwd, 'admin/pages/reviews/actions.server.ts'), 'export const load = {}')
    writeFileSync(join(cwd, 'admin/pages/reviews/[id]/page.tsx'), 'export default {}')

    const pages = discoverCustomAdminPages(cwd)
    const listPage = pages.find((page) => page.id === 'reviews')
    const detailPage = pages.find((page) => page.id === 'reviews/[id]')

    assert.deepInclude(listPage, {
      id: 'reviews',
      path: '/reviews',
      routePattern: '/reviews',
    })
    assert.deepInclude(detailPage, {
      id: 'reviews/[id]',
      path: '/reviews/[id]',
      routePattern: '/reviews/:id',
    })
    assert.equal(listPage?.serverFile, join(cwd, 'admin/pages/reviews/actions.server.ts'))
  })

  test('rejects routes that differ only by dynamic parameter names', ({ assert }) => {
    mkdirSync(join(cwd, 'admin/pages/reviews/[id]'), { recursive: true })
    mkdirSync(join(cwd, 'admin/pages/reviews/[slug]'), { recursive: true })
    writeFileSync(join(cwd, 'admin/pages/reviews/[id]/page.tsx'), 'export default {}')
    writeFileSync(join(cwd, 'admin/pages/reviews/[slug]/page.tsx'), 'export default {}')

    assert.throws(
      () => discoverCustomAdminPages(cwd),
      /routes "\/reviews\/:id" and "\/reviews\/:slug" have the same route shape/,
    )
  })

  test('rejects built-in and reserved routes', ({ assert }) => {
    mkdirSync(join(cwd, 'admin/pages/flows'), { recursive: true })
    writeFileSync(join(cwd, 'admin/pages/flows/page.tsx'), 'export default {}')
    assert.throws(() => discoverCustomAdminPages(cwd), /reserved or invalid/)
  })

  test('validates navigation against discovered static pages', ({ assert }) => {
    mkdirSync(join(cwd, 'admin/pages/reviews/[id]'), { recursive: true })
    writeFileSync(join(cwd, 'admin/pages/reviews/page.tsx'), 'export default {}')
    writeFileSync(join(cwd, 'admin/pages/reviews/[id]/page.tsx'), 'export default {}')
    const pages = discoverCustomAdminPages(cwd)

    assert.deepEqual(
      validateCustomAdminNavigation([{ label: 'Reviews', path: '/reviews' }], pages),
      [{ label: 'Reviews', path: '/reviews' }],
    )
    assert.throws(
      () => validateCustomAdminNavigation([{ label: 'Missing', path: '/missing' }], pages),
      /does not match a discovered page/,
    )
  })
})
