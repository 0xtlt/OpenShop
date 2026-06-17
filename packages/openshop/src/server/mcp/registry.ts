import type { McpConfig, McpPermissionDefinition, McpResourceDefinition, McpRiskLevel, McpToolDefinition, OpenShopConfig } from '#types'

export interface RegisteredMcpPermission extends McpPermissionDefinition {
  key: string
  source: 'core' | 'custom'
  group: string
  riskLevel: McpRiskLevel
}

export interface RegisteredMcpTool extends McpToolDefinition {
  name: string
  source: 'core' | 'custom'
}

export interface RegisteredMcpResource extends McpResourceDefinition {
  uri: string
  source: 'core' | 'custom'
}

export interface McpRegistry {
  enabled: boolean
  permissions: Record<string, RegisteredMcpPermission>
  tools: Record<string, RegisteredMcpTool>
  resources: Record<string, RegisteredMcpResource>
}

const corePermissionDefinitions: Record<string, McpPermissionDefinition> = {
  read_logs: {
    label: 'Read logs',
    description: 'Read OpenShop flow run logs.',
    group: 'Observability',
    riskLevel: 'low',
  },
  read_flows: {
    label: 'Read flows',
    description: 'List OpenShop flows and their schemas.',
    group: 'Flows',
    riskLevel: 'low',
  },
  run_flows: {
    label: 'Run flows',
    description: 'Trigger OpenShop flow runs.',
    group: 'Flows',
    riskLevel: 'high',
  },
  read_crons: {
    label: 'Read crons',
    description: 'List configured OpenShop crons.',
    group: 'Automation',
    riskLevel: 'low',
  },
  manage_crons: {
    label: 'Manage crons',
    description: 'Enable or disable OpenShop crons.',
    group: 'Automation',
    riskLevel: 'medium',
  },
  read_providers: {
    label: 'Read providers',
    description: 'List provider status and public field metadata.',
    group: 'Providers',
    riskLevel: 'low',
  },
  write_providers: {
    label: 'Write providers',
    description: 'Update provider configuration.',
    group: 'Providers',
    riskLevel: 'high',
  },
  read_functions: {
    label: 'Read functions',
    description: 'Read Shopify Function definitions and instances.',
    group: 'Functions',
    riskLevel: 'low',
  },
  manage_mcp_tokens: {
    label: 'Manage MCP tokens',
    description: 'Create, revoke and grant MCP tokens.',
    group: 'MCP',
    riskLevel: 'high',
  },
  shopify_admin_graphql: {
    label: 'Shopify Admin GraphQL',
    description: 'Run arbitrary Shopify Admin GraphQL queries and mutations for installed shops.',
    group: 'Shopify Admin',
    riskLevel: 'high',
  },
}

const corePermissionKeyPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const customPermissionKeyPattern = /^[a-z][a-z0-9-]*:[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const toolNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const resourceUriPattern = /^[a-z][a-z0-9+.-]*:\/\/.+/
const forbiddenPermissionKeys = new Set(['*', 'all', 'admin', 'root', 'full_access', 'full-access'])

function fail(message: string): never {
  throw new Error(`[openshop] Invalid MCP config: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function coreMcpPermissions(): Record<string, RegisteredMcpPermission> {
  return Object.fromEntries(Object.entries(corePermissionDefinitions).map(([key, permission]) => [
    key,
    {
      ...permission,
      key,
      source: 'core' as const,
      group: permission.group ?? 'General',
      riskLevel: permission.riskLevel ?? 'low',
    },
  ]))
}

function assertPermissionKey(key: string, source: 'core' | 'custom'): void {
  if (forbiddenPermissionKeys.has(key)) fail(`permission "${key}" is not allowed`)
  if (source === 'core') {
    if (!corePermissionKeyPattern.test(key)) fail(`core permission "${key}" must use snake_case`)
    return
  }
  if (!customPermissionKeyPattern.test(key)) {
    fail(`custom permission "${key}" must use namespace:action_resource`)
  }
}

function normalizePermissions(custom: McpConfig['permissions']): Record<string, RegisteredMcpPermission> {
  const permissions = coreMcpPermissions()
  const customPermissions = custom?.custom ?? {}

  if (!isRecord(customPermissions)) fail('permissions.custom must be an object')

  for (const [key, permission] of Object.entries(customPermissions)) {
    assertPermissionKey(key, 'custom')
    if (permissions[key]) fail(`custom permission "${key}" conflicts with a core permission`)
    if (!isRecord(permission)) fail(`permissions.custom.${key} must be an object`)
    if (typeof permission.label !== 'string' || permission.label.trim() === '') {
      fail(`permissions.custom.${key}.label must be a non-empty string`)
    }
    permissions[key] = {
      ...permission,
      key,
      source: 'custom',
      group: permission.group ?? key.split(':')[0] ?? 'Custom',
      riskLevel: permission.riskLevel ?? 'medium',
    }
  }

  return permissions
}

function assertKnownPermissions(
  ownerPath: string,
  requiredPermissions: unknown,
  permissions: Record<string, RegisteredMcpPermission>,
): string[] {
  if (!Array.isArray(requiredPermissions)) fail(`${ownerPath}.requiredPermissions must be an array`)
  const keys = requiredPermissions.map((permission) => {
    if (typeof permission !== 'string' || permission.trim() === '') fail(`${ownerPath}.requiredPermissions must contain strings`)
    if (!permissions[permission]) fail(`${ownerPath} references unknown permission "${permission}"`)
    return permission
  })
  return [...new Set(keys)]
}

function normalizeTools(
  configTools: McpConfig['tools'],
  coreTools: Record<string, McpToolDefinition>,
  permissions: Record<string, RegisteredMcpPermission>,
): Record<string, RegisteredMcpTool> {
  const tools: Record<string, RegisteredMcpTool> = {}

  for (const [name, tool] of Object.entries(coreTools)) {
    tools[name] = {
      ...tool,
      name,
      source: 'core',
      requiredPermissions: assertKnownPermissions(`mcp.coreTools.${name}`, tool.requiredPermissions, permissions),
    }
  }

  const customTools = configTools ?? {}
  if (!isRecord(customTools)) fail('mcp.tools must be an object')

  for (const [name, tool] of Object.entries(customTools)) {
    if (!toolNamePattern.test(name)) fail(`mcp.tools.${name} has an invalid tool name`)
    if (tools[name]) fail(`mcp.tools.${name} conflicts with a core tool`)
    if (!isRecord(tool)) fail(`mcp.tools.${name} must be an object`)
    if (typeof tool.description !== 'string' || tool.description.trim() === '') fail(`mcp.tools.${name}.description must be a non-empty string`)
    if (typeof tool.run !== 'function') fail(`mcp.tools.${name}.run must be a function`)
    tools[name] = {
      ...tool,
      name,
      source: 'custom',
      requiredPermissions: assertKnownPermissions(`mcp.tools.${name}`, tool.requiredPermissions, permissions),
    }
  }

  return tools
}

function normalizeResources(
  configResources: McpConfig['resources'],
  coreResources: Record<string, McpResourceDefinition>,
  permissions: Record<string, RegisteredMcpPermission>,
): Record<string, RegisteredMcpResource> {
  const resources: Record<string, RegisteredMcpResource> = {}

  for (const [uri, resource] of Object.entries(coreResources)) {
    resources[uri] = {
      ...resource,
      uri,
      source: 'core',
      requiredPermissions: assertKnownPermissions(`mcp.coreResources.${uri}`, resource.requiredPermissions, permissions),
    }
  }

  const customResources = configResources ?? {}
  if (!isRecord(customResources)) fail('mcp.resources must be an object')

  for (const [uri, resource] of Object.entries(customResources)) {
    if (!resourceUriPattern.test(uri)) fail(`mcp.resources.${uri} must be a URI`)
    if (resources[uri]) fail(`mcp.resources.${uri} conflicts with a core resource`)
    if (!isRecord(resource)) fail(`mcp.resources.${uri} must be an object`)
    if (typeof resource.name !== 'string' || resource.name.trim() === '') fail(`mcp.resources.${uri}.name must be a non-empty string`)
    if (typeof resource.read !== 'function') fail(`mcp.resources.${uri}.read must be a function`)
    resources[uri] = {
      ...resource,
      uri,
      source: 'custom',
      requiredPermissions: assertKnownPermissions(`mcp.resources.${uri}`, resource.requiredPermissions, permissions),
    }
  }

  return resources
}

export function buildMcpRegistry(
  config: OpenShopConfig,
  core: {
    tools: Record<string, McpToolDefinition>
    resources: Record<string, McpResourceDefinition>
  },
): McpRegistry {
  const mcp = config.mcp
  const permissions = normalizePermissions(mcp?.permissions)

  return {
    enabled: mcp?.enabled !== false,
    permissions,
    tools: normalizeTools(mcp?.tools, core.tools, permissions),
    resources: normalizeResources(mcp?.resources, core.resources, permissions),
  }
}

export function hasAllPermissions(granted: Iterable<string>, required: readonly string[]): boolean {
  const grantedSet = granted instanceof Set ? granted : new Set(granted)
  return required.every((permission) => grantedSet.has(permission))
}
