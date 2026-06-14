import { type } from 'arktype'
import type { AnyFunctionDefinition, ProviderFieldDef } from '../types.ts'

export type FunctionConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; error: string }

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function coerceFieldValue(field: ProviderFieldDef, value: unknown): unknown {
  if (field.type === 'number' && typeof value === 'string' && value.trim() !== '') return Number(value)
  if (field.type === 'checkbox') {
    if (typeof value === 'string') return value === 'true'
    if (value !== undefined) return Boolean(value)
  }
  return value
}

export function validateFunctionConfig(def: Pick<AnyFunctionDefinition, 'config'>, rawConfig: unknown): FunctionConfigResult {
  const input = typeof rawConfig === 'object' && rawConfig !== null && !Array.isArray(rawConfig)
    ? rawConfig as Record<string, unknown>
    : {}
  const config: Record<string, unknown> = {}

  for (const [fieldName, field] of Object.entries(def.config)) {
    const value = coerceFieldValue(field, input[fieldName])
    const required = field.required !== false

    if (required && isMissing(value)) {
      return { ok: false, error: `Field "${fieldName}" is required` }
    }

    if (field.validate && !isMissing(value)) {
      const result = field.validate(value)
      if (result instanceof type.errors) {
        return { ok: false, error: `Field "${fieldName}": ${result.summary}` }
      }
      config[fieldName] = result
    } else if (!isMissing(value)) {
      config[fieldName] = value
    }
  }

  return { ok: true, config }
}
