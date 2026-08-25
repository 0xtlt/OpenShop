import type { FunctionDef, FunctionInstance } from './types'

export function canCreateInstance(
  definition: FunctionDef | null,
  instances: FunctionInstance[],
  instancesLoaded = true,
): boolean {
  if (!definition) return false
  if (!definition.singleton) return true
  return instancesLoaded && instances.length === 0
}

export function instanceLabel(instance: FunctionInstance): string {
  return instance.label ?? instance.title ?? '(untitled)'
}

export function instanceState(instance: FunctionInstance): string {
  if (instance.state) return instance.state.charAt(0).toUpperCase() + instance.state.slice(1)
  return instance.status ?? (instance.enabled ? 'Active' : 'Inactive')
}

export function instanceIsActive(instance: FunctionInstance): boolean {
  return instance.state === 'active' || instance.status === 'ACTIVE' || instance.enabled === true
}

export function hasConfigFields(definition: FunctionDef): boolean {
  return Object.keys(definition.fields).length > 0
}
