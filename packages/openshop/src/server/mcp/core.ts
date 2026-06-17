import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { dispatchFlow } from '#engine/dispatch'
import { getDb } from '#db/client'
import { cronOverrides, flowRuns, installations } from '#db/schema'
import type { McpExecutionContext, McpResourceDefinition, McpToolDefinition, OpenShopConfig } from '#types'
import { getFilteredRunLogs } from '#server/api-routes/run-logs'
import { decryptString } from '#server/crypto'
import { normalizeShopDomain } from '#server/shop-domain'
import { coreMcpPermissions } from './registry.ts'

interface CoreCapabilities {
  tools: Record<string, McpToolDefinition>
  resources: Record<string, McpResourceDefinition>
}

function stringInput(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function booleanInput(input: Record<string, unknown>, key: string): boolean | null {
  const value = input[key]
  return typeof value === 'boolean' ? value : null
}

function objectInput(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = input[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberInput(input: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = input[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(1, Math.floor(value)), max)
}

async function assertRunVisible(ctx: McpExecutionContext, runId: string): Promise<void> {
  const db = getDb()
  const [run] = await db.select({ id: flowRuns.id })
    .from(flowRuns)
    .where(and(eq(flowRuns.id, runId), eq(flowRuns.appHandle, ctx.appHandle), eq(flowRuns.shop, ctx.shop)))
    .limit(1)

  if (!run) throw new Error('Run not found')
}

function textResult(text: string, structuredContent?: unknown) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent === undefined ? {} : { structuredContent }),
  }
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function latestStableShopifyAdminApiVersion(now = new Date()): string {
  const releaseMonths = [9, 6, 3, 0]
  const year = now.getUTCFullYear()
  const nowMs = now.getTime()

  for (const month of releaseMonths) {
    if (nowMs >= Date.UTC(year, month, 1, 17)) {
      return `${year}-${String(month + 1).padStart(2, '0')}`
    }
  }

  return `${year - 1}-10`
}

function apiVersionInput(input: Record<string, unknown>): string {
  const requested = stringInput(input, 'apiVersion')
  const value = requested === null || requested === 'latest'
    ? latestStableShopifyAdminApiVersion()
    : requested
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error('apiVersion must use YYYY-MM format or "latest"')
  return value
}

async function listInstalledShops(appHandle: string) {
  return getDb().select({
    shop: installations.shop,
    scopes: installations.scopes,
    installedAt: installations.installedAt,
  })
    .from(installations)
    .where(and(
      eq(installations.appHandle, appHandle),
      isNotNull(installations.accessToken),
      isNull(installations.uninstalledAt),
    ))
    .orderBy(asc(installations.shop))
}

async function runAdminGraphql(ctx: McpExecutionContext, input: Record<string, unknown>) {
  const shopInput = stringInput(input, 'shop')
  const shop = normalizeShopDomain(shopInput)
  if (!shop) throw new Error('shop must be a myshopify.com domain')

  const query = stringInput(input, 'query')
  if (!query) throw new Error('query is required')

  const variables = objectInput(input, 'variables')
  const apiVersion = apiVersionInput(input)
  const [installation] = await getDb().select({
    shop: installations.shop,
    accessToken: installations.accessToken,
  })
    .from(installations)
    .where(and(
      eq(installations.appHandle, ctx.appHandle),
      eq(installations.shop, shop),
      isNotNull(installations.accessToken),
      isNull(installations.uninstalledAt),
    ))
    .limit(1)

  const accessToken = decryptString(installation?.accessToken)
  if (!accessToken) throw new Error(`Shop "${shop}" is not installed for app "${ctx.appHandle}"`)

  const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
    signal: ctx.signal,
  })
  const text = await response.text()
  let parsed: unknown = text
  try { parsed = text ? JSON.parse(text) : null } catch { /* keep raw text */ }

  const result = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? { shop, apiVersion, status: response.status, ok: response.ok, ...parsed as Record<string, unknown> }
    : { shop, apiVersion, status: response.status, ok: response.ok, responseText: text }
  return textResult(jsonText(result), result)
}

