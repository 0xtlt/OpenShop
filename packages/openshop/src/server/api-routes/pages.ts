import type { Hono } from 'hono'
import { resolveAdminPages } from '../../config/pages.ts'
import type { OpenShopConfig } from '#types'

export function registerPageRoutes(api: Hono, getConfig: () => OpenShopConfig) {
  api.get('/pages', (c) => c.json(resolveAdminPages(getConfig().pages)))
}
