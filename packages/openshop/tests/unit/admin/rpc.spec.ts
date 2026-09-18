import { test } from '@japa/runner'
import { buildAdminFunctionRpcUrl } from '../../../src/admin/rpc.ts'

test('builds loader RPC URLs from the current dynamic pathname', ({ assert }) => {
  assert.equal(
    buildAdminFunctionRpcUrl('loader', 'review details', '/reviews/1'),
    '/api/pages/custom/reviews/1/_rpc/loader/review%20details',
  )
  assert.equal(
    buildAdminFunctionRpcUrl('loader', 'review details', '/reviews/2'),
    '/api/pages/custom/reviews/2/_rpc/loader/review%20details',
  )
})
