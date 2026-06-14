import type { DiscountMode, ShopifyFunctionType } from '#types'

export interface MutationSet {
  list: string
  create: string
  update: string | null
  delete: string
  inputStyle: 'wrapped' | 'flat'
}

export const DISCOUNT_MUTATIONS: Record<DiscountMode, MutationSet> = {
  automatic: {
    list: 'discountNodes',
    create: 'discountAutomaticAppCreate',
    update: 'discountAutomaticAppUpdate',
    delete: 'discountAutomaticDelete',
    inputStyle: 'wrapped',
  },
  code: {
    list: 'discountNodes',
    create: 'discountCodeAppCreate',
    update: 'discountCodeAppUpdate',
    delete: 'discountCodeDelete',
    inputStyle: 'wrapped',
  },
}

export const FUNCTION_MUTATIONS: Record<Exclude<ShopifyFunctionType, 'discount' | 'order-routing'>, MutationSet> = {
  'cart-transform': {
    list: 'cartTransforms',
    create: 'cartTransformCreate',
    update: null,
    delete: 'cartTransformDelete',
    inputStyle: 'flat',
  },
  'delivery-customization': {
    list: 'deliveryCustomizations',
    create: 'deliveryCustomizationCreate',
    update: 'deliveryCustomizationUpdate',
    delete: 'deliveryCustomizationDelete',
    inputStyle: 'wrapped',
  },
  'payment-customization': {
    list: 'paymentCustomizations',
    create: 'paymentCustomizationCreate',
    update: 'paymentCustomizationUpdate',
    delete: 'paymentCustomizationDelete',
    inputStyle: 'wrapped',
  },
  'checkout-validation': {
    list: 'validations',
    create: 'validationCreate',
    update: 'validationUpdate',
    delete: 'validationDelete',
    inputStyle: 'wrapped',
  },
  'fulfillment-constraints': {
    list: 'fulfillmentConstraintRules',
    create: 'fulfillmentConstraintRuleCreate',
    update: null,
    delete: 'fulfillmentConstraintRuleDelete',
    inputStyle: 'flat',
  },
}
