import { type } from 'arktype'
import { defineOpenShop } from '../../src/index.ts'

const app = defineOpenShop({ providers: {} })

const discount = app.defineFunction({
  type: 'discount',
  handle: 'volume-discount',
  modes: ['automatic', 'code'],
  label: 'Volume discount',
  config: {
    threshold: { type: 'number', label: 'Threshold', validate: type('number') },
  },
  defaults: {
    title: (config) => `Buy ${config.threshold.toFixed(0)} or more`,
    startsAt: '2026-08-25T00:00:00Z',
    endsAt: null,
    usageLimit: 100,
    combinesWith: { productDiscounts: true },
  },
  ui: { configurationPath: '/bundles/:id', configurationLabel: 'Configure bundle' },
})

const cartTransform = app.defineFunction({
  type: 'cart-transform',
  handle: 'bundle-cart-transform',
  defaults: { blockOnFailure: true },
})

const deliveryCustomization = app.defineFunction({
  type: 'delivery-customization',
  handle: 'delivery-options',
  defaults: { title: 'Delivery options', enabled: true },
})

const paymentCustomization = app.defineFunction({
  type: 'payment-customization',
  handle: 'payment-options',
  defaults: { title: 'Payment options', enabled: false },
})

const checkoutValidation = app.defineFunction({
  type: 'checkout-validation',
  handle: 'checkout-rules',
  defaults: { title: 'Checkout rules', enabled: true, blockOnFailure: false },
})

const fulfillmentConstraints = app.defineFunction({
  type: 'fulfillment-constraints',
  handle: 'fulfillment-rules',
  defaults: { deliveryMethodTypes: ['SHIPPING', 'PICK_UP'] },
})

void [discount, cartTransform, deliveryCustomization, paymentCustomization, checkoutValidation, fulfillmentConstraints]

// @ts-expect-error Cart Transform has no Shopify title.
app.defineFunction({ type: 'cart-transform', handle: 'cart', defaults: { title: 'Unsupported' } })

// @ts-expect-error Delivery customization does not expose blockOnFailure.
app.defineFunction({ type: 'delivery-customization', handle: 'delivery', defaults: { blockOnFailure: true } })

// @ts-expect-error Payment customization does not expose delivery method types.
app.defineFunction({ type: 'payment-customization', handle: 'payment', defaults: { deliveryMethodTypes: ['SHIPPING'] } })

// @ts-expect-error Fulfillment constraints do not expose enabled.
app.defineFunction({ type: 'fulfillment-constraints', handle: 'fulfillment', defaults: { enabled: true } })

// @ts-expect-error Discount modes are only valid for discounts.
app.defineFunction({ type: 'checkout-validation', handle: 'validation', modes: ['automatic'] })

// @ts-expect-error owner was removed in favor of type-specific defaults.
app.defineFunction({ type: 'discount', handle: 'legacy', owner: { title: 'Legacy' } })
