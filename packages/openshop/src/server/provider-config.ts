import { type } from 'arktype'
import type { ProviderDefinition, ProviderFieldDef } from '../types.js'

export interface ProviderFieldMetadata {
  type: ProviderFieldDef['type']
  label: string
  placeholder?: string
  options?: { label: string; value: string }[]
  required?: boolean
  hasValue?: boolean
}

export type ParsedProviderConfig = {
  ok: true
  config: Record<string, unknown>
} | {
  ok: false
  error: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function coerceFieldValue(field: ProviderFieldDef, value: unknown): unknown {
  if (value === undefined) return value
  if (field.type === 'number' && typeof value === 'string' && value.trim() !== '') return Number(value)
  if (field.type === 'checkbox') {
    if (typeof value === 'string') return value === 'true'
    return Boolean(value)
  }
  return value
}

export function providerFieldsForResponse(
  provider: ProviderDefinition,
  storedConfig: Record<string, unknown>,
): Record<string, ProviderFieldMetadata> {
  const fields: Record<string, ProviderFieldMetadata> = {}

  for (const [fieldName, field] of Object.entries(provider.ui.fields)) {
    fields[fieldName] = {
      type: field.type,
      label: field.label,
      placeholder: field.placeholder,
      options: field.options,
      required: field.required,
      ...(field.type === 'password' ? { hasValue: !isMissing(storedConfig[fieldName]) } : {}),
    }
  }

  return fields
}

export function publicProviderConfig(
  provider: ProviderDefinition,
  storedConfig: Record<string, unknown>,
): Record<string, unknown> {
  const config: Record<string, unknown> = {}

  for (const fieldName of Object.keys(provider.ui.fields)) {
    if (provider.ui.fields[fieldName].type === 'password') continue
    if (storedConfig[fieldName] !== undefined) config[fieldName] = storedConfig[fieldName]
  }

  return config
}

export function parseProviderConfig(
  provider: ProviderDefinition,
  rawConfig: unknown,
  existingConfig: Record<string, unknown> = {},
): ParsedProviderConfig {
  const input = isRecord(rawConfig) ? rawConfig : {}
  const data: Record<string, unknown> = {}

  for (const [fieldName, field] of Object.entries(provider.ui.fields)) {
    let value = input[fieldName]

    if (field.type === 'password' && isMissing(value) && existingConfig[fieldName] !== undefined) {
      value = existingConfig[fieldName]
    }

    value = coerceFieldValue(field, value)

    const required = field.required !== false
    if (required && isMissing(value)) {
      return { ok: false, error: `Field "${fieldName}" is required` }
    }

    if (!isMissing(value)) data[fieldName] = value
  }

  const transformed = provider.transformer ? provider.transformer({ data }) : data
  if (!isRecord(transformed)) return { ok: false, error: 'Provider transformer must return an object' }

  for (const [fieldName, field] of Object.entries(provider.ui.fields)) {
    const value = transformed[fieldName]
    const required = field.required !== false

    if (required && isMissing(value)) {
      return { ok: false, error: `Field "${fieldName}" is required` }
    }

    if (field.validate && !isMissing(value)) {
      const result = field.validate(value)
      if (result instanceof type.errors) {
        return { ok: false, error: `Field "${fieldName}": ${result.summary}` }
      }
      transformed[fieldName] = result
    }
  }

  return { ok: true, config: transformed }
}
