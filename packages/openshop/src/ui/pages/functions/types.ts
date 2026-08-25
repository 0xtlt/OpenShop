import type { ConfigField } from '../../components/ConfigFieldRenderer'

export interface FunctionDef {
  key: string
  label: string
  type: string
  handle: string
  modes?: string[]
  supportsUpdate: boolean
  singleton?: boolean
  fields: Record<string, ConfigField>
}

export interface FunctionInstance {
  id: string
  label?: string
  state?: 'active' | 'inactive'
  title?: string
  status?: string
  enabled?: boolean
  blockOnFailure?: boolean
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
