import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import type {
  CustomAdminNavigationItem,
  CustomAdminPageManifestEntry,
} from '../config/custom-pages.ts'
import {
  customAdminRouteShapeKey,
  customPagesConfig,
  customPagesEnabled,
  isSafeCustomAdminPath,
  matchCustomAdminPath,
} from '../config/custom-pages.ts'
import type { OpenShopConfig } from '../types.ts'

export const adminPagesManifestFile = 'admin-pages.json'

function walkPageFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  const files: string[] = []

  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('_')) continue
      const fullPath = resolve(current, entry.name)
      if (entry.isDirectory()) walk(fullPath)
      else if (entry.name === 'page.tsx' || entry.name === 'page.jsx') files.push(fullPath)
    }
  }

  walk(directory)
  return files.sort()
}

function routeSegment(segment: string): { path: string; pattern: string } {
  const dynamic = segment.match(/^\[([a-zA-Z][a-zA-Z0-9_]*)\]$/)
  if (dynamic) return { path: segment, pattern: `:${dynamic[1]}` }
  if (!/^[a-zA-Z0-9_-]+$/.test(segment)) {
    throw new Error(`[openshop] Invalid custom admin page segment "${segment}"`)
  }
  return { path: segment, pattern: segment }
}

export function discoverCustomAdminPages(cwd = process.cwd()): CustomAdminPageManifestEntry[] {
  const pagesRoot = resolve(cwd, 'admin', 'pages')
  const pages = walkPageFiles(pagesRoot).map((sourceFile) => {
    const routeDirectory = relative(pagesRoot, dirname(sourceFile))
    const segments = routeDirectory === '' ? [] : routeDirectory.split(sep)
    if (segments.length === 0) {
      throw new Error('[openshop] admin/pages/page.tsx cannot replace the built-in Home page')
    }

    const mapped = segments.map(routeSegment)
    const path = `/${mapped.map((segment) => segment.path).join('/')}`
    const routePattern = `/${mapped.map((segment) => segment.pattern).join('/')}`
    if (!isSafeCustomAdminPath(routePattern, true)) {
      throw new Error(`[openshop] Custom admin page path "${path}" is reserved or invalid`)
    }

    const actionsFile = ['actions.server.ts', 'actions.server.js']
      .map((name) => resolve(dirname(sourceFile), name))
      .find(existsSync)

    return {
      id: segments.join('/'),
      path,
      routePattern,
      sourceFile,
      ...(actionsFile ? { serverFile: actionsFile } : {}),
    }
  })

  pages.sort((left, right) => {
    const leftSegments = left.routePattern.split('/')
    const rightSegments = right.routePattern.split('/')
    for (let index = 0; index < Math.max(leftSegments.length, rightSegments.length); index++) {
      const leftSegment = leftSegments[index]
      const rightSegment = rightSegments[index]
      if (leftSegment === rightSegment) continue
      if (leftSegment === undefined) return -1
      if (rightSegment === undefined) return 1
      if (leftSegment.startsWith(':') !== rightSegment.startsWith(':')) {
        return leftSegment.startsWith(':') ? 1 : -1
      }
      return leftSegment.localeCompare(rightSegment)
    }
    return 0
  })

  const routesByShape = new Map<string, string>()
  for (const page of pages) {
    const shape = customAdminRouteShapeKey(page.routePattern)
    const existingRoute = routesByShape.get(shape)
    if (existingRoute) {
      throw new Error(
        `[openshop] Custom admin page routes "${existingRoute}" and "${page.routePattern}" have the same route shape`,
      )
    }
    routesByShape.set(shape, page.routePattern)
  }
  return pages
}

export async function prepareCustomAdminPages(cwd = process.cwd()): Promise<{
  pages: CustomAdminPageManifestEntry[]
  navigation: CustomAdminNavigationItem[]
}> {
  const configPath = resolve(cwd, 'openshop.config.ts')
  const module = await import(configPath)
  const config = (module.default ?? module) as OpenShopConfig
  if (!customPagesEnabled(config.experimental)) return { pages: [], navigation: [] }
  const pages = discoverCustomAdminPages(cwd)
  const navigation = validateCustomAdminNavigation(
    customPagesConfig(config.experimental)?.navigation,
    pages,
  )
  return { pages, navigation }
}

export function validateCustomAdminNavigation(
  navigation: readonly CustomAdminNavigationItem[] | undefined,
  pages: readonly CustomAdminPageManifestEntry[],
): CustomAdminNavigationItem[] {
  const result = navigation ? [...navigation] : []
  const seen = new Set<string>()

  for (const [index, item] of result.entries()) {
    if (!item || typeof item.label !== 'string' || item.label.trim() === '') {
      throw new Error(`[openshop] Invalid config: experimental.customPages.navigation[${index}].label must be a non-empty string`)
    }
    if (!isSafeCustomAdminPath(item.path) || item.path.includes('[') || item.path.includes(':')) {
      throw new Error(`[openshop] Invalid config: experimental.customPages.navigation[${index}].path must be a static custom page path`)
    }
    if (!pages.some((page) => matchCustomAdminPath(page.routePattern, item.path))) {
      throw new Error(`[openshop] Invalid config: custom navigation path "${item.path}" does not match a discovered page`)
    }
    if (seen.has(item.path)) {
      throw new Error(`[openshop] Invalid config: duplicate custom navigation path "${item.path}"`)
    }
    seen.add(item.path)
  }
  return result
}

export function readCustomAdminPagesManifest(directory: string): CustomAdminPageManifestEntry[] {
  const manifestPath = resolve(directory, adminPagesManifestFile)
  if (!existsSync(manifestPath)) return []
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as CustomAdminPageManifestEntry[]
}

export function writeCustomAdminPagesManifest(
  directory: string,
  pages: readonly CustomAdminPageManifestEntry[],
  cwd = process.cwd(),
): void {
  const portable = pages.map((page) => ({
    ...page,
    sourceFile: basename(page.sourceFile),
    ...(page.serverFile ? {
      serverFile: relative(resolve(cwd, 'admin', 'pages'), page.serverFile)
        .replace(/\.(?:ts|js)$/, '.js'),
    } : {}),
  }))
  writeFileSync(resolve(directory, adminPagesManifestFile), `${JSON.stringify(portable, null, 2)}\n`)
}
