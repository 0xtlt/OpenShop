import { test } from '@japa/runner'
import {
  adminPageFromApiPath,
  adminPageFromUiPath,
  resolveAdminPages,
  sameAdminPages,
} from '../../../src/config/pages.ts'

test.group('resolveAdminPages', () => {
  test('defaults every page to visible', ({ assert }) => {
    assert.deepEqual(resolveAdminPages(), {
      flows: 'visible',
      providers: 'visible',
      crons: 'visible',
      functions: 'visible',
      mcp: 'visible',
    })
  })

  test('fills omitted pages with visible', ({ assert }) => {
    assert.deepEqual(resolveAdminPages({ functions: 'hidden', mcp: 'disabled' }), {
      flows: 'visible',
      providers: 'visible',
      crons: 'visible',
      functions: 'hidden',
      mcp: 'disabled',
    })
  })

  test('hides config-backed pages that have no resources', ({ assert }) => {
    assert.deepEqual(resolveAdminPages(undefined, {
      flows: {},
      providers: {},
      crons: [],
      functions: {},
    }), {
      flows: 'hidden',
      providers: 'hidden',
      crons: 'hidden',
      functions: 'hidden',
      mcp: 'visible',
    })
  })

  test('shows config-backed pages when resources exist', ({ assert }) => {
    assert.deepEqual(resolveAdminPages(undefined, {
      flows: { syncOrders: {} },
      providers: { warehouse: {} },
      crons: [{}],
      functions: { volumeDiscount: {} },
    }), {
      flows: 'visible',
      providers: 'visible',
      crons: 'visible',
      functions: 'visible',
      mcp: 'visible',
    })
  })

  test('preserves explicit hidden and disabled modes for empty pages', ({ assert }) => {
    assert.deepEqual(resolveAdminPages({
      flows: 'disabled',
      providers: 'hidden',
      crons: 'disabled',
      functions: 'hidden',
      mcp: 'disabled',
    }, {
      flows: {},
      providers: {},
      crons: [],
      functions: {},
    }), {
      flows: 'disabled',
      providers: 'hidden',
      crons: 'disabled',
      functions: 'hidden',
      mcp: 'disabled',
    })
  })
})

test.group('sameAdminPages', () => {
  test('compares resolved page modes', ({ assert }) => {
    const visible = resolveAdminPages()
    assert.isTrue(sameAdminPages(visible, resolveAdminPages()))
    assert.isFalse(sameAdminPages(visible, resolveAdminPages({ flows: 'hidden' })))
  })
})

test.group('adminPageFromApiPath', () => {
  test('maps admin API prefixes to pages', ({ assert }) => {
    assert.equal(adminPageFromApiPath('/api/flows'), 'flows')
    assert.equal(adminPageFromApiPath('/api/flows/sync/runs'), 'flows')
    assert.equal(adminPageFromApiPath('/api/runs/550e8400-e29b-41d4-a716-446655440000'), 'flows')
    assert.equal(adminPageFromApiPath('/api/providers'), 'providers')
    assert.equal(adminPageFromApiPath('/api/crons/toggle'), 'crons')
    assert.equal(adminPageFromApiPath('/api/functions'), 'functions')
    assert.equal(adminPageFromApiPath('/api/mcp/tokens'), 'mcp')
  })

  test('leaves ungated API paths unmapped', ({ assert }) => {
    assert.isNull(adminPageFromApiPath('/api/pages'))
    assert.isNull(adminPageFromApiPath('/health'))
    assert.isNull(adminPageFromApiPath('/mcp'))
  })
})

test.group('adminPageFromUiPath', () => {
  test('maps UI routes to pages', ({ assert }) => {
    assert.equal(adminPageFromUiPath('/flows'), 'flows')
    assert.equal(adminPageFromUiPath('/flows/sync'), 'flows')
    assert.equal(adminPageFromUiPath('/runs/550e8400-e29b-41d4-a716-446655440000'), 'flows')
    assert.equal(adminPageFromUiPath('/providers'), 'providers')
    assert.equal(adminPageFromUiPath('/crons'), 'crons')
    assert.equal(adminPageFromUiPath('/functions/discounts/new'), 'functions')
    assert.equal(adminPageFromUiPath('/mcp'), 'mcp')
  })

  test('leaves Home unmapped', ({ assert }) => {
    assert.isNull(adminPageFromUiPath('/'))
  })
})
