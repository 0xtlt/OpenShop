import { Hono, type Context } from 'hono'
import type { OpenShopConfig } from '#types'
import { getShop, getShopifyApp } from '#server/shop'
import { FunctionManagement, FunctionManagementError } from '#server/function-management/index'
import { ShopifyGraphqlAdminAdapter } from '#server/function-management/shopify-admin-adapter'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readInstanceInput(req: { json: <T>() => Promise<T> }) {
  let raw: unknown
  try {
    raw = await req.json<unknown>()
  } catch {
    throw new FunctionManagementError('invalid_request', 400, 'Request body must be valid JSON')
  }
  if (!isRecord(raw)) {
    throw new FunctionManagementError('invalid_request', 400, 'Request body must be an object')
  }
  const unexpected = Object.keys(raw).find((key) => key !== 'settings' && key !== 'config')
  if (unexpected) {
    throw new FunctionManagementError('invalid_request', 400, `Request field "${unexpected}" is not supported`)
  }
  if (raw.settings !== undefined && !isRecord(raw.settings)) {
    throw new FunctionManagementError('invalid_request', 400, 'settings must be an object')
  }
  if (raw.config !== undefined && !isRecord(raw.config)) {
    throw new FunctionManagementError('invalid_request', 400, 'config must be an object')
  }
  return {
    ...(raw.settings === undefined ? {} : { settings: raw.settings }),
    ...(raw.config === undefined ? {} : { config: raw.config }),
  }
}

function functionDefinitions(config: OpenShopConfig) {
  return config.functions ?? {}
}

function errorPayload(error: FunctionManagementError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  }
}

async function withErrors<T>(
  operation: () => Promise<T>,
  success: (value: T) => Response,
): Promise<Response> {
  try {
    return success(await operation())
  } catch (error) {
    if (error instanceof FunctionManagementError) {
      return Response.json(errorPayload(error), { status: error.status })
    }
    return Response.json({
      error: { code: 'internal_error', message: 'Unexpected function management error' },
    }, { status: 500 })
  }
}

export function createFunctionRoutes(getConfig: () => OpenShopConfig) {
  const api = new Hono()

  api.get('/functions', (c) => {
    const management = new FunctionManagement(functionDefinitions(getConfig()))
    return c.json(management.catalogue())
  })

  const managementFor = async (c: Context) => {
    const { createShopifyClient } = await import('../shopify/client.ts')
    const client = await createShopifyClient(getShop(c), getShopifyApp(c))
    return new FunctionManagement(
      functionDefinitions(getConfig()),
      new ShopifyGraphqlAdminAdapter(client),
    )
  }

  api.get('/functions/:handle/instances', async (c) => withErrors(
    async () => (await managementFor(c)).inspect(c.req.param('handle')),
    (instances) => Response.json(instances),
  ))

  api.post('/functions/:handle/instances', async (c) => withErrors(
    async () => {
      const input = await readInstanceInput(c.req)
      return (await managementFor(c)).execute(c.req.param('handle'), { action: 'create', input })
    },
    (result) => Response.json(result, { status: 201 }),
  ))

  api.put('/functions/:handle/instances/:id', async (c) => withErrors(
    async () => {
      const input = await readInstanceInput(c.req)
      return (await managementFor(c)).execute(c.req.param('handle'), {
        action: 'update',
        id: c.req.param('id'),
        input,
      })
    },
    (result) => Response.json(result),
  ))

  api.delete('/functions/:handle/instances/:id', async (c) => withErrors(
    async () => {
      const rawMode = c.req.query('mode')
      if (rawMode !== undefined && rawMode !== 'automatic' && rawMode !== 'code') {
        throw new FunctionManagementError('invalid_request', 400, 'mode must be automatic or code')
      }
      return (await managementFor(c)).execute(c.req.param('handle'), {
        action: 'delete',
        id: c.req.param('id'),
        ...(rawMode ? { mode: rawMode } : {}),
      })
    },
    (result) => Response.json(result),
  ))

  return api
}
