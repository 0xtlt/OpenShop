/** Admin screens that can be hidden from nav or disabled entirely. Home is always visible. */
export const ADMIN_PAGE_IDS = ['flows', 'providers', 'crons', 'functions', 'mcp'] as const
export const ADMIN_PAGE_MODES = ['visible', 'hidden', 'disabled'] as const

export type AdminPageId = (typeof ADMIN_PAGE_IDS)[number]
/** `visible` shows the nav link; `hidden` keeps the URL; `disabled` blocks UI and admin API. */
export type AdminPageMode = (typeof ADMIN_PAGE_MODES)[number]
export type AdminPagesConfig = Partial<Record<AdminPageId, AdminPageMode>>
export type ResolvedAdminPages = Record<AdminPageId, AdminPageMode>

/** Config-backed resources that determine whether a sidebar destination has content. */
export interface AdminNavigationResources {
  flows: Readonly<Record<string, unknown>>
  providers: Readonly<Record<string, unknown>>
  crons?: readonly unknown[]
  functions?: Readonly<Record<string, unknown>>
}

const adminPageIds = new Set<string>(ADMIN_PAGE_IDS)
const adminPageModes = new Set<string>(ADMIN_PAGE_MODES)

export function isAdminPageId(value: string): value is AdminPageId {
  return adminPageIds.has(value)
}

export function isAdminPageMode(value: string): value is AdminPageMode {
  return adminPageModes.has(value)
}

export function resolveAdminPages(
  pages?: AdminPagesConfig,
  resources?: AdminNavigationResources,
): ResolvedAdminPages {
  const resolved: ResolvedAdminPages = {
    flows: pages?.flows ?? 'visible',
    providers: pages?.providers ?? 'visible',
    crons: pages?.crons ?? 'visible',
    functions: pages?.functions ?? 'visible',
    mcp: pages?.mcp ?? 'visible',
  }

  if (!resources) return resolved

  return {
    flows: hideEmptyPage(resolved.flows, Object.keys(resources.flows).length > 0),
    providers: hideEmptyPage(resolved.providers, Object.keys(resources.providers).length > 0),
    crons: hideEmptyPage(resolved.crons, (resources.crons?.length ?? 0) > 0),
    functions: hideEmptyPage(resolved.functions, Object.keys(resources.functions ?? {}).length > 0),
    mcp: resolved.mcp,
  }
}

function hideEmptyPage(mode: AdminPageMode, hasResources: boolean): AdminPageMode {
  return mode === 'visible' && !hasResources ? 'hidden' : mode
}

export function sameAdminPages(left: ResolvedAdminPages, right: ResolvedAdminPages): boolean {
  return ADMIN_PAGE_IDS.every((id) => left[id] === right[id])
}

function pageFromSection(section: string | undefined): AdminPageId | null {
  switch (section) {
    case 'flows':
    case 'runs':
      return 'flows'
    case 'providers':
      return 'providers'
    case 'crons':
      return 'crons'
    case 'functions':
      return 'functions'
    case 'mcp':
      return 'mcp'
    default:
      return null
  }
}

/** Maps an Admin API pathname such as `/api/flows` to a gated page, or `null` when ungated. */
export function adminPageFromApiPath(pathname: string): AdminPageId | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'api') return null
  return pageFromSection(segments[1])
}

/** Maps an embedded UI pathname such as `/runs/:id` to a gated page, or `null` for Home. */
export function adminPageFromUiPath(pathname: string): AdminPageId | null {
  return pageFromSection(pathname.split('/').filter(Boolean)[0])
}
