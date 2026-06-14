export type ArkJsonSchema =
  | { domain: 'object'; required?: { key: string; value: ArkJsonSchema }[]; optional?: { key: string; value: ArkJsonSchema }[] }
  | { domain: 'number'; divisor?: number; min?: { rule: number }; max?: { rule: number } }
  | { domain: 'string'; pattern?: string; minLength?: number; maxLength?: number }
  | { domain: 'boolean' }
  | { unit: unknown }
  | string

export function schemaToExample(schema: ArkJsonSchema | null): Record<string, unknown> | null {
  if (!schema || typeof schema === 'string') return null
  if (!('domain' in schema) || schema.domain !== 'object') return null
  const obj: Record<string, unknown> = {}
  for (const { key, value } of [...(schema.required ?? []), ...(schema.optional ?? [])]) {
    obj[key] = valueExample(value)
  }
  return Object.keys(obj).length ? obj : null
}

function valueExample(v: ArkJsonSchema): unknown {
  if (typeof v === 'string') return v === 'number' ? 0 : v === 'boolean' ? false : ''
  if ('unit' in v) return v.unit
  if (!('domain' in v)) return null
  switch (v.domain) {
    case 'number': return v.min?.rule != null ? v.min.rule + 1 : 0
    case 'string': return ''
    case 'boolean': return false
    case 'object': return schemaToExample(v) ?? {}
    default: return null
  }
}
