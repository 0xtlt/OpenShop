import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type } from 'arktype'
import type { Context, Hono } from 'hono'
import type {
  AdminAuthorize,
  AdminServerContext,
  AnyAdminFunctionDefinition,
  JsonValue,
} from '../admin/index.ts'
import { AdminPublicError } from '../admin/index.ts'
import {
  customPagesConfig,
  customPagesEnabled,
  matchCustomAdminPath,
  type CustomAdminPageManifestEntry,
  type CustomAdminPagesResponse,
} from '../config/custom-pages.ts'
import {
  adminPagesManifestFile,
  discoverCustomAdminPages,
  readCustomAdminPagesManifest,
  validateCustomAdminNavigation,
} from '../cli/admin-pages.ts'
import { getDb } from '../db/client.ts'
import { createShopifyClient } from '../shopify/client.ts'
import { getRuntimeLogger } from '../runtime/logger.ts'
import type { OpenShopConfig } from '../types.ts'
import { buildConnectors } from './connectors.ts'
import { getAdminActor, getShop, getShopifyApp } from './shop.ts'

type AdminServerModule = Record<string, unknown> & {
  pageAccess?: AdminAuthorize
}

function runtimePages(directory: string): CustomAdminPageManifestEntry[] {
  if (existsSync(resolve(directory, adminPagesManifestFile))) {
    return readCustomAdminPagesManifest(directory).map((page) => ({
      ...page,
      serverFile: page.serverFile ? resolve(directory, page.serverFile) : undefined,
    }))
  }
  return discoverCustomAdminPages(process.cwd())
}

async function loadServerModule(page: CustomAdminPageManifestEntry): Promise<AdminServerModule> {
  if (!page.serverFile) return {}
  return import(pathToFileURL(page.serverFile).href) as Promise<AdminServerModule>
}

async function loadServerModules(
  pages: readonly CustomAdminPageManifestEntry[],
  page: CustomAdminPageManifestEntry,
): Promise<AdminServerModule[]> {
  const ancestors = pages.filter((candidate) => (
    candidate.id === page.id || page.id.startsWith(`${candidate.id}/`)
  ))
  return Promise.all(ancestors.map(loadServerModule))
}

function extractParams(pattern: string, pathname: string): Record<string, string> | null {
  if (!matchCustomAdminPath(pattern, pathname)) return null
  const params: Record<string, string> = {}
  const patternSegments = pattern.split('/').filter(Boolean)
  const pathSegments = pathname.split('/').filter(Boolean)
  patternSegments.forEach((segment, index) => {
    if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(pathSegments[index]!)
  })
  return params
}

async function createContext(
  c: Context,
  config: OpenShopConfig,
  params: Record<string, string>,
  requestId: string,
): Promise<AdminServerContext> {
  const shop = getShop(c)
  const shopifyApp = getShopifyApp(c)
  return {
    shop,
    shopifyApp,
    actor: getAdminActor(c),
    params,
    db: getDb(),
    shopify: await createShopifyClient(shop, shopifyApp),
    connectors: await buildConnectors(config, shop, shopifyApp),
    requestId,
    idempotencyKey: c.req.header('idempotency-key'),
  }
}

async function isAllowed(
  modules: readonly AdminServerModule[],
  context: AdminServerContext,
  authorize?: AdminAuthorize,
): Promise<boolean> {
  for (const module of modules) {
    if (module.pageAccess && !(await module.pageAccess(context))) return false
  }
  return authorize ? authorize(context) : true
}

