import type {
  FunctionExecutionCommand,
  FunctionExecutionResult,
  FunctionDefinitionRecord,
  ManagedFunctionDefinition,
  ManagedFunctionInstance,
  ShopifyAdminPort,
} from './types.ts'
import { buildManagedDefinition, resolveDefinitionLabel } from './catalogue.ts'
import { adapterFor } from './adapters.ts'
import { validateFunctionConfig } from '../function-config.ts'
import { FunctionManagementError } from './errors.ts'
import { prepareSettings } from './settings.ts'
import { ShopifyAdminUserError } from './shopify-admin-adapter.ts'

export class FunctionManagement {
  private readonly definitions: FunctionDefinitionRecord
  private readonly shopify?: ShopifyAdminPort

  constructor(
    definitions: FunctionDefinitionRecord,
    shopify?: ShopifyAdminPort,
  ) {
    this.definitions = definitions
    this.shopify = shopify
  }

  catalogue(): ManagedFunctionDefinition[] {
    return Object.entries(this.definitions).map(([key, definition]) => buildManagedDefinition(key, definition))
  }

  async execute(handle: string, command: FunctionExecutionCommand): Promise<FunctionExecutionResult> {
    const { key, definition } = this.findDefinition(handle)
    const label = resolveDefinitionLabel(key, definition)
    const capabilities = buildManagedDefinition(key, definition).capabilities

    if (command.action === 'create') {
      if (capabilities.singleton && (await this.callShopify(
        () => this.shopifyPort().listOwners({ type: definition.type, handle }),
      )).length > 0) {
        throw new FunctionManagementError(
          'instance_limit_reached',
          409,
          `Function "${handle}" already has its maximum number of instances`,
        )
      }

      const parsedConfig = validateFunctionConfig(definition, command.input.config)
      if (!parsedConfig.ok) {
        throw new FunctionManagementError('invalid_request', 400, parsedConfig.error)
      }
      const settings = prepareSettings(definition, label, command.input.settings, parsedConfig.config)
      const created = await this.callShopify(() => this.shopifyPort().createOwner({
        definition,
        handle,
        ...(definition.type === 'discount' ? { mode: settings.mode as 'automatic' | 'code' } : {}),
        settings,
        ...(Object.keys(definition.config ?? {}).length > 0 ? { config: parsedConfig.config } : {}),
      }))
      return { ok: true, id: created.id }
    }

    const owners = await this.callShopify(() => this.shopifyPort().listOwners({ type: definition.type, handle }))
    const owner = owners.find((candidate) => candidate.id === command.id)
    if (!owner) {
      throw new FunctionManagementError('instance_not_found', 404, `Function instance "${command.id}" not found`)
    }

    if (command.action === 'delete') {
      await this.callShopify(() => this.shopifyPort().deleteOwner({
        type: definition.type,
        id: command.id,
        ...(definition.type === 'discount' ? { mode: command.mode ?? owner.mode ?? 'automatic' } : {}),
      }))
      return { ok: true }
    }

    const hasSettings = command.input.settings !== undefined
    const hasConfig = command.input.config !== undefined
    if (!hasSettings && !hasConfig) {
      throw new FunctionManagementError('invalid_request', 400, 'At least one of settings or config is required')
    }
    if (hasSettings && !capabilities.updateSettings) {
      throw new FunctionManagementError('operation_not_supported', 405, `Function "${handle}" does not support settings updates`)
    }
    if (hasConfig && !capabilities.updateConfig) {
      throw new FunctionManagementError('operation_not_supported', 405, `Function "${handle}" does not define editable config`)
    }

    let parsedConfig: Record<string, unknown> | undefined
    if (hasConfig) {
      const parsed = validateFunctionConfig(definition, command.input.config)
      if (!parsed.ok) throw new FunctionManagementError('invalid_request', 400, parsed.error)
      parsedConfig = parsed.config
    }
    if (hasSettings) {
      const currentConfig = parsedConfig
        ?? (owner.metafieldValue !== null && owner.metafieldValue !== undefined
          ? this.parseValidConfig(owner.metafieldValue)
          : {})
      const settings = prepareSettings(definition, label, command.input.settings, currentConfig)
      await this.callShopify(() => this.shopifyPort().updateOwnerSettings({
        definition,
        id: command.id,
        ...(definition.type === 'discount'
          ? { mode: (settings.mode as 'automatic' | 'code') ?? owner.mode ?? 'automatic' }
          : {}),
        settings,
      }))
    }
    if (parsedConfig) {
      await this.callShopify(() => this.shopifyPort().setOwnerConfig({ id: command.id, handle, config: parsedConfig }))
    }
    return { ok: true }
  }

  async inspect(handle: string): Promise<ManagedFunctionInstance[]> {
    const { key, definition } = this.findDefinition(handle)
    const label = resolveDefinitionLabel(key, definition)
    const owners = await this.callShopify(() => this.shopifyPort().listOwners({ type: definition.type, handle }))
    const adapter = adapterFor(definition.type)
    return owners.map((owner) => adapter.normalize({ definition, label, owner }))
  }

  private findDefinition(handle: string) {
    const entry = Object.entries(this.definitions).find(([, definition]) => definition.handle === handle)
    if (!entry) {
      throw new FunctionManagementError('function_not_found', 404, `Function "${handle}" not found`)
    }
    return { key: entry[0], definition: entry[1] }
  }

  private parseValidConfig(raw: string): Record<string, unknown> {
    try {
      const value: unknown = JSON.parse(raw)
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new FunctionManagementError(
          'invalid_request',
          400,
          'The function owner stored config is invalid JSON object data',
        )
      }
      return value as Record<string, unknown>
    } catch {
      throw new FunctionManagementError(
        'invalid_request',
        400,
        'The function owner stored config is invalid JSON and cannot be used for a settings update',
      )
    }
  }

  private async callShopify<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof FunctionManagementError) throw error
      if (error instanceof ShopifyAdminUserError) {
        throw new FunctionManagementError(
          'shopify_user_error',
          400,
          error.message || 'Shopify rejected the function owner change',
          error.userErrors,
        )
      }
      throw new FunctionManagementError(
        'shopify_error',
        502,
        'Shopify Admin API request failed',
        error instanceof Error ? { message: error.message } : undefined,
      )
    }
  }

  private shopifyPort(): ShopifyAdminPort {
    if (!this.shopify) {
      throw new FunctionManagementError('shopify_error', 502, 'Shopify Admin API port is unavailable')
    }
    return this.shopify
  }
}

export type { ShopifyAdminPort } from './types.ts'
export { FunctionManagementError } from './errors.ts'
