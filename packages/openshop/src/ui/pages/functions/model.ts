import type { FunctionConfig, FunctionDef, FunctionField, FunctionInstance, FunctionState } from './types'

function pathParts(path: string): string[] {
  return path.split('.').filter((part) => part && part !== '__proto__' && part !== 'constructor' && part !== 'prototype')
}

export function getPath(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value
  for (const part of pathParts(path)) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function setPath(value: Record<string, unknown>, path: string, nextValue: unknown): Record<string, unknown> {
  const parts = pathParts(path)
  if (!parts.length) return value
  const result = { ...value }
  let output = result
  let input: Record<string, unknown> = value
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      output[part] = nextValue
      break
    }
    const current = input[part]
    const next = typeof current === 'object' && current !== null && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {}
    output[part] = next
    output = next
    input = typeof current === 'object' && current !== null && !Array.isArray(current)
      ? current as Record<string, unknown>
      : {}
  }
  return result
}

export function defaultValues(fields: Record<string, FunctionField>, nested: boolean): Record<string, unknown> {
  return Object.entries(fields).reduce<Record<string, unknown>>((values, [key, field]) => {
    if (field.defaultValue === undefined) return values
    return nested ? setPath(values, key, field.defaultValue) : { ...values, [key]: field.defaultValue }
  }, {})
}

export function payloadValues(
  values: Record<string, unknown>,
  fields: Record<string, FunctionField>,
  nested: boolean,
): Record<string, unknown> {
  return Object.entries(fields).reduce<Record<string, unknown>>((payload, [key, field]) => {
    const value = nested ? getPath(values, key) : values[key]
    const normalized = field.type === 'number' && typeof value === 'string'
      ? value.trim() === '' ? null : Number(value)
      : value
    if (normalized === undefined) return payload
    return nested ? setPath(payload, key, normalized) : { ...payload, [key]: normalized }
  }, {})
}

export function canCreate(definition: FunctionDef | null, instances: FunctionInstance[]): boolean {
  return Boolean(definition?.capabilities.create && (!definition.capabilities.singleton || instances.length === 0))
}

export function hasConfigFields(definition: FunctionDef): boolean {
  return Object.keys(definition.configFields).length > 0
}

export function resolveConfigurationPath(path: string | undefined, instanceId: string): string | null {
  if (!path?.startsWith('/') || path.startsWith('//')) return null
  return path.replaceAll(':id', encodeURIComponent(instanceId))
}

export function configurationSummary(config: FunctionConfig): string {
  if (config.state === 'missing') return 'Missing'
  if (config.state === 'invalid') return 'Invalid JSON'
  const entries = Object.entries(config.value)
  if (!entries.length) return 'Saved'
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(', ')
}

export function stateLabel(state: FunctionState): string {
  return state.charAt(0).toUpperCase() + state.slice(1)
}
