import type { ConfigField } from '../../components/ConfigFieldRenderer'

export interface FunctionDef {
  key: string
  type: string
  handle: string
  modes?: string[]
  supportsUpdate: boolean
  fields: Record<string, ConfigField>
}

export interface FunctionInstance {
  id: string
  title?: string
  status?: string
  enabled?: boolean
  config: Record<string, unknown>
}

export const TYPE_LABELS: Record<string, string> = {
  discount: 'Discount',
  'cart-transform': 'Cart Transform',
  'delivery-customization': 'Delivery Customization',
  'payment-customization': 'Payment Customization',
  'checkout-validation': 'Checkout Validation',
  'fulfillment-constraints': 'Fulfillment Constraints',
}
