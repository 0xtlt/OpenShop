import { defineAdminPage, useAction, useLoader } from 'openshop'
import { listReviews, saveReview } from './actions.server.ts'

function ReviewsPage() {
  const reviews = useLoader(listReviews, undefined)
  const save = useAction(saveReview)

  return (
    <s-page heading="Reviews">
      {reviews.loading && <s-spinner accessibilityLabel="Loading reviews" />}
      {reviews.error && <s-banner tone="critical">{reviews.error.message}</s-banner>}
      {reviews.data?.reviews.map((review) => (
        <s-section key={review.id} heading={review.title}>
          <s-paragraph>{review.shop}</s-paragraph>
        </s-section>
      ))}
      <s-button
        variant="primary"
        loading={save.pending}
        onClick={() => {
          void save.invoke(
            { title: 'Saved from custom admin' },
            { revalidate: [listReviews] },
          ).then((result) => {
            if (result) window.shopify?.toast?.show(`Saved ${result.title}`)
          })
        }}
      >
        Save example
      </s-button>
      {save.error && <s-banner tone="critical">{save.error.message}</s-banner>}
    </s-page>
  )
}

export default defineAdminPage({
  title: 'Reviews',
  component: ReviewsPage,
})
