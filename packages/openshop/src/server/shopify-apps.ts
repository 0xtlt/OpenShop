import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyQueryHmac, verifyWebhookHmac } from '#server/hmac'
import type { OpenShopConfig, ShopifyAppConfig } from '#types'

export const DEFAULT_SHOPIFY_APP_HANDLE = 'default'

export interface ResolvedShopifyApp {
  handle: string
  apiKey: string
  apiSecret: string
  appUrl: string
  scopes: string
  source: 'env' | 'toml' | 'config'
  toml?: string
}

interface ShopifyTomlData {
  apiKey?: string
  appUrl?: string
  scopes?: string
}

function readTomlValue(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s#]+))`, 'm'))
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

export function readShopifyToml(path: string): ShopifyTomlData {
  const content = readFileSync(path, 'utf8')
  return {
    apiKey: readTomlValue(content, 'client_id'),
    appUrl: readTomlValue(content, 'application_url'),
    scopes: readTomlValue(content, 'scopes'),
  }
}

export function readScopesFromToml(cwd: string): string {
  const candidates = ['shopify.app.toml']
  try {
    candidates.unshift(...readTomlCandidates(cwd).filter((file) => file !== 'shopify.app.toml'))
  } catch { /* ignore missing cwd */ }

  for (const file of candidates) {
    const path = resolve(cwd, file)
    if (!existsSync(path)) continue
    const scopes = readShopifyToml(path).scopes
    if (scopes) return scopes
  }
  return ''
}

function readTomlCandidates(cwd: string): string[] {
  return readdirSync(cwd).filter((file) => /^shopify\.app(?:\..+)?\.toml$/.test(file))
}

function fallbackAppUrl(): string {
  return process.env.HOST ?? process.env.SHOPIFY_APP_URL ?? ''
}

function normalizeTomlApp(handle: string, app: Extract<ShopifyAppConfig, { toml: string }>, config: OpenShopConfig, cwd: string): ResolvedShopifyApp {
  const tomlPath = resolve(cwd, app.toml)
  if (!existsSync(tomlPath)) throw new Error(`[openshop] Shopify app "${handle}" TOML not found: ${app.toml}`)
  const toml = readShopifyToml(tomlPath)
  if (!toml.apiKey) throw new Error(`[openshop] Shopify app "${handle}" TOML is missing client_id`)
  return {
    handle,
    apiKey: toml.apiKey,
    apiSecret: app.apiSecret,
    appUrl: app.appUrl ?? toml.appUrl ?? fallbackAppUrl(),
    scopes: config.shopify?.scopes ?? toml.scopes ?? '',
    source: 'toml',
    toml: app.toml,
  }
}

function normalizeConfigApp(handle: string, app: Extract<ShopifyAppConfig, { apiKey: string }>, config: OpenShopConfig, cwd: string): ResolvedShopifyApp {
  return {
    handle,
    apiKey: app.apiKey,
    apiSecret: app.apiSecret,
    appUrl: app.appUrl ?? fallbackAppUrl(),
    scopes: config.shopify?.scopes ?? readScopesFromToml(cwd),
    source: 'config',
  }
}

function normalizeLegacyApp(config: OpenShopConfig, cwd: string): ResolvedShopifyApp {
  return {
    handle: DEFAULT_SHOPIFY_APP_HANDLE,
    apiKey: process.env.SHOPIFY_API_KEY ?? '',
    apiSecret: process.env.SHOPIFY_API_SECRET ?? '',
    appUrl: fallbackAppUrl(),
    scopes: config.shopify?.scopes ?? readScopesFromToml(cwd),
    source: 'env',
  }
}

function assertConsistentScopes(apps: ResolvedShopifyApp[], hasGlobalScopes: boolean): void {
  if (hasGlobalScopes) return
  const scopes = new Set(apps.map((app) => app.scopes).filter(Boolean))
  if (scopes.size <= 1) return
  throw new Error('[openshop] Shopify app scopes must be identical across all configured apps')
}

export function resolveShopifyApps(config: OpenShopConfig, cwd = process.cwd()): ResolvedShopifyApp[] {
  const appConfigs = config.shopify?.apps
  if (!appConfigs) return [normalizeLegacyApp(config, cwd)]

  const apps = Object.entries(appConfigs).map(([handle, app]) => (
    'toml' in app && app.toml
      ? normalizeTomlApp(handle, app as Extract<ShopifyAppConfig, { toml: string }>, config, cwd)
      : normalizeConfigApp(handle, app as Extract<ShopifyAppConfig, { apiKey: string }>, config, cwd)
  ))

  if (apps.length === 0) throw new Error('[openshop] shopify.apps must contain at least one app')
  assertConsistentScopes(apps, Boolean(config.shopify?.scopes))
  return apps
}

export function hasConfiguredShopifyAppSecret(config: OpenShopConfig, cwd = process.cwd()): boolean {
  return resolveShopifyApps(config, cwd).some((app) => app.apiSecret.trim() !== '')
}

export function resolveShopifyAppByHandle(config: OpenShopConfig, handle: string | undefined, cwd = process.cwd()): ResolvedShopifyApp {
  const apps = resolveShopifyApps(config, cwd)
  const appHandle = handle ?? (apps.length === 1 ? apps[0]!.handle : undefined)
  if (!appHandle) throw new Error('[openshop] Missing Shopify app handle')
  const app = apps.find((candidate) => candidate.handle === appHandle)
  if (!app) throw new Error(`[openshop] Unknown Shopify app "${appHandle}"`)
  return app
}

export function resolveShopifyAppByApiKey(config: OpenShopConfig, apiKey: string, cwd = process.cwd()): ResolvedShopifyApp {
  const matches = resolveShopifyApps(config, cwd).filter((app) => app.apiKey === apiKey)
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) throw new Error(`[openshop] Multiple Shopify apps use apiKey "${apiKey}"`)
  throw new Error('[openshop] No Shopify app matches the session token audience')
}

export function resolveShopifyAppBySignedQuery(config: OpenShopConfig, query: Record<string, string>, cwd = process.cwd()): ResolvedShopifyApp {
  const matches = resolveShopifyApps(config, cwd).filter((app) => verifyQueryHmac(query, app.apiSecret))
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) throw new Error('[openshop] Multiple Shopify apps matched the signed request')
  throw new Error('[openshop] No Shopify app matched the signed request')
}

export function resolveShopifyAppByWebhookHmac(config: OpenShopConfig, body: string, hmac: string, cwd = process.cwd()): ResolvedShopifyApp {
  const matches = resolveShopifyApps(config, cwd).filter((app) => verifyWebhookHmac(body, hmac, app.apiSecret))
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) throw new Error('[openshop] Multiple Shopify apps matched the webhook signature')
  throw new Error('[openshop] No Shopify app matched the webhook signature')
}

export function readJwtAudience(token: string): string | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { aud?: unknown }
    return typeof decoded.aud === 'string' ? decoded.aud : null
  } catch {
    return null
  }
}
