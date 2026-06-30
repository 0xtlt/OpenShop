import { app } from '#app'

export default app.defineProxy({
  type: 'liquid',

  async GET({ shop }) {
    return `
      <div class="openshop-reviews">
        <h2>Customer Reviews for {{ shop.name }}</h2>
        <p>Reviews loaded via OpenShop App Proxy from ${shop}</p>
        {% if customer %}
          <p>Hello {{ customer.first_name }}! Leave a review below.</p>
        {% endif %}
      </div>
    `
  },
})
