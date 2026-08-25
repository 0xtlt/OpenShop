import type {
  AnyFunctionDefinition,
  CombinesWith,
  DeliveryMethodType,
  DiscountMode,
} from '../../types.ts'
import { FunctionManagementError } from './errors.ts'

const deliveryMethods = new Set<DeliveryMethodType>(['LOCAL', 'NONE', 'PICK_UP', 'PICKUP_POINT', 'RETAIL', 'SHIPPING'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new FunctionManagementError('invalid_request', 400, message)
}

function inputRecord(raw: unknown): Record<string, unknown> {
  if (raw === undefined) return {}
  if (!isRecord(raw)) invalid('settings must be an object')
  return raw
}

function rejectUnknown(input: Record<string, unknown>, allowed: string[]): void {
  const unexpected = Object.keys(input).find((key) => !allowed.includes(key))
  if (unexpected) invalid(`settings.${unexpected} is not supported for this function type`)
}

function booleanValue(value: unknown, fallback: boolean, path: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') invalid(`${path} must be a boolean`)
  return value
}

function titleValue(value: unknown, fallback: unknown, config: Record<string, unknown>, label: string): string {
  let title = value
  if (title === undefined && typeof fallback === 'function') {
    try {
      title = fallback(config)
    } catch {
      invalid('defaults.title could not be resolved from function config')
    }
  } else if (title === undefined) {
    title = fallback
  }
  if (title === undefined) title = label
  if (typeof title !== 'string' || !title.trim()) invalid('settings.title must be a non-empty string')
  return title.trim()
}

function optionalDate(value: unknown, fallback: string | null | undefined, path: string): string | null {
  const resolved = value === undefined ? fallback ?? null : value
  if (resolved !== null && (typeof resolved !== 'string' || !resolved.trim())) {
    invalid(`${path} must be an ISO date string or null`)
  }
  return resolved === null ? null : resolved.trim()
}

function combinesWith(value: unknown, fallback: CombinesWith | undefined): CombinesWith {
  if (value === undefined) return { ...(fallback ?? {}) }
  if (!isRecord(value)) invalid('settings.combinesWith must be an object')
  rejectUnknown(value, ['productDiscounts', 'orderDiscounts', 'shippingDiscounts'])
  return {
    productDiscounts: booleanValue(value.productDiscounts, fallback?.productDiscounts ?? false, 'settings.combinesWith.productDiscounts'),
    orderDiscounts: booleanValue(value.orderDiscounts, fallback?.orderDiscounts ?? false, 'settings.combinesWith.orderDiscounts'),
    shippingDiscounts: booleanValue(value.shippingDiscounts, fallback?.shippingDiscounts ?? false, 'settings.combinesWith.shippingDiscounts'),
  }
}

function discountSettings(
  definition: Extract<AnyFunctionDefinition, { type: 'discount' }>,
  label: string,
  raw: unknown,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const input = inputRecord(raw)
  rejectUnknown(input, ['mode', 'title', 'code', 'startsAt', 'endsAt', 'usageLimit', 'combinesWith'])
  const modes = definition.modes?.length ? definition.modes : ['automatic']
  const mode = (input.mode ?? modes[0]) as DiscountMode
  if (!modes.includes(mode)) invalid(`settings.mode must be one of ${modes.join(', ')}`)
  const startsAt = optionalDate(input.startsAt, definition.defaults?.startsAt ?? new Date().toISOString(), 'settings.startsAt')
  if (startsAt === null) invalid('settings.startsAt must be an ISO date string')
  const settings: Record<string, unknown> = {
    mode,
    title: titleValue(input.title, definition.defaults?.title, config, label),
    startsAt,
    endsAt: optionalDate(input.endsAt, definition.defaults?.endsAt, 'settings.endsAt'),
    combinesWith: combinesWith(input.combinesWith, definition.defaults?.combinesWith),
  }
  if (mode === 'code') {
    if (typeof input.code !== 'string' || !input.code.trim()) invalid('settings.code is required for code discounts')
    const usageLimit = input.usageLimit ?? definition.defaults?.usageLimit ?? null
    if (usageLimit !== null && (!Number.isInteger(usageLimit) || Number(usageLimit) <= 0)) {
      invalid('settings.usageLimit must be a positive integer or null')
    }
    settings.code = input.code.trim()
    settings.usageLimit = usageLimit
  }
  return settings
}

function titledSettings(
  definition: Extract<AnyFunctionDefinition, { type: 'delivery-customization' | 'payment-customization' | 'checkout-validation' }>,
  label: string,
  raw: unknown,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const input = inputRecord(raw)
  const validation = definition.type === 'checkout-validation'
  rejectUnknown(input, validation ? ['title', 'enabled', 'blockOnFailure'] : ['title', 'enabled'])
  return {
    title: titleValue(input.title, definition.defaults?.title, config, label),
    enabled: booleanValue(input.enabled, definition.defaults?.enabled ?? true, 'settings.enabled'),
    ...(validation
      ? { blockOnFailure: booleanValue(input.blockOnFailure, definition.defaults?.blockOnFailure ?? false, 'settings.blockOnFailure') }
      : {}),
  }
}

function fulfillmentSettings(
  definition: Extract<AnyFunctionDefinition, { type: 'fulfillment-constraints' }>,
  raw: unknown,
): Record<string, unknown> {
  const input = inputRecord(raw)
  rejectUnknown(input, ['deliveryMethodTypes'])
  const values = input.deliveryMethodTypes ?? definition.defaults?.deliveryMethodTypes ?? ['SHIPPING']
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !deliveryMethods.has(value as DeliveryMethodType))) {
    invalid('settings.deliveryMethodTypes must contain supported Shopify delivery method types')
  }
  return { deliveryMethodTypes: [...values] }
}

export function prepareSettings(
  definition: AnyFunctionDefinition,
  label: string,
  raw: unknown,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (definition.type === 'discount') return discountSettings(definition, label, raw, config)
  if (definition.type === 'cart-transform') {
    const input = inputRecord(raw)
    rejectUnknown(input, ['blockOnFailure'])
    return {
      blockOnFailure: booleanValue(
        input.blockOnFailure,
        definition.defaults?.blockOnFailure ?? false,
        'settings.blockOnFailure',
      ),
    }
  }
  if (definition.type === 'fulfillment-constraints') return fulfillmentSettings(definition, raw)
  return titledSettings(definition, label, raw, config)
}
