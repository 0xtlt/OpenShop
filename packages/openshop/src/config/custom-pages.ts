export const CUSTOM_ADMIN_RESERVED_PREFIXES = [
  'api',
  'auth',
  'webhooks',
  'proxy',
  'ext',
  'routes',
  'health',
  'flows',
  'runs',
  'providers',
  'crons',
  'functions',
  'mcp',
] as const

export interface CustomAdminNavigationItem {
  label: string
  path: string
}

export interface ExperimentalCustomPagesConfig {
  navigation?: CustomAdminNavigationItem[]
}

export interface OpenShopExperimentalConfig {
  customPages?: boolean | ExperimentalCustomPagesConfig
}

export interface CustomAdminPageManifestEntry {
  id: string
  path: string
  routePattern: string
  sourceFile: string
  serverFile?: string
}

export interface CustomAdminPageAccess {
  id: string
  path: string
  allowed: boolean
}

export interface CustomAdminPagesResponse {
  navigation: CustomAdminNavigationItem[]
  pages: CustomAdminPageAccess[]
}

const reserved = new Set<string>(CUSTOM_ADMIN_RESERVED_PREFIXES)
const segmentPattern = /^[a-zA-Z0-9_-]+$/

export function customPagesEnabled(config: OpenShopExperimentalConfig | undefined): boolean {
  return Boolean(config?.customPages)
}

export function customPagesConfig(
  config: OpenShopExperimentalConfig | undefined,
): ExperimentalCustomPagesConfig | undefined {
  return typeof config?.customPages === 'object' ? config.customPages : undefined
}

export function isReservedCustomAdminPath(path: string): boolean {
  const first = path.split('/').filter(Boolean)[0]
  return first ? reserved.has(first) : true
}

export function isSafeCustomAdminPath(path: string, allowDynamic = false): boolean {
  if (!path.startsWith('/') || path === '/' || path.endsWith('/')) return false
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0 || isReservedCustomAdminPath(path)) return false
  return segments.every((segment) => {
    if (allowDynamic && /^:[a-zA-Z][a-zA-Z0-9_]*$/.test(segment)) return true
    return segmentPattern.test(segment)
  })
}

export function matchCustomAdminPath(pattern: string, pathname: string): boolean {
  const patternSegments = pattern.split('/').filter(Boolean)
  const pathSegments = pathname.split('/').filter(Boolean)
  return patternSegments.length === pathSegments.length
    && patternSegments.every((segment, index) => (
      segment.startsWith(':') || segment === pathSegments[index]
    ))
}
