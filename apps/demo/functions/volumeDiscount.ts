import { type } from 'arktype'
import { app } from '#app'

export const volumeDiscount = app.defineFunction({
  type: 'discount',
  handle: 'volume-discount',
  modes: ['automatic', 'code'],

  label: 'Volume discount',
  defaults: {
    title: (config) => `${config.percentage}% off ${config.minQuantity}+ items`,
    combinesWith: {
      productDiscounts: true,
      orderDiscounts: false,
      shippingDiscounts: true,
    },
  },

  config: {
    minQuantity: {
      type: 'number',
      label: 'Minimum quantity',
      validate: type('number.integer >= 1'),
    },
    percentage: {
      type: 'number',
      label: 'Discount percentage',
      validate: type('number >= 0 & number <= 100'),
    },
    excludedTags: {
      type: 'text',
      label: 'Excluded product tags',
      placeholder: 'gift, sample',
    },
  },
})
