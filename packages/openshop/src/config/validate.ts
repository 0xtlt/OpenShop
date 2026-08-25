import type { OpenShopConfig, ProviderFieldDef, RetryPolicy, WorkerConfig } from '../types.ts'
import { createCoreMcpCapabilities } from '../server/mcp/core.ts'
import { buildMcpRegistry } from '../server/mcp/registry.ts'
import { ADMIN_PAGE_IDS, ADMIN_PAGE_MODES, isAdminPageId, isAdminPageMode } from './pages.ts'

const fieldTypes = new Set<ProviderFieldDef['type']>(['text', 'password', 'number', 'select', 'checkbox'])
const functionTypes = new Set(['discount', 'cart-transform', 'delivery-customization', 'payment-customization', 'checkout-validation', 'fulfillment-constraints'])
const discountModes = new Set(['automatic', 'code'])
const deliveryMethodTypes = new Set(['LOCAL', 'NONE', 'PICK_UP', 'PICKUP_POINT', 'RETAIL', 'SHIPPING'])
const functionKeys = new Set(['type', 'handle', 'label', 'config', 'defaults', 'ui', 'modes'])
const functionDefaultKeys: Record<string, Set<string>> = {
  discount: new Set(['title', 'startsAt', 'endsAt', 'usageLimit', 'combinesWith']),
  'cart-transform': new Set(['blockOnFailure']),
  'delivery-customization': new Set(['title', 'enabled']),
  'payment-customization': new Set(['title', 'enabled']),
  'checkout-validation': new Set(['title', 'enabled', 'blockOnFailure']),
  'fulfillment-constraints': new Set(['deliveryMethodTypes']),
}

