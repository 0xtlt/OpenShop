import type { AnyFunctionDefinition, DeliveryMethodType, ProviderFieldDef } from '../../types.ts'
import type { FunctionFieldDescriptor, ManagedFunctionDefinition } from './types.ts'

const deliveryMethodTypes: DeliveryMethodType[] = ['LOCAL', 'NONE', 'PICK_UP', 'PICKUP_POINT', 'RETAIL', 'SHIPPING']

export function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function resolveDefinitionLabel(key: string, definition: AnyFunctionDefinition): string {
  if (typeof definition.label === 'string' && definition.label.trim()) return definition.label.trim()
  return humanize(key) || humanize(definition.handle)
}

function serializableTitle(title: unknown, fallback: string): string {
  return typeof title === 'string' && title.trim() ? title : fallback
}

function configFields(definition: AnyFunctionDefinition): Record<string, FunctionFieldDescriptor> {
  const fields: Record<string, FunctionFieldDescriptor> = {}
  for (const [key, field] of Object.entries(definition.config ?? {}) as Array<[string, ProviderFieldDef]>) {
    const { validate: _validate, ...descriptor } = field
    fields[key] = descriptor
  }
  return fields
}

function settingsFields(definition: AnyFunctionDefinition, label: string): Record<string, FunctionFieldDescriptor> {
  if (definition.type === 'cart-transform') {
    return {
      blockOnFailure: {
        type: 'checkbox',
        label: 'Block checkout on failure',
        required: true,
        defaultValue: definition.defaults?.blockOnFailure ?? false,
      },
    }
  }

  if (definition.type === 'fulfillment-constraints') {
    return {
      deliveryMethodTypes: {
        type: 'multiselect',
        label: 'Delivery method types',
        options: deliveryMethodTypes.map((value) => ({ label: humanize(value), value })),
        required: true,
        defaultValue: definition.defaults?.deliveryMethodTypes ?? ['SHIPPING'],
      },
    }
  }

  if (definition.type === 'delivery-customization' || definition.type === 'payment-customization') {
    return {
      title: {
        type: 'text',
        label: 'Title',
        required: true,
        defaultValue: serializableTitle(definition.defaults?.title, label),
      },
      enabled: {
        type: 'checkbox',
        label: 'Enabled',
        required: true,
        defaultValue: definition.defaults?.enabled ?? true,
      },
    }
  }

  if (definition.type === 'checkout-validation') {
    return {
      title: {
        type: 'text',
        label: 'Title',
        required: true,
        defaultValue: serializableTitle(definition.defaults?.title, label),
      },
      enabled: {
        type: 'checkbox',
        label: 'Enabled',
        required: true,
        defaultValue: definition.defaults?.enabled ?? true,
      },
      blockOnFailure: {
        type: 'checkbox',
        label: 'Block checkout on failure',
        required: true,
        defaultValue: definition.defaults?.blockOnFailure ?? false,
      },
    }
  }

  const modes = definition.modes?.length ? definition.modes : ['automatic']
  const defaults = definition.defaults
  const fields: Record<string, FunctionFieldDescriptor> = {
    mode: {
      type: 'select',
      label: 'Discount mode',
      required: true,
      options: modes.map((value) => ({ label: humanize(value), value })),
      defaultValue: modes[0],
    },
    title: {
      type: 'text',
      label: 'Title',
      required: true,
      defaultValue: serializableTitle(defaults?.title, label),
    },
    startsAt: {
      type: 'text',
      label: 'Starts at',
      required: true,
      ...(defaults?.startsAt === undefined ? {} : { defaultValue: defaults.startsAt }),
    },
    endsAt: {
      type: 'text',
      label: 'Ends at',
      required: false,
      ...(defaults?.endsAt === undefined ? {} : { defaultValue: defaults.endsAt }),
    },
    'combinesWith.productDiscounts': {
      type: 'checkbox',
      label: 'Combine with product discounts',
      required: true,
      defaultValue: defaults?.combinesWith?.productDiscounts ?? false,
    },
    'combinesWith.orderDiscounts': {
      type: 'checkbox',
      label: 'Combine with order discounts',
      required: true,
      defaultValue: defaults?.combinesWith?.orderDiscounts ?? false,
    },
    'combinesWith.shippingDiscounts': {
      type: 'checkbox',
      label: 'Combine with shipping discounts',
      required: true,
      defaultValue: defaults?.combinesWith?.shippingDiscounts ?? false,
    },
  }
  if (modes.includes('code')) {
    fields.code = { type: 'text', label: 'Discount code', required: false }
    fields.usageLimit = {
      type: 'number',
      label: 'Usage limit',
      required: false,
      ...(defaults?.usageLimit === undefined ? {} : { defaultValue: defaults.usageLimit }),
    }
  }
  return fields
}

export function buildManagedDefinition(key: string, definition: AnyFunctionDefinition): ManagedFunctionDefinition {
  const label = resolveDefinitionLabel(key, definition)
  const fields = configFields(definition)
  return {
    label,
    type: definition.type,
    handle: definition.handle,
    capabilities: {
      create: true,
      updateSettings: definition.type !== 'cart-transform',
      updateConfig: Object.keys(fields).length > 0,
      delete: true,
      singleton: definition.type === 'cart-transform',
    },
    settingsFields: settingsFields(definition, label),
    configFields: fields,
    ...(definition.ui ? { ui: { ...definition.ui } } : {}),
  }
}