export function createCoreMcpCapabilities(getConfig: () => OpenShopConfig): CoreCapabilities {
  const tools: Record<string, McpToolDefinition> = {
    'openshop.shops.list': {
      description: 'List installed shops for this OpenShop app.',
      requiredPermissions: [],
      riskLevel: 'low',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      async run(ctx) {
        const shops = await listInstalledShops(ctx.appHandle)
        return textResult(jsonText({ shops }), { shops })
      },
    },

    'openshop.admin.graphql': {
      description: 'Run arbitrary Shopify Admin GraphQL queries and mutations for an installed shop.',
      requiredPermissions: ['shopify_admin_graphql'],
      riskLevel: 'high',
      confirmationHint: 'This can read or mutate Shopify Admin data depending on the app OAuth scopes and GraphQL document.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['shop', 'query'],
        properties: {
          shop: { type: 'string', description: 'Installed shop domain from openshop.shops.list.' },
          query: { type: 'string', description: 'Shopify Admin GraphQL query or mutation.' },
          variables: { type: 'object', description: 'GraphQL variables object.' },
          apiVersion: { type: 'string', description: 'Shopify Admin API version, for example 2026-04. Defaults to the latest stable version when omitted or set to "latest".' },
        },
      },
      run: runAdminGraphql,
    },

    'openshop.logs.search': {
      description: 'Search logs for a visible OpenShop flow run.',
      requiredPermissions: ['read_logs'],
      riskLevel: 'low',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['runId'],
        properties: {
          runId: { type: 'string', description: 'Flow run UUID.' },
          q: { type: 'string', description: 'Log search query.' },
          levels: { type: 'string', description: 'Comma-separated log levels. Defaults to info,warn,error.' },
          includeContext: { type: 'boolean', description: 'Include contextual logs around matches. Defaults to true.' },
          limit: { type: 'number', minimum: 1, maximum: 200, description: 'Maximum logs returned. Defaults to 50.' },
        },
      },
      async run(ctx, input) {
        const runId = stringInput(input, 'runId')
        if (!runId) throw new Error('runId is required')
        await assertRunVisible(ctx, runId)

        const limit = numberInput(input, 'limit', 50, 200)
        const result = await getFilteredRunLogs(runId, {
          query: stringInput(input, 'q') ?? '',
          levelsParam: stringInput(input, 'levels') ?? 'info,warn,error',
          includeContext: booleanInput(input, 'includeContext') ?? true,
        })
        const logs = result.logs.slice(0, limit)
        return textResult(jsonText({ ...result, logs, returned: logs.length }), { ...result, logs, returned: logs.length })
      },
    },

    'openshop.flows.list': {
      description: 'List configured OpenShop flows.',
      requiredPermissions: ['read_flows'],
      riskLevel: 'low',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      run() {
        const config = getConfig()
        const flows = Object.entries(config.flows).map(([name, flow]) => ({
          name,
          inputSchema: flow.input?.json ?? null,
          crons: config.crons?.filter((cron) => cron.flow === name).map((cron) => ({
            name: cron.name ?? null,
            schedule: cron.schedule,
            shops: cron.shops ?? 'global',
          })) ?? [],
        }))
        return textResult(jsonText({ flows }), { flows })
      },
    },

    'openshop.flows.run': {
      description: 'Trigger an OpenShop flow for the authenticated shop.',
      requiredPermissions: ['run_flows'],
      riskLevel: 'high',
      confirmationHint: 'Runs can call Shopify and external providers depending on the flow implementation.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['flow'],
        properties: {
          flow: { type: 'string', description: 'Flow name.' },
          input: { type: 'object', description: 'Flow input object.' },
        },
      },
      async run(ctx, input) {
        const config = getConfig()
        const flow = stringInput(input, 'flow')
        if (!flow) throw new Error('flow is required')
        if (!config.flows[flow]) throw new Error(`Unknown flow "${flow}"`)
        const result = await dispatchFlow({
          flowName: flow,
          input: objectInput(input, 'input'),
          config,
          shopifyApp: ctx.appHandle,
          shop: ctx.shop,
        })
        return textResult(jsonText(result), result)
      },
    },

    'openshop.crons.list': {
      description: 'List configured OpenShop crons with per-shop enabled state.',
      requiredPermissions: ['read_crons'],
      riskLevel: 'low',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      async run(ctx) {
        const config = getConfig()
        const overrides = await getDb().select().from(cronOverrides)
          .where(and(eq(cronOverrides.appHandle, ctx.appHandle), eq(cronOverrides.shop, ctx.shop)))
        const overrideMap = new Map(overrides.map((override) => [override.cronKey, override.enabled]))
        const crons = (config.crons ?? []).map((cron, index) => {
          const key = `${cron.flow}:${cron.schedule}`
          return {
            index,
            key,
            name: cron.name ?? null,
            flow: cron.flow,
            schedule: cron.schedule,
            shops: cron.shops ?? 'global',
            input: cron.input ?? null,
            enabled: overrideMap.get(key) ?? true,
          }
        })
        return textResult(jsonText({ crons }), { crons })
      },
    },

    'openshop.crons.set_enabled': {
      description: 'Enable or disable a configured OpenShop cron for the authenticated shop.',
      requiredPermissions: ['manage_crons'],
      riskLevel: 'medium',
      confirmationHint: 'Disabling a cron can stop scheduled automation for this shop.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'enabled'],
        properties: {
          key: { type: 'string', description: 'Cron key from openshop.crons.list.' },
          enabled: { type: 'boolean' },
        },
      },
      async run(ctx, input) {
        const key = stringInput(input, 'key')
        const enabled = booleanInput(input, 'enabled')
        if (!key) throw new Error('key is required')
        if (enabled === null) throw new Error('enabled is required')

        await getDb().insert(cronOverrides)
          .values({ appHandle: ctx.appHandle, shop: ctx.shop, cronKey: key, enabled })
          .onConflictDoUpdate({
            target: [cronOverrides.appHandle, cronOverrides.shop, cronOverrides.cronKey],
            set: { enabled, updatedAt: new Date() },
          })

        return textResult(jsonText({ ok: true, key, enabled }), { ok: true, key, enabled })
      },
    },
  }

  const resources: Record<string, McpResourceDefinition> = {
    'openshop://docs/log-search': {
      name: 'Log search guide',
      description: 'How to search OpenShop logs through MCP.',
      mimeType: 'text/markdown',
      requiredPermissions: ['read_logs'],
      read() {
        return [
          '# OpenShop log search',
          '',
          'Use the `openshop.logs.search` tool with `read_logs` permission.',
          '',
          'Input fields:',
          '- `runId` is required and must be a flow run visible to the token shop/app.',
          '- `q` accepts the same query syntax as the OpenShop admin log search.',
          '- `levels` defaults to `info,warn,error`.',
          '- `includeContext` defaults to `true`.',
          '- `limit` defaults to `50` and is capped at `200`.',
        ].join('\n')
      },
    },
    'openshop://permissions': {
      name: 'MCP permission catalog',
      description: 'Core and custom MCP permission definitions visible to this OpenShop app.',
      mimeType: 'application/json',
      requiredPermissions: [],
      read() {
        const core = coreMcpPermissions()
        const custom = getConfig().mcp?.permissions?.custom ?? {}
        return {
          text: jsonText({
            core: Object.fromEntries(Object.entries(core).map(([key, permission]) => [
              key,
              {
                label: permission.label,
                description: permission.description,
                group: permission.group,
                riskLevel: permission.riskLevel,
              },
            ])),
            custom,
          }),
          mimeType: 'application/json',
        }
      },
    },
    'openshop://tools/openshop.logs.search': {
      name: 'openshop.logs.search reference',
      description: 'Tool reference for OpenShop log search.',
      mimeType: 'application/json',
      requiredPermissions: ['read_logs'],
      read() {
        const tool = tools['openshop.logs.search']
        return {
          text: jsonText({
            name: 'openshop.logs.search',
            description: tool.description,
            requiredPermissions: tool.requiredPermissions,
            inputSchema: tool.inputSchema,
          }),
          mimeType: 'application/json',
        }
      },
    },
    'openshop://runs/recent': {
      name: 'Recent flow runs',
      description: 'Recent flow runs for the authenticated shop.',
      mimeType: 'application/json',
      requiredPermissions: ['read_flows'],
      async read(ctx) {
        const runs = await getDb().select({
          id: flowRuns.id,
          flowName: flowRuns.flowName,
          status: flowRuns.status,
          createdAt: flowRuns.createdAt,
          completedAt: flowRuns.completedAt,
        })
          .from(flowRuns)
          .where(and(eq(flowRuns.appHandle, ctx.appHandle), eq(flowRuns.shop, ctx.shop)))
          .orderBy(desc(flowRuns.createdAt))
          .limit(20)
        return { text: jsonText({ runs }), mimeType: 'application/json' }
      },
    },
  }

  return { tools, resources }
}
