import type { BadgeTone } from '../../types'

export type FunctionState = 'active' | 'inactive' | 'scheduled' | 'expired' | 'unknown'

export interface FunctionField {
  type: 'text' | 'password' | 'number' | 'select' | 'multiselect' | 'checkbox'
  label: string
  placeholder?: string
  options?: Array<{ label: string; value: string }>
  required?: boolean
  defaultValue?: unknown
}

export interface FunctionOperations {
  updateSettings: boolean
  updateConfig: boolean
  delete: boolean
}

export interface FunctionDef {
  label: string
  type: string
  handle: string
  capabilities: FunctionOperations & {
    create: boolean
    singleton: boolean
  }
  settingsFields: Record<string, FunctionField>
  configFields: Record<string, FunctionField>
  ui?: {
    configurationPath?: string
    configurationLabel?: string
  }
}

export type FunctionConfig =
  | { state: 'missing' }
  | { state: 'valid'; value: Record<string, unknown> }
  | { state: 'invalid'; raw: string }

export interface FunctionInstance {
  id: string
  label: string
  state: FunctionState
  settings: Record<string, unknown>
  config: FunctionConfig
  operations: FunctionOperations
}

export const TYPE_LABELS: Record<string, string> = {
  discount: 'Discount',
  'cart-transform': 'Cart Transform',
  'delivery-customization': 'Delivery Customization',
  'payment-customization': 'Payment Customization',
  'checkout-validation': 'Checkout Validation',
  'fulfillment-constraints': 'Fulfillment Constraints',
}

export const STATE_TONES: Record<FunctionState, BadgeTone> = {
  active: 'success',
  inactive: 'warning',
  scheduled: 'info',
  expired: 'neutral',
  unknown: 'caution',
}
