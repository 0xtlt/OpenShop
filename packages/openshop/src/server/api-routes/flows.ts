import type { Hono } from 'hono'
import type { OpenShopConfig } from '#types'

export function registerFlowRoutes(api: Hono, getConfig: () => OpenShopConfig) {
  api.get('/flows', (c) => {
    const config = getConfig()
    const flows = Object.entries(config.flows).map(([name, flow]) => ({
      name,
      crons: config.crons?.filter((cr) => cr.flow === name) ?? [],
      inputSchema: flow.input?.json ?? null,
    }))
    return c.json(flows)
  })
}
