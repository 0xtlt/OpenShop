import { defineAdminLoader } from 'openshop/admin'

export { pageAccess } from '../actions.server.ts'

export const reviewDetails = defineAdminLoader({
  handler: ({ params, shop }) => ({
    id: params.id ?? '',
    title: `Review ${params.id ?? ''}`,
    shop,
  }),
})
