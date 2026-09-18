import { type } from 'arktype'
import {
  defineAdminAction,
  defineAdminLoader,
  defineAdminPageAccess,
} from 'openshop/admin'

export const pageAccess = defineAdminPageAccess(({ actor }) => actor.id.length > 0)

export const listReviews = defineAdminLoader({
  handler: ({ shop }) => ({
    reviews: [
      { id: 'example', title: 'Example review', shop },
    ],
  }),
})

export const saveReview = defineAdminAction({
  input: type({
    title: 'string > 0',
  }),
  authorize: pageAccess,
  handler: ({ actor }, input) => ({
    ok: true,
    title: input.title,
    savedBy: actor.id,
  }),
})
