import { Hono } from 'hono'
import { getDb } from '#db/client'
import { mcpAuditLogs } from '#db/schema'
import type { McpAuditStatus, McpCapabilityType, McpExecutionContext, McpResourceDefinition, McpToolDefinition, OpenShopConfig } from '#types'
import { createCoreMcpCapabilities } from '#server/mcp/core'
import { resolveMcpBearerToken, type ResolvedMcpToken } from '#server/mcp/auth'
import { buildMcpRegistry, hasAllPermissions } from '#server/mcp/registry'
import { validateMcpToolArguments } from '#server/mcp/schema'
import { normalizeShopDomain } from '#server/shop-domain'

type JsonRpcId = string | number | null
type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: unknown
}

const maxMcpPayloadBytes = 1_000_000
const maxMcpExecutionMs = 30_000

interface AuditInput {
  token: ResolvedMcpToken
  capabilityType?: McpCapabilityType
  capabilityName?: string
  permissionKeys?: string[]
  targetShop?: string
  status: McpAuditStatus
  error?: string
  durationMs?: number
  requestId?: string
}

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result }, { headers: { 'MCP-Protocol-Version': '2025-11-25' } })
}

function jsonRpcError(id: JsonRpcId | undefined, code: number, message: string, status = 200): Response {
  return Response.json(
    { jsonrpc: '2.0', id: id ?? null, error: { code, message } },
    { status, headers: { 'MCP-Protocol-Version': '2025-11-25' } },
  )
}

function paramsObject(params: unknown): Record<string, unknown> {
  return params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, unknown> : {}
}

async function readJsonRpcRequest(request: Request): Promise<JsonRpcRequest | null | 'too_large'> {
  const reader = request.body?.getReader()
  if (!reader) return null

  const chunks: Uint8Array[] = []
  let size = 0

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    size += value.byteLength
    if (size > maxMcpPayloadBytes) {
      await reader.cancel().catch(() => undefined)
      return 'too_large'
    }
    chunks.push(value)
  }

  const body = Buffer.concat(chunks).toString('utf8')
  if (!body.trim()) return null

  try {
    return JSON.parse(body) as JsonRpcRequest
  } catch {
    return null
  }
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T> | T,
  parentSignal: AbortSignal,
  label: string,
): Promise<T> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let removeAbortListener: (() => void) | undefined
  const abortError = () => new Error(`${label} aborted`)

  try {
    return await Promise.race([
      Promise.resolve().then(() => run(controller.signal)),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error(`${label} timed out after ${maxMcpExecutionMs}ms`))
        }, maxMcpExecutionMs)
      }),
      new Promise<never>((_, reject) => {
        if (parentSignal.aborted) {
          controller.abort()
          reject(abortError())
          return
        }
        const onAbort = () => {
          controller.abort()
          reject(abortError())
        }
        parentSignal.addEventListener('abort', onAbort, { once: true })
        removeAbortListener = () => parentSignal.removeEventListener('abort', onAbort)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    removeAbortListener?.()
  }
}

function textContent(text: string) {
  return [{ type: 'text' as const, text }]
}

function normalizeToolResult(result: unknown) {
  if (typeof result === 'string') return { content: textContent(result) }
  if (result && typeof result === 'object') {
    const maybe = result as { content?: unknown; structuredContent?: unknown }
    if (Array.isArray(maybe.content) || 'structuredContent' in maybe) return result
    return { content: textContent(JSON.stringify(result, null, 2)), structuredContent: result }
  }
  return { content: textContent(String(result ?? '')) }
}

async function audit(input: AuditInput): Promise<void> {
  await getDb().insert(mcpAuditLogs).values({
    appHandle: input.token.appHandle,
    shop: input.token.shop,
    tokenId: input.token.tokenId,
    capabilityType: input.capabilityType,
    capabilityName: input.capabilityName,
    permissionKeys: input.permissionKeys ?? [],
    targetShop: input.targetShop,
    status: input.status,
    error: input.error,
    durationMs: input.durationMs,
    requestId: input.requestId,
  })
}

function createContext(token: ResolvedMcpToken, signal: AbortSignal): McpExecutionContext {
  return {
    appHandle: token.appHandle,
    shop: token.shop,
    tokenId: token.tokenId,
    permissions: token.permissions,
    signal,
    db: getDb(),
  }
}

function listTools(tools: Record<string, McpToolDefinition & { name: string }>, permissions: string[]) {
  return {
    tools: Object.values(tools)
      .filter((tool) => hasAllPermissions(permissions, tool.requiredPermissions))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
      })),
  }
}

function listResources(resources: Record<string, McpResourceDefinition & { uri: string }>, permissions: string[]) {
  return {
    resources: Object.values(resources)
      .filter((resource) => hasAllPermissions(permissions, resource.requiredPermissions))
      .map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType ?? 'text/plain',
      })),
  }
}

