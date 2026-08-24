import { readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

export interface ScannedRouteFile {
  filePath: string
  routePath: string
}

function compareRouteSpecificity(a: ScannedRouteFile, b: ScannedRouteFile): number {
  const aSegments = a.routePath.split('/').filter(Boolean)
  const bSegments = b.routePath.split('/').filter(Boolean)

  for (let index = 0; index < Math.min(aSegments.length, bSegments.length); index++) {
    const aDynamic = aSegments[index]!.startsWith(':')
    const bDynamic = bSegments[index]!.startsWith(':')
    if (aDynamic !== bDynamic) return aDynamic ? 1 : -1
  }

  return bSegments.length - aSegments.length || a.routePath.localeCompare(b.routePath)
}

export function scanRouteDir(dir: string): ScannedRouteFile[] {
  const results: ScannedRouteFile[] = []

  function walk(current: string) {
    for (const entry of readdirSync(current).sort()) {
      if (entry.startsWith('_')) continue

      const full = resolve(current, entry)
      const stat = statSync(full)

      if (stat.isDirectory()) {
        walk(full)
        continue
      }

      if (!entry.endsWith('.ts') && !entry.endsWith('.js')) continue

      let routePath = '/' + relative(dir, full)
        .replace(/\.(ts|js)$/, '')
        .replace(/\\/g, '/')

      if (routePath.endsWith('/index')) routePath = routePath.slice(0, -6) || '/'
      routePath = routePath.replace(/\[([^\]]+)\]/g, ':$1')

      results.push({ filePath: full, routePath })
    }
  }

  walk(dir)
  return results.sort(compareRouteSpecificity)
}
