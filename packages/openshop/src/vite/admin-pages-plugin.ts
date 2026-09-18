import { readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'
import type { CustomAdminPageManifestEntry } from '../config/custom-pages.ts'
import { discoverCustomAdminPages } from '../cli/admin-pages.ts'

const manifestId = 'virtual:openshop-admin-pages'
const resolvedManifestId = '\0virtual:openshop-admin-pages'
const actionPrefix = '\0virtual:openshop-admin-actions:'

export function isServerOnlyAdminPageImport(source: string): boolean {
  return /(?:^|\/)[^/]+\.server\.(?:ts|js)$/.test(source)
    || source.startsWith('#db/')
    || source.startsWith('#engine/')
    || source.startsWith('#shopify/')
    || source.startsWith('#server/')
    || source === 'openshop'
    || source.startsWith('node:')
    || source.includes('/server/')
}

function exportedFunctions(source: string): Array<{ name: string; kind: 'loader' | 'action' }> {
  const exports: Array<{ name: string; kind: 'loader' | 'action' }> = []
  const expression = /export\s+const\s+([A-Za-z_$][\w$]*)(?:\s*:[^=\n]+)?\s*=\s*defineAdmin(Loader|Action)\b/g
  for (const match of source.matchAll(expression)) {
    exports.push({
      name: match[1]!,
      kind: match[2] === 'Loader' ? 'loader' : 'action',
    })
  }
  return exports
}

export function renderAdminActionsClientModule(page: CustomAdminPageManifestEntry): string {
  if (!page.serverFile) return ''
  const definitions = exportedFunctions(readFileSync(page.serverFile, 'utf8'))
  return [
    `import { createAdminFunctionReference } from 'openshop/admin';`,
    ...definitions.map(({ name, kind }) => (
      `export const ${name} = createAdminFunctionReference({ kind: ${JSON.stringify(kind)}, name: ${JSON.stringify(name)}, pagePattern: ${JSON.stringify(page.routePattern)} });`
    )),
  ].join('\n')
}

export function adminPagesPlugin(
  initialPages: readonly CustomAdminPageManifestEntry[],
  options?: { cwd?: string },
): Plugin {
  let pages = [...initialPages]
  let byServerFile = new Map<string, CustomAdminPageManifestEntry>()
  const refreshIndex = () => {
    byServerFile = new Map(
      pages.filter((page) => page.serverFile).map((page) => [resolve(page.serverFile!), page]),
    )
  }
  refreshIndex()

  return {
    name: 'openshop-admin-pages',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === manifestId) return resolvedManifestId
      if (!importer) return null
      const importerPath = importer.split('?')[0]!
      const appPage = importerPath.includes(`${sep}admin${sep}pages${sep}`)
      const isActionsFile = /(?:^|\/)actions\.server\.(?:ts|js)$/.test(source)
      if (isActionsFile) {
        const absolute = resolve(dirname(importerPath), source)
        const candidates = [absolute, `${absolute}.ts`, `${absolute}.js`]
        const page = candidates.map((candidate) => byServerFile.get(candidate)).find(Boolean)
        if (page) return `${actionPrefix}${page.id}`
      }
      if (appPage && isServerOnlyAdminPageImport(source)) {
        throw new Error(`[openshop] Server-only import "${source}" is not allowed in a custom admin page`)
      }
      return null
    },
    load(id) {
      if (id === resolvedManifestId) {
        return [
          `export const customAdminPages = [`,
          ...pages.map((page) => `  { id: ${JSON.stringify(page.id)}, path: ${JSON.stringify(page.path)}, routePattern: ${JSON.stringify(page.routePattern)}, load: () => import(${JSON.stringify(page.sourceFile)}) },`),
          `];`,
        ].join('\n')
      }

      if (!id.startsWith(actionPrefix)) return null
      const pageId = id.slice(actionPrefix.length)
      const page = pages.find((entry) => entry.id === pageId)
      if (!page?.serverFile) return null
      return renderAdminActionsClientModule(page)
    },
    configureServer(server) {
      const files = pages.flatMap((page) => [page.sourceFile, page.serverFile].filter(Boolean) as string[])
      for (const file of files) server.watcher.add(file)
      if (options?.cwd) {
        const root = resolve(options.cwd, 'admin', 'pages')
        server.watcher.add(root)
        server.watcher.on('all', (_event, file) => {
          if (!file.startsWith(root) || !/(?:page\.(?:t|j)sx|actions\.server\.(?:t|j)s)$/.test(file)) return
          pages = discoverCustomAdminPages(options.cwd)
          refreshIndex()
          const module = server.moduleGraph.getModuleById(resolvedManifestId)
          if (module) server.moduleGraph.invalidateModule(module)
          for (const currentPage of pages) {
            const actionModule = server.moduleGraph.getModuleById(`${actionPrefix}${currentPage.id}`)
            if (actionModule) server.moduleGraph.invalidateModule(actionModule)
          }
          server.ws.send({ type: 'full-reload', path: '*' })
        })
      }
    },
  }
}
