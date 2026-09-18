import { defineAdminPage, useLoader } from 'openshop/admin'
import { reviewDetails } from './actions.server.ts'

function ReviewDetailsPage({ id }: { id: string }) {
  const review = useLoader(reviewDetails, undefined)
  return (
    <s-page heading={review.data?.title ?? `Review ${id}`}>
      {review.loading && <s-spinner accessibilityLabel="Loading review" />}
      {review.error && <s-banner tone="critical">{review.error.message}</s-banner>}
      {review.data && <s-paragraph>Shop: {review.data.shop}</s-paragraph>}
    </s-page>
  )
}

export default defineAdminPage({
  title: 'Review details',
  component: ReviewDetailsPage,
})