export function createMcpRoutes(getConfig: () => OpenShopConfig) {
  const mcp = new Hono()

  mcp.post('/', async (c) => {
    const auth = await resolveMcpBearerToken(c.req.header('Authorization'))
    if (!auth.ok) {
      return Response.json({ error: auth.error }, { status: auth.status, headers: { 'MCP-Protocol-Version': '2025-11-25' } })
    }

    const registry = buildMcpRegistry(getConfig(), createCoreMcpCapabilities(getConfig))
    if (!registry.enabled) {
      return Response.json({ error: 'MCP is disabled' }, { status: 403, headers: { 'MCP-Protocol-Version': '2025-11-25' } })
    }

    const request = await readJsonRpcRequest(c.req.raw)
    if (request === 'too_large') {
      return Response.json({ error: 'MCP payload too large' }, { status: 413, headers: { 'MCP-Protocol-Version': '2025-11-25' } })
    }
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return jsonRpcError(null, -32600, 'Invalid JSON-RPC request', 400)
    }

    if (request.id === undefined && request.method.startsWith('notifications/')) {
      return new Response(null, { status: 202, headers: { 'MCP-Protocol-Version': '2025-11-25' } })
    }

    const startedAt = Date.now()
    const requestId = request.id === undefined || request.id === null ? undefined : String(request.id)
    let activeAudit: Pick<AuditInput, 'capabilityType' | 'capabilityName' | 'permissionKeys' | 'targetShop'> = {}

    try {
      switch (request.method) {
        case 'initialize':
          return jsonRpcResult(request.id, {
            protocolVersion: '2025-11-25',
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
            },
            serverInfo: { name: 'openshop', version: '0.1.1' },
          })

        case 'tools/list':
          return jsonRpcResult(request.id, listTools(registry.tools, auth.token.permissions))

        case 'tools/call': {
          const params = paramsObject(request.params)
          const name = typeof params.name === 'string' ? params.name : ''
          const tool = registry.tools[name]
          if (!tool) return jsonRpcError(request.id, -32602, `Unknown tool "${name}"`)
          activeAudit = { capabilityType: 'tool', capabilityName: name, permissionKeys: tool.requiredPermissions }
          if (!hasAllPermissions(auth.token.permissions, tool.requiredPermissions)) {
            await audit({
              token: auth.token,
              capabilityType: 'tool',
              capabilityName: name,
              permissionKeys: tool.requiredPermissions,
              status: 'denied',
              error: 'Permission denied',
              durationMs: Date.now() - startedAt,
              requestId,
            })
            return jsonRpcError(request.id, -32003, `Permission denied for tool "${name}"`)
          }

          const input = validateMcpToolArguments(tool.inputSchema, params.arguments)
          if (!input.ok) return jsonRpcError(request.id, -32602, input.error)
          if (name === 'openshop.admin.graphql') {
            const targetShop = typeof input.value.shop === 'string' ? normalizeShopDomain(input.value.shop) : null
            if (targetShop) activeAudit = { ...activeAudit, targetShop }
          }

          const result = await withTimeout(
            (signal) => tool.run(createContext(auth.token, signal), input.value),
            c.req.raw.signal,
            `Tool "${name}"`,
          )
          await audit({
            token: auth.token,
            ...activeAudit,
            status: 'success',
            durationMs: Date.now() - startedAt,
            requestId,
          })
          return jsonRpcResult(request.id, normalizeToolResult(result))
        }

        case 'resources/list':
          return jsonRpcResult(request.id, listResources(registry.resources, auth.token.permissions))

        case 'resources/read': {
          const params = paramsObject(request.params)
          const uri = typeof params.uri === 'string' ? params.uri : ''
          const resource = registry.resources[uri]
          if (!resource) return jsonRpcError(request.id, -32602, `Unknown resource "${uri}"`)
          activeAudit = { capabilityType: 'resource', capabilityName: uri, permissionKeys: resource.requiredPermissions }
          if (!hasAllPermissions(auth.token.permissions, resource.requiredPermissions)) {
            await audit({
              token: auth.token,
              capabilityType: 'resource',
              capabilityName: uri,
              permissionKeys: resource.requiredPermissions,
              status: 'denied',
              error: 'Permission denied',
              durationMs: Date.now() - startedAt,
              requestId,
            })
            return jsonRpcError(request.id, -32003, `Permission denied for resource "${uri}"`)
          }

          const read = await withTimeout(
            (signal) => resource.read(createContext(auth.token, signal)),
            c.req.raw.signal,
            `Resource "${uri}"`,
          )
          const content = typeof read === 'string' ? { text: read, mimeType: resource.mimeType ?? 'text/plain' } : read
          await audit({
            token: auth.token,
            ...activeAudit,
            status: 'success',
            durationMs: Date.now() - startedAt,
            requestId,
          })
          return jsonRpcResult(request.id, {
            contents: [{
              uri,
              mimeType: content.mimeType ?? resource.mimeType ?? 'text/plain',
              text: content.text,
            }],
          })
        }

        default:
          return jsonRpcError(request.id, -32601, `Method not found: ${request.method}`)
      }
    } catch (error) {
      await audit({
        token: auth.token,
        ...activeAudit,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
        requestId,
      })
      return jsonRpcError(request.id, -32000, error instanceof Error ? error.message : String(error))
    }
  })

  return mcp
}
