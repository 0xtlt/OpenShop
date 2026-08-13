import type { AdminPageId, AdminPageMode, AdminPagesConfig, OpenShopConfig, ResolvedAdminPages } from '../types.ts'

export const ADMIN_PAGE_IDS: readonly AdminPageId[] = ['flows', 'providers', 'crons', 'functions', 'mcp']
export const ADMIN_PAGE_MODES: readonly AdminPageMode[] = ['visible', 'hidden', 'disabled']

const adminPageIds = new Set<string>(ADMIN_PAGE_IDS)
const adminPageModes = new Set<string>(ADMIN_PAGE_MODES)

export function isAdminPageId(value: string): value is AdminPageId {
  return adminPageIds.has(value)
}

export function isAdminPageMode(value: string): value is AdminPageMode {
  return adminPageModes.has(value)
}

export function resolveAdminPages(pages?: AdminPagesConfig): ResolvedAdminPages {
  return {
    flows: pages?.flows ?? 'visible',
    providers: pages?.providers ?? 'visible',
    crons: pages?.crons ?? 'visible',
    functions: pages?.functions ?? 'visible',
    mcp: pages?.mcp ?? 'visible',
  }
}

export function resolveAdminPagesFromConfig(config: Pick<OpenShopConfig, 'pages'>): ResolvedAdminPages {
  return resolveAdminPages(config.pages)
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
