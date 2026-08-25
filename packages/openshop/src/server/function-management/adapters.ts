import type { AnyFunctionDefinition, ShopifyFunctionType } from '../../types.ts'
import type {
  FunctionOperations,
  FunctionState,
  ManagedFunctionInstance,
  ShopifyOwnerRecord,
} from './types.ts'

interface NormalizeContext {
  definition: AnyFunctionDefinition
  label: string
  owner: ShopifyOwnerRecord
}

interface FunctionTypeAdapter {
  normalize(context: NormalizeContext): ManagedFunctionInstance
}

function configValue(raw: string | null | undefined): ManagedFunctionInstance['config'] {
  if (raw === undefined || raw === null) return { state: 'missing' }
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { state: 'invalid', raw }
    return { state: 'valid', value: value as Record<string, unknown> }
  } catch {
    return { state: 'invalid', raw }
  }
}

function operations(definition: AnyFunctionDefinition, updateSettings: boolean): FunctionOperations {
  return {
    updateSettings,
    updateConfig: Object.keys(definition.config ?? {}).length > 0,
    delete: true,
  }
}

function titledState(enabled: boolean | undefined): FunctionState {
  if (enabled === true) return 'active'
  if (enabled === false) return 'inactive'
  return 'unknown'
}

function discountState(status: string | undefined): FunctionState {
  switch (status?.toUpperCase()) {
    case 'ACTIVE': return 'active'
    case 'INACTIVE': return 'inactive'
    case 'SCHEDULED': return 'scheduled'
    case 'EXPIRED': return 'expired'
    default: return 'unknown'
  }
}

function instance(
  context: NormalizeContext,
  state: FunctionState,
  settings: Record<string, unknown>,
  updateSettings: boolean,
  label = context.label,
): ManagedFunctionInstance {
  return {
    id: context.owner.id,
    label,
    state,
    settings,
    config: configValue(context.owner.metafieldValue),
    operations: operations(context.definition, updateSettings),
  }
}

const discountAdapter: FunctionTypeAdapter = {
  normalize(context) {
    const { owner } = context
    const settings: Record<string, unknown> = {
      mode: owner.mode ?? 'automatic',
      title: owner.title ?? context.label,
      startsAt: owner.startsAt ?? null,
      endsAt: owner.endsAt ?? null,
      combinesWith: owner.combinesWith ?? {},
    }
    if (owner.mode === 'code') {
      settings.code = owner.code ?? null
      settings.usageLimit = owner.usageLimit ?? null
    }
    return instance(context, discountState(owner.status), settings, true, owner.title ?? context.label)
  },
}

const cartTransformAdapter: FunctionTypeAdapter = {
  normalize(context) {
    return instance(context, 'active', { blockOnFailure: context.owner.blockOnFailure ?? false }, false)
  },
}

function titledAdapter(extraSettings?: (owner: ShopifyOwnerRecord) => Record<string, unknown>): FunctionTypeAdapter {
  return {
    normalize(context) {
      const settings = {
        title: context.owner.title ?? context.label,
        enabled: context.owner.enabled ?? false,
        ...(extraSettings?.(context.owner) ?? {}),
      }
      return instance(context, titledState(context.owner.enabled), settings, true, context.owner.title ?? context.label)
    },
  }
}

const fulfillmentConstraintAdapter: FunctionTypeAdapter = {
  normalize(context) {
    return instance(context, 'active', {
      deliveryMethodTypes: context.owner.deliveryMethodTypes ?? [],
    }, true)
  },
}

const adapters: Record<ShopifyFunctionType, FunctionTypeAdapter> = {
  discount: discountAdapter,
  'cart-transform': cartTransformAdapter,
  'delivery-customization': titledAdapter(),
  'payment-customization': titledAdapter(),
  'checkout-validation': titledAdapter((owner) => ({ blockOnFailure: owner.blockOnFailure ?? false })),
  'fulfillment-constraints': fulfillmentConstraintAdapter,
}

export function adapterFor(type: ShopifyFunctionType): FunctionTypeAdapter {
  return adapters[type]
}

