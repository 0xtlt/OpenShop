import { Hono } from 'hono'
import type { OpenShopConfig } from '#types'
import { registerFlowRoutes } from '#server/api-routes/flows'
import { registerCronRoutes } from '#server/api-routes/crons'
import { registerRunRoutes } from '#server/api-routes/runs'
import { registerProviderRoutes } from '#server/api-routes/providers'
import { registerMcpAdminRoutes } from '#server/api-routes/mcp'

export function createApiRoutes(getConfig: () => OpenShopConfig) {
  const api = new Hono()

  registerFlowRoutes(api, getConfig)
  registerCronRoutes(api, getConfig)
  registerRunRoutes(api, getConfig)
  registerProviderRoutes(api, getConfig)
  registerMcpAdminRoutes(api, getConfig)

  return api
}
