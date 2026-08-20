import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '#db/client'
import { installations } from '#db/schema'
import { buildConnectors, type RuntimeConnectors } from '#server/connectors'
import { scanRouteDir } from '#server/file-routes'
import { normalizeShopDomain } from '#server/shop-domain'
import { resolveShopifyAppByHandle } from '#server/shopify-apps'
import type {
  OpenShopConfig,
  RouteShopContext,
  RouteShopInput,
  ServerRouteDefinition,
  ServerRouteHandler,
  ServerRouteRequestContext,
} from '#types'
import { getRuntimeLogger } from '../runtime/logger.ts'

const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const
type ServerRouteMethod = typeof methods[number]
type RuntimeRouteDefinition = ServerRouteDefinition<unknown, RuntimeConnectors>

function routeHandlers(definition: RuntimeRouteDefinition): ServerRouteMethod[] {
  return methods.filter((method) => typeof definition[method] === 'function')
}

function assertRouteDefinition(value: unknown, routePath: string): asserts value is RuntimeRouteDefinition {
  if (!value || typeof value !== 'object') {
    throw new Error(`[openshop] Invalid server route ${routePath}: expected an object definition`)
  }

  const definition = value as Partial<RuntimeRouteDefinition>
  if (definition.auth !== 'none' && typeof definition.auth !== 'function') {
    throw new Error(`[openshop] Invalid server route ${routePath}: auth must be "none" or a function`)
  }

  for (const method of methods) {
    const handler = definition[method]
    if (handler !== undefined && typeof handler !== 'function') {
      throw new Error(`[openshop] Invalid server route ${routePath}: ${method} must be a function`)
    }
  }

  if (routeHandlers(definition as RuntimeRouteDefinition).length === 0) {
    throw new Error(`[openshop] Invalid server route ${routePath}: define at least one HTTP method`)
  }
}

async function resolveShopContext(
  getConfig: () => OpenShopConfig,
  input: RouteShopInput,
): Promise<RouteShopContext<RuntimeConnectors>> {
  const shop = normalizeShopDomain(input.shop)
  if (!shop) throw new Error('[openshop] Invalid shop domain')

  const config = getConfig()
  const shopifyApp = resolveShopifyAppByHandle(config, input.shopifyApp)
  const [installation] = await getDb()
    .select({ id: installations.id })
    .from(installations)
    .where(and(
      eq(installations.appHandle, shopifyApp.handle),
      eq(installations.shop, shop),
      isNotNull(installations.accessToken),
      isNull(installations.uninstalledAt),
    ))
    .limit(1)

  if (!installation) throw new Error('[openshop] Shop is not actively installed')

  return {
    shop,
    shopifyApp: shopifyApp.handle,
    connectors: await buildConnectors(config, shop, shopifyApp.handle),
  }
}

function requestContext(
  request: Request,
  params: Record<string, string>,
  getConfig: () => OpenShopConfig,
): ServerRouteRequestContext<RuntimeConnectors> {
  return {
    request,
    params,
    forShop: (input) => resolveShopContext(getConfig, input),
  }
}

function internalError(): Response {
  return Response.json({ error: 'Internal server route error' }, { status: 500 })
}

export async function createServerRoutes(
  routesDir: string,
  getConfig: () => OpenShopConfig,
): Promise<Hono> {
  const app = new Hono()
  const logger = getRuntimeLogger()
  const files = scanRouteDir(routesDir)

  for (const { filePath, routePath } of files) {
    let definition: unknown
    try {
      const mod = await import(filePath)
      definition = mod.default ?? mod
    } catch (error) {
      throw new Error(`[openshop] Failed to load server route ${routePath}`, { cause: error })
    }

    assertRouteDefinition(definition, routePath)
    const allowedMethods = routeHandlers(definition)

    app.all(routePath, async (c) => {
      const method = c.req.method.toUpperCase() as ServerRouteMethod
      const handler = methods.includes(method)
        ? definition[method] as ServerRouteHandler<unknown, RuntimeConnectors> | undefined
        : undefined
      if (!handler) {
        c.header('Allow', allowedMethods.join(', '))
        return c.json({ error: 'Method not allowed' }, 405)
      }

      const params = c.req.param() as Record<string, string>
      let auth: unknown

      if (definition.auth !== 'none') {
        try {
          const result = await definition.auth(requestContext(c.req.raw.clone(), params, getConfig))
          if (result === null) return c.json({ error: 'Unauthorized' }, 401)
          if (result instanceof Response) return result
          auth = result
        } catch (error) {
          logger.error(`[openshop] Server route authentication error for ${method} ${routePath}`, { error })
          return internalError()
        }
      }

      try {
        const response = await handler({
          ...requestContext(c.req.raw, params, getConfig),
          auth,
        })
        if (!(response instanceof Response)) {
          logger.error(`[openshop] Server route ${method} ${routePath} did not return a Response`)
          return internalError()
        }
        return response
      } catch (error) {
        logger.error(`[openshop] Server route error for ${method} ${routePath}`, { error })
        return internalError()
      }
    })

    logger.info(`[openshop] Server route: ${routePath} (${allowedMethods.join(', ')})`)
  }

  if (files.length) logger.info(`[openshop] ${files.length} server route(s) registered`)
  return app
}