function fail(message: string): never {
  throw new Error(`[openshop] Invalid config: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertPositiveNumber(value: unknown, path: string): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`${path} must be a positive number`)
  }
}

function assertPositiveInteger(value: unknown, path: string): void {
  if (value === undefined) return
  if (!Number.isInteger(value) || Number(value) <= 0) {
    fail(`${path} must be a positive integer`)
  }
}

function validateRetryPolicy(policy: Partial<RetryPolicy> | undefined, path: string): void {
  if (!policy) return
  assertPositiveInteger(policy.maxAttempts, `${path}.maxAttempts`)
  assertPositiveNumber(policy.initialIntervalMs, `${path}.initialIntervalMs`)
  assertPositiveNumber(policy.backoffCoefficient, `${path}.backoffCoefficient`)
  assertPositiveNumber(policy.maxIntervalMs, `${path}.maxIntervalMs`)
}

function validateWorkerConfig(worker: Partial<WorkerConfig> | undefined): void {
  if (!worker) return
  assertPositiveInteger(worker.concurrency, 'worker.concurrency')
  assertPositiveNumber(worker.pollIntervalMs, 'worker.pollIntervalMs')
  assertPositiveNumber(worker.pollMaxIntervalMs, 'worker.pollMaxIntervalMs')
  assertPositiveNumber(worker.pollBackoffCoefficient, 'worker.pollBackoffCoefficient')
  assertPositiveNumber(worker.leaseDurationMs, 'worker.leaseDurationMs')
}

function validateShopifyConfig(config: OpenShopConfig['shopify']): void {
  if (!config) return
  if (!isRecord(config)) fail('shopify must be an object')
  if (config.scopes !== undefined && (typeof config.scopes !== 'string' || config.scopes.trim() === '')) {
    fail('shopify.scopes must be a non-empty string')
  }
  if (config.apps === undefined) return
  if (!isRecord(config.apps)) fail('shopify.apps must be an object')

  for (const [handle, app] of Object.entries(config.apps)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(handle)) {
      fail(`shopify.apps.${handle} handle may only contain letters, numbers, "_" and "-"`)
    }
    if (!isRecord(app)) fail(`shopify.apps.${handle} must be an object`)
    if ('scopes' in app) fail(`shopify.apps.${handle}.scopes is not supported; define shopify.scopes globally`)

    const toml = app.toml
    const apiKey = app.apiKey
    const apiSecret = app.apiSecret
    if (typeof apiSecret !== 'string' || apiSecret.trim() === '') {
      fail(`shopify.apps.${handle}.apiSecret must be a non-empty string`)
    }

    if (toml !== undefined) {
      if (typeof toml !== 'string' || toml.trim() === '') fail(`shopify.apps.${handle}.toml must be a non-empty string`)
      if (apiKey !== undefined) fail(`shopify.apps.${handle} cannot define both toml and apiKey`)
    } else if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      fail(`shopify.apps.${handle}.apiKey must be a non-empty string when toml is not set`)
    }

    if (app.appUrl !== undefined && (typeof app.appUrl !== 'string' || app.appUrl.trim() === '')) {
      fail(`shopify.apps.${handle}.appUrl must be a non-empty string`)
    }
  }
}

function validateField(field: ProviderFieldDef, path: string): void {
  if (!isRecord(field)) fail(`${path} must be an object`)
  if (!fieldTypes.has(field.type)) fail(`${path}.type must be one of ${[...fieldTypes].join(', ')}`)
  if (typeof field.label !== 'string' || field.label.trim() === '') fail(`${path}.label must be a non-empty string`)

  if (field.type === 'select') {
    if (!Array.isArray(field.options) || field.options.length === 0) {
      fail(`${path}.options must be a non-empty array for select fields`)
    }

    const values = new Set<string>()
    for (const [index, option] of field.options.entries()) {
      if (!option || typeof option.label !== 'string' || typeof option.value !== 'string') {
        fail(`${path}.options[${index}] must include string label and value`)
      }
      if (values.has(option.value)) fail(`${path}.options contains duplicate value "${option.value}"`)
      values.add(option.value)
    }
  }
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  const key = Object.keys(value).find((candidate) => !allowed.has(candidate))
  if (key) fail(`${path}.${key} is not supported`)
}

function validateFunctionDefaults(fn: Record<string, unknown>, type: string, path: string): void {
  if (fn.defaults === undefined) return
  if (!isRecord(fn.defaults)) fail(`${path}.defaults must be an object`)
  const unsupportedKey = Object.keys(fn.defaults).find((key) => !functionDefaultKeys[type]?.has(key))
  if (unsupportedKey) fail(`${path}.defaults.${unsupportedKey} is not supported for ${type}`)

  const defaults = fn.defaults
  if (defaults.title !== undefined && typeof defaults.title !== 'string' && typeof defaults.title !== 'function') {
    fail(`${path}.defaults.title must be a string or function`)
  }
  for (const key of ['enabled', 'blockOnFailure']) {
    if (defaults[key] !== undefined && typeof defaults[key] !== 'boolean') {
      fail(`${path}.defaults.${key} must be a boolean`)
    }
  }
  for (const key of ['startsAt', 'endsAt']) {
    if (defaults[key] !== undefined && defaults[key] !== null && typeof defaults[key] !== 'string') {
      fail(`${path}.defaults.${key} must be a string or null`)
    }
  }
  if (defaults.usageLimit !== undefined && defaults.usageLimit !== null
    && (!Number.isInteger(defaults.usageLimit) || Number(defaults.usageLimit) <= 0)) {
    fail(`${path}.defaults.usageLimit must be a positive integer or null`)
  }
  if (defaults.combinesWith !== undefined) {
    if (!isRecord(defaults.combinesWith)) fail(`${path}.defaults.combinesWith must be an object`)
    rejectUnknownKeys(
      defaults.combinesWith,
      new Set(['productDiscounts', 'orderDiscounts', 'shippingDiscounts']),
      `${path}.defaults.combinesWith`,
    )
    for (const [key, value] of Object.entries(defaults.combinesWith)) {
      if (typeof value !== 'boolean') fail(`${path}.defaults.combinesWith.${key} must be a boolean`)
    }
  }
  if (defaults.deliveryMethodTypes !== undefined) {
    if (!Array.isArray(defaults.deliveryMethodTypes)
      || defaults.deliveryMethodTypes.some((value) => typeof value !== 'string' || !deliveryMethodTypes.has(value))) {
      fail(`${path}.defaults.deliveryMethodTypes contains an unsupported delivery method type`)
    }
  }
}

function validateFunctionUi(fn: Record<string, unknown>, path: string): void {
  if (fn.ui === undefined) return
  if (!isRecord(fn.ui)) fail(`${path}.ui must be an object`)
  rejectUnknownKeys(fn.ui, new Set(['configurationPath', 'configurationLabel']), `${path}.ui`)
  const configurationPath = fn.ui.configurationPath
  if (configurationPath !== undefined) {
    if (typeof configurationPath !== 'string' || !configurationPath.startsWith('/') || configurationPath.startsWith('//')) {
      fail(`${path}.ui.configurationPath must start with "/" and remain app-relative`)
    }
  }
  if (fn.ui.configurationLabel !== undefined) {
    if (typeof fn.ui.configurationLabel !== 'string' || !fn.ui.configurationLabel.trim()) {
      fail(`${path}.ui.configurationLabel must be a non-empty string`)
    }
    if (configurationPath === undefined) fail(`${path}.ui.configurationLabel requires configurationPath`)
  }
}

export function validateOpenShopConfig(config: OpenShopConfig): void {
  if (!isRecord(config)) fail('config must be an object')
  validateShopifyConfig(config.shopify)
  if (!isRecord(config.providers)) fail('providers must be an object')
  if (!isRecord(config.flows)) fail('flows must be an object')

  for (const [key, provider] of Object.entries(config.providers)) {
    if (!provider || typeof provider.name !== 'string' || provider.name.trim() === '') {
      fail(`providers.${key}.name must be a non-empty string`)
    }
    if (!isRecord(provider.ui?.fields)) fail(`providers.${key}.ui.fields must be an object`)
    if (!isRecord(provider.methods)) fail(`providers.${key}.methods must be an object`)

    for (const [fieldName, field] of Object.entries(provider.ui.fields) as Array<[string, ProviderFieldDef]>) {
      validateField(field, `providers.${key}.ui.fields.${fieldName}`)
    }
  }

  for (const [key, flow] of Object.entries(config.flows)) {
    if (!flow || typeof flow.name !== 'string' || flow.name.trim() === '') fail(`flows.${key}.name must be a non-empty string`)
    if (typeof flow.run !== 'function') fail(`flows.${key}.run must be a function`)
    assertPositiveNumber(flow.timeout, `flows.${key}.timeout`)
    assertPositiveNumber(flow.stepTimeout, `flows.${key}.stepTimeout`)
    if (flow.concurrency && flow.concurrency !== 'reject' && flow.concurrency !== 'allow') {
      fail(`flows.${key}.concurrency must be "reject" or "allow"`)
    }
    validateRetryPolicy(flow.retryPolicy, `flows.${key}.retryPolicy`)
  }

  for (const [index, cron] of (config.crons ?? []).entries()) {
    if (typeof cron.schedule !== 'string' || cron.schedule.trim() === '') fail(`crons[${index}].schedule must be a non-empty string`)
    if (typeof cron.flow !== 'string' || !config.flows[cron.flow]) fail(`crons[${index}].flow references unknown flow "${cron.flow}"`)
  }

  const functionHandles = new Set<string>()
  for (const [key, fn] of Object.entries(config.functions ?? {})) {
    if (!isRecord(fn)) fail(`functions.${key} must be an object`)
    rejectUnknownKeys(fn, functionKeys, `functions.${key}`)
    if (!functionTypes.has(fn.type)) fail(`functions.${key}.type is not supported`)
    if (typeof fn.handle !== 'string' || fn.handle.trim() === '') fail(`functions.${key}.handle must be a non-empty string`)
    if (fn.label !== undefined && (typeof fn.label !== 'string' || !fn.label.trim())) {
      fail(`functions.${key}.label must be a non-empty string`)
    }
    if (functionHandles.has(fn.handle)) fail(`functions.${key}.handle duplicates "${fn.handle}"`)
    functionHandles.add(fn.handle)

    if (fn.type === 'discount') {
      if (fn.modes !== undefined && !Array.isArray(fn.modes)) {
        fail(`functions.${key}.modes must be an array`)
      }
      for (const mode of fn.modes ?? []) {
        if (!discountModes.has(mode)) fail(`functions.${key}.modes contains unsupported mode "${mode}"`)
      }
    } else if (fn.modes !== undefined) {
      fail(`functions.${key}.modes is only supported for discount`)
    }

    if (fn.config !== undefined && !isRecord(fn.config)) fail(`functions.${key}.config must be an object`)
    for (const [fieldName, field] of Object.entries(fn.config ?? {}) as Array<[string, ProviderFieldDef]>) {
      validateField(field, `functions.${key}.config.${fieldName}`)
    }
    validateFunctionDefaults(fn, fn.type, `functions.${key}`)
    validateFunctionUi(fn, `functions.${key}`)
  }

  validatePagesConfig(config.pages)
  validateWorkerConfig(config.worker)
  validateRetryPolicy(config.retryPolicy, 'retryPolicy')
  buildMcpRegistry(config, createCoreMcpCapabilities(() => config))
}

export function validatePagesConfig(pages: OpenShopConfig['pages']): void {
  if (pages === undefined) return
  if (!isRecord(pages)) fail('pages must be an object')

  for (const [key, value] of Object.entries(pages)) {
    if (!isAdminPageId(key)) {
      fail(`pages.${key} is not a supported admin page (expected ${ADMIN_PAGE_IDS.join(', ')})`)
    }
    if (typeof value !== 'string' || !isAdminPageMode(value)) {
      fail(`pages.${key} must be ${ADMIN_PAGE_MODES.map((mode) => `"${mode}"`).join(', ')}`)
    }
  }
}
