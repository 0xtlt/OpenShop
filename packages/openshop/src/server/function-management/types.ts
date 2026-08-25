import type { AnyFunctionDefinition, ShopifyFunctionType } from '../../types.ts'

export type FunctionState = 'active' | 'inactive' | 'scheduled' | 'expired' | 'unknown'

export type FunctionConfigValue =
  | { state: 'missing' }
  | { state: 'valid'; value: Record<string, unknown> }
  | { state: 'invalid'; raw: string }

export interface FunctionOperations {
  updateSettings: boolean
  updateConfig: boolean
  delete: boolean
}

export interface FunctionCapabilities extends FunctionOperations {
  create: boolean
  singleton: boolean
}

export interface FunctionFieldDescriptor {
  type: 'text' | 'password' | 'number' | 'select' | 'multiselect' | 'checkbox'
  label: string
  placeholder?: string
  options?: Array<{ label: string; value: string }>
  required?: boolean
  defaultValue?: unknown
}

export interface ManagedFunctionDefinition {
  label: string
  type: ShopifyFunctionType
  handle: string
  capabilities: FunctionCapabilities
  settingsFields: Record<string, FunctionFieldDescriptor>
  configFields: Record<string, FunctionFieldDescriptor>
  ui?: { configurationPath?: string; configurationLabel?: string }
}

export interface ManagedFunctionInstance {
  id: string
  label: string
  state: FunctionState
  settings: Record<string, unknown>
  config: FunctionConfigValue
  operations: FunctionOperations
}

export interface FunctionInstanceInput {
  settings?: Record<string, unknown>
  config?: Record<string, unknown>
}

export type FunctionExecutionCommand =
  | { action: 'create'; input: FunctionInstanceInput }
  | { action: 'update'; id: string; input: FunctionInstanceInput }
  | { action: 'delete'; id: string; mode?: 'automatic' | 'code' }

export interface FunctionExecutionResult {
  ok: true
  id?: string
}

export interface ShopifyOwnerRecord {
  id: string
  type: ShopifyFunctionType
  functionHandle: string
  mode?: 'automatic' | 'code'
  title?: string
  status?: string
  enabled?: boolean
  blockOnFailure?: boolean
  startsAt?: string | null
  endsAt?: string | null
  usageLimit?: number | null
  code?: string | null
  combinesWith?: Record<string, boolean>
  deliveryMethodTypes?: string[]
  metafieldValue?: string | null
}

export interface ShopifyAdminPort {
  listOwners(input: { type: ShopifyFunctionType; handle: string }): Promise<ShopifyOwnerRecord[]>
  createOwner(input: {
    definition: AnyFunctionDefinition
    handle: string
    mode?: 'automatic' | 'code'
    settings: Record<string, unknown>
    config?: Record<string, unknown>
  }): Promise<{ id: string }>
  updateOwnerSettings(input: {
    definition: AnyFunctionDefinition
    id: string
    mode?: 'automatic' | 'code'
    settings: Record<string, unknown>
  }): Promise<void>
  setOwnerConfig(input: { id: string; handle: string; config: Record<string, unknown> }): Promise<void>
  deleteOwner(input: { type: ShopifyFunctionType; id: string; mode?: 'automatic' | 'code' }): Promise<void>
}

export type FunctionDefinitionRecord = Record<string, AnyFunctionDefinition>