async function pageIsAllowed(
  c: Context,
  config: OpenShopConfig,
  pages: readonly CustomAdminPageManifestEntry[],
  page: CustomAdminPageManifestEntry,
  pathname: string,
): Promise<boolean> {
  try {
    const params = extractParams(page.routePattern, pathname)
    if (!params) return false
    const modules = await loadServerModules(pages, page)
    const context = await createContext(c, config, params, randomUUID())
    return isAllowed(modules, context)
  } catch (error) {
    getRuntimeLogger().warn('[openshop] Custom admin page access check failed', {
      pageId: page.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

function publicErrorResponse(c: Context, error: AdminPublicError, requestId: string) {
  return c.json({
    error: error.message,
    code: error.code,
    requestId,
    ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
  }, error.status as 400)
}

export function registerCustomAdminPageRoutes(
  api: Hono,
  getConfig: () => OpenShopConfig,
  directory: string,
) {
  api.get('/pages/custom', async (c) => {
    const config = getConfig()
    if (!customPagesEnabled(config.experimental)) return c.json({ navigation: [], pages: [] })
    try {
      const pages = runtimePages(directory)
      const navigation = validateCustomAdminNavigation(
        customPagesConfig(config.experimental)?.navigation,
        pages,
      )
      const access = await Promise.all(pages.map(async (page) => ({
        id: page.id,
        path: page.routePattern,
        allowed: page.routePattern.includes(':')
          ? false
          : await pageIsAllowed(c, config, pages, page, page.path),
      })))
      const authorizedNavigation = await Promise.all(navigation.map(async (item) => {
        const page = pages.find((candidate) => matchCustomAdminPath(candidate.routePattern, item.path))
        return page && await pageIsAllowed(c, config, pages, page, item.path) ? item : null
      }))
      const response: CustomAdminPagesResponse = {
        navigation: authorizedNavigation.filter((item): item is NonNullable<typeof item> => Boolean(item)),
        pages: access,
      }
      return c.json(response)
    } catch (error) {
      getRuntimeLogger().warn('[openshop] Custom admin page bootstrap failed; using built-in pages only', {
        directory,
        error: error instanceof Error ? error.message : String(error),
      })
      return c.json({ navigation: [], pages: [] } satisfies CustomAdminPagesResponse)
    }
  })

  api.get('/pages/custom/access', async (c) => {
    const config = getConfig()
    const pathname = c.req.query('path')
    if (!customPagesEnabled(config.experimental) || !pathname) {
      return c.json({ allowed: false }, 404)
    }
    const pages = runtimePages(directory)
    const page = pages.find((candidate) => matchCustomAdminPath(candidate.routePattern, pathname))
    if (!page) return c.json({ allowed: false }, 404)
    return c.json({ allowed: await pageIsAllowed(c, config, pages, page, pathname) })
  })

  api.post('/pages/custom/*', async (c) => {
    const startedAt = Date.now()
    const requestId = randomUUID()
    const config = getConfig()
    const logger = getRuntimeLogger()
    const metadata: Record<string, unknown> = {
      requestId,
      shop: getShop(c),
      shopifyApp: getShopifyApp(c),
      actorId: getAdminActor(c).id,
    }

    try {
      if (!customPagesEnabled(config.experimental)) {
        throw new AdminPublicError('NOT_FOUND', 'Not found', { status: 404 })
      }
      const suffix = c.req.path.split('/pages/custom')[1] ?? ''
      const marker = '/_rpc/'
      const markerIndex = suffix.lastIndexOf(marker)
      if (markerIndex < 1) throw new AdminPublicError('NOT_FOUND', 'Not found', { status: 404 })
      const pagePath = suffix.slice(0, markerIndex)
      const [kind, encodedName, ...rest] = suffix.slice(markerIndex + marker.length).split('/')
      if (rest.length > 0 || (kind !== 'loader' && kind !== 'action') || !encodedName) {
        throw new AdminPublicError('NOT_FOUND', 'Not found', { status: 404 })
      }
      const name = decodeURIComponent(encodedName)
      const pages = runtimePages(directory)
      const page = pages.find((candidate) => matchCustomAdminPath(candidate.routePattern, pagePath))
      if (!page) throw new AdminPublicError('NOT_FOUND', 'Not found', { status: 404 })
      const params = extractParams(page.routePattern, pagePath)
      if (!params) throw new AdminPublicError('NOT_FOUND', 'Not found', { status: 404 })
      const modules = await loadServerModules(pages, page)
      const module = await loadServerModule(page)
      const definition = module[name] as AnyAdminFunctionDefinition | undefined
      if (!definition || definition.kind !== kind || typeof definition.handler !== 'function') {
        throw new AdminPublicError('NOT_FOUND', 'Not found', { status: 404 })
      }
      const context = await createContext(c, config, params, requestId)
      if (!(await isAllowed(modules, context, definition.authorize))) {
        throw new AdminPublicError('FORBIDDEN', 'Forbidden', { status: 403 })
      }

      const body = await c.req.json<{ input?: unknown }>().catch(() => ({ input: undefined }))
      let input = body.input
      if (definition.input) {
        const result = definition.input(input)
        if (result instanceof type.errors) {
          throw new AdminPublicError('INVALID_INPUT', result.summary, { status: 422 })
        }
        input = result
      } else if (kind === 'action') {
        throw new AdminPublicError('INVALID_ACTION', 'Action input schema is required', { status: 500 })
      }

      const output = await definition.handler(context, input)
      if (definition.output) {
        const result = definition.output(output)
        if (result instanceof type.errors) throw new Error(`Invalid output: ${result.summary}`)
      }
      const serializedOutput = JSON.stringify(output)
      if (serializedOutput === undefined) throw new Error('Admin function output is not JSON-serializable')
      Object.assign(metadata, { pageId: page.id, functionName: name, kind, status: 200 })
      logger.info('[openshop] Custom admin function completed', {
        ...metadata,
        durationMs: Date.now() - startedAt,
      })
      return c.body(serializedOutput, 200, {
        'content-type': 'application/json; charset=UTF-8',
      })
    } catch (error) {
      if (error instanceof AdminPublicError) {
        Object.assign(metadata, { status: error.status, code: error.code })
        logger.warn('[openshop] Custom admin function rejected', {
          ...metadata,
          durationMs: Date.now() - startedAt,
        })
        return publicErrorResponse(c, error, requestId)
      }
      logger.error('[openshop] Custom admin function failed', {
        ...metadata,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR', requestId }, 500)
    }
  })
}
