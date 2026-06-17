type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

interface JsonSchemaObject {
  type?: JsonSchemaType | JsonSchemaType[]
  required?: unknown
  properties?: unknown
  additionalProperties?: unknown
  items?: unknown
  minimum?: unknown
  maximum?: unknown
  enum?: unknown
}

export type McpSchemaValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSchema(value: unknown): value is JsonSchemaObject {
  return isRecord(value)
}

function typeMatches(value: unknown, type: JsonSchemaType): boolean {
  switch (type) {
    case 'object':
      return isRecord(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
  }
}

function expectedType(schema: JsonSchemaObject): JsonSchemaType[] | null {
  if (typeof schema.type === 'string') return [schema.type]
  if (Array.isArray(schema.type) && schema.type.every((item): item is JsonSchemaType => typeof item === 'string')) return schema.type
  return null
}

function validateValue(value: unknown, schema: unknown, path: string): string | null {
  if (!isSchema(schema)) return null

  const types = expectedType(schema)
  if (types && !types.some((type) => typeMatches(value, type))) {
    return `${path} must be ${types.join(' or ')}`
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    return `${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`
  }

  if ((types?.includes('number') || types?.includes('integer')) && typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${path} must be >= ${schema.minimum}`
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${path} must be <= ${schema.maximum}`
  }

  if (types?.includes('object') && isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : []

    for (const key of required) {
      if (!(key in value)) return `${path}.${key} is required`
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) return `${path}.${key} is not allowed`
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (!(key in value)) continue
      const childError = validateValue(value[key], childSchema, `${path}.${key}`)
      if (childError) return childError
    }
  }

  if (types?.includes('array') && Array.isArray(value) && schema.items !== undefined) {
    for (const [index, item] of value.entries()) {
      const itemError = validateValue(item, schema.items, `${path}[${index}]`)
      if (itemError) return itemError
    }
  }

  return null
}

export function validateMcpToolArguments(inputSchema: Record<string, unknown> | undefined, value: unknown): McpSchemaValidationResult {
  const args = value === undefined ? {} : value
  if (!isRecord(args)) return { ok: false, error: 'arguments must be an object' }

  const schema = inputSchema ?? { type: 'object' }
  const error = validateValue(args, schema, 'arguments')
  if (error) return { ok: false, error }
  return { ok: true, value: args }
}
