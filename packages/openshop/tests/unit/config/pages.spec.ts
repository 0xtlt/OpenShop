import { test } from '@japa/runner'
import {
  adminPageFromApiPath,
  adminPageFromUiPath,
  resolveAdminPages,
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
