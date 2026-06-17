import type { Hono } from 'hono'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '#db/client'
import { mcpAuditLogs, mcpPermissionGrants, mcpTokens } from '#db/schema'
import { getShop, getShopifyApp } from '#server/shop'
import type { OpenShopConfig } from '#types'
import { createCoreMcpCapabilities } from '#server/mcp/core'
import { buildMcpRegistry } from '#server/mcp/registry'
import { createMcpToken, createMcpTokenForId } from '#server/mcp/tokens'

type TokenRow = typeof mcpTokens.$inferSelect
type AuditRow = typeof mcpAuditLogs.$inferSelect

function parseBody(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(body: Record<string, unknown>, key: string): string | null {
  const value = body[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function expiresAtFromBody(body: Record<string, unknown>, defaultDays = 90): { ok: true; expiresAt: Date | null } | { ok: false; error: string } {
  if ('expiresAt' in body) {
    if (body.expiresAt === null) return { ok: true, expiresAt: null }
    if (typeof body.expiresAt === 'string' && body.expiresAt.trim()) {
      const date = new Date(body.expiresAt)
      if (!Number.isNaN(date.getTime())) return { ok: true, expiresAt: date }
    }
    return { ok: false, error: 'expiresAt must be a valid date string or null' }
  }

  if ('expiresInDays' in body) {
    const expiresInDays = body.expiresInDays
    if (expiresInDays === null) return { ok: true, expiresAt: null }
    if (typeof expiresInDays === 'number' && Number.isInteger(expiresInDays) && expiresInDays > 0) {
      return { ok: true, expiresAt: new Date(Date.now() + expiresInDays * 86_400_000) }
    }
    return { ok: false, error: 'expiresInDays must be a positive integer or null' }
  }

  return { ok: true, expiresAt: new Date(Date.now() + defaultDays * 86_400_000) }
}

function publicToken(row: TokenRow, permissions: string[], knownPermissionKeys: Set<string>, recentAudits: AuditRow[] = []) {
  return {
    id: row.id,
    tokenId: row.tokenId,
    name: row.name,
    tokenFingerprint: row.tokenFingerprint,
    status: row.status,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    permissions,
    stalePermissions: permissions.filter((permission) => !knownPermissionKeys.has(permission)),
    recentAudits,
  }
}

async function permissionsForTokens(appHandle: string, shop: string, tokenIds: string[]): Promise<Map<string, string[]>> {
  if (tokenIds.length === 0) return new Map()
  const grants = await getDb().select({
    tokenId: mcpPermissionGrants.tokenId,
    permissionKey: mcpPermissionGrants.permissionKey,
  })
    .from(mcpPermissionGrants)
    .where(and(
      eq(mcpPermissionGrants.appHandle, appHandle),
      eq(mcpPermissionGrants.shop, shop),
      inArray(mcpPermissionGrants.tokenId, tokenIds),
      eq(mcpPermissionGrants.granted, true),
    ))

  const byToken = new Map<string, string[]>()
  for (const grant of grants) {
    byToken.set(grant.tokenId, [...(byToken.get(grant.tokenId) ?? []), grant.permissionKey])
  }
  return byToken
}

export function registerMcpAdminRoutes(api: Hono, getConfig: () => OpenShopConfig) {
  api.get('/mcp/capabilities', (c) => {
    const registry = buildMcpRegistry(getConfig(), createCoreMcpCapabilities(getConfig))
    return c.json({
      enabled: registry.enabled,
      permissions: registry.permissions,
      tools: Object.fromEntries(Object.entries(registry.tools).map(([name, tool]) => [
        name,
        {
          name,
          description: tool.description,
          inputSchema: tool.inputSchema ?? null,
          requiredPermissions: tool.requiredPermissions,
          riskLevel: tool.riskLevel ?? 'low',
          confirmationHint: tool.confirmationHint ?? null,
          source: tool.source,
        },
      ])),
      resources: Object.fromEntries(Object.entries(registry.resources).map(([uri, resource]) => [
        uri,
        {
          uri,
          name: resource.name,
          description: resource.description ?? null,
          mimeType: resource.mimeType ?? 'text/plain',
          requiredPermissions: resource.requiredPermissions,
          riskLevel: resource.riskLevel ?? 'low',
          source: resource.source,
        },
      ])),
      defaultExpirationDays: 90,
      expirationOptions: [30, 90, 365, null],
    })
  })

  api.get('/mcp/tokens', async (c) => {
    const registry = buildMcpRegistry(getConfig(), createCoreMcpCapabilities(getConfig))
    const appHandle = getShopifyApp(c)
    const shop = getShop(c)
    const rows = await getDb().select().from(mcpTokens)
      .where(and(eq(mcpTokens.appHandle, appHandle), eq(mcpTokens.shop, shop)))
      .orderBy(desc(mcpTokens.createdAt))
    const permissionsByToken = await permissionsForTokens(appHandle, shop, rows.map((row) => row.tokenId))
    const knownPermissionKeys = new Set(Object.keys(registry.permissions))
    return c.json(rows.map((row) => publicToken(row, permissionsByToken.get(row.tokenId) ?? [], knownPermissionKeys)))
  })

  api.post('/mcp/tokens', async (c) => {
    const registry = buildMcpRegistry(getConfig(), createCoreMcpCapabilities(getConfig))
    const appHandle = getShopifyApp(c)
    const shop = getShop(c)
    const body = parseBody(await c.req.json().catch(() => ({})))
    const name = stringValue(body, 'name')
    if (!name) return c.json({ error: 'name is required' }, 400)

    const selectedPermissions = Array.isArray(body.permissions)
      ? [...new Set(body.permissions.filter((permission): permission is string => typeof permission === 'string'))]
      : []
    for (const permission of selectedPermissions) {
      if (!registry.permissions[permission]) return c.json({ error: `Unknown permission "${permission}"` }, 400)
    }

    const generated = createMcpToken()
    const expiration = expiresAtFromBody(body)
    if (!expiration.ok) return c.json({ error: expiration.error }, 400)

    await getDb().transaction(async (tx) => {
      await tx.insert(mcpTokens).values({
        appHandle,
        shop,
        name,
        tokenId: generated.tokenId,
        tokenHash: generated.tokenHash,
        tokenFingerprint: generated.tokenFingerprint,
        expiresAt: expiration.expiresAt,
      })

      if (selectedPermissions.length > 0) {
        await tx.insert(mcpPermissionGrants).values(selectedPermissions.map((permissionKey) => ({
          appHandle,
          shop,
          tokenId: generated.tokenId,
          permissionKey,
          granted: true,
        })))
      }
    })

    const [row] = await getDb().select().from(mcpTokens).where(eq(mcpTokens.tokenId, generated.tokenId)).limit(1)
    return c.json({
      token: generated.token,
      item: publicToken(row, selectedPermissions, new Set(Object.keys(registry.permissions))),
    }, 201)
  })

  api.get('/mcp/tokens/:id', async (c) => {
    const registry = buildMcpRegistry(getConfig(), createCoreMcpCapabilities(getConfig))
    const appHandle = getShopifyApp(c)
    const shop = getShop(c)
    const id = c.req.param('id')
    const [row] = await getDb().select().from(mcpTokens)
      .where(and(eq(mcpTokens.id, id), eq(mcpTokens.appHandle, appHandle), eq(mcpTokens.shop, shop)))
      .limit(1)
    if (!row) return c.json({ error: 'Token not found' }, 404)

    const permissionsByToken = await permissionsForTokens(appHandle, shop, [row.tokenId])
    const audits = await getDb().select().from(mcpAuditLogs)
      .where(and(eq(mcpAuditLogs.appHandle, appHandle), eq(mcpAuditLogs.shop, shop), eq(mcpAuditLogs.tokenId, row.tokenId)))
      .orderBy(desc(mcpAuditLogs.createdAt))
      .limit(10)

    return c.json(publicToken(row, permissionsByToken.get(row.tokenId) ?? [], new Set(Object.keys(registry.permissions)), audits))
  })

  api.patch('/mcp/tokens/:id', async (c) => {
    const appHandle = getShopifyApp(c)
    const shop = getShop(c)
    const id = c.req.param('id')
    const body = parseBody(await c.req.json().catch(() => ({})))

    const [existing] = await getDb().select({ id: mcpTokens.id, status: mcpTokens.status, revokedAt: mcpTokens.revokedAt }).from(mcpTokens)
      .where(and(eq(mcpTokens.id, id), eq(mcpTokens.appHandle, appHandle), eq(mcpTokens.shop, shop)))
      .limit(1)
    if (!existing) return c.json({ error: 'Token not found' }, 404)
    if (existing.status === 'revoked' || existing.revokedAt) return c.json({ error: 'Cannot update a revoked token' }, 409)

    const patch: Partial<typeof mcpTokens.$inferInsert> = { updatedAt: new Date() }
    const name = stringValue(body, 'name')
    if (name) patch.name = name
    if (body.status === 'active' || body.status === 'disabled') patch.status = body.status
    if ('expiresAt' in body || 'expiresInDays' in body) {
      const expiration = expiresAtFromBody(body)
      if (!expiration.ok) return c.json({ error: expiration.error }, 400)
      patch.expiresAt = expiration.expiresAt
    }

    await getDb().update(mcpTokens)
      .set(patch)
      .where(eq(mcpTokens.id, existing.id))
    return c.json({ ok: true })
  })

  api.put('/mcp/tokens/:id/permissions', async (c) => {
    const registry = buildMcpRegistry(getConfig(), createCoreMcpCapabilities(getConfig))
    const appHandle = getShopifyApp(c)
    const shop = getShop(c)
    const id = c.req.param('id')
    const body = parseBody(await c.req.json().catch(() => ({})))
    const permissions = Array.isArray(body.permissions)
      ? [...new Set(body.permissions.filter((permission): permission is string => typeof permission === 'string'))]
      : []

    for (const permission of permissions) {
      if (!registry.permissions[permission]) return c.json({ error: `Unknown permission "${permission}"` }, 400)
    }

    const [row] = await getDb().select().from(mcpTokens)
      .where(and(eq(mcpTokens.id, id), eq(mcpTokens.appHandle, appHandle), eq(mcpTokens.shop, shop)))
      .limit(1)
    if (!row) return c.json({ error: 'Token not found' }, 404)
    if (row.status === 'revoked' || row.revokedAt) return c.json({ error: 'Cannot update a revoked token' }, 409)

    await getDb().transaction(async (tx) => {
      await tx.delete(mcpPermissionGrants)
        .where(and(
          eq(mcpPermissionGrants.appHandle, appHandle),
          eq(mcpPermissionGrants.shop, shop),
          eq(mcpPermissionGrants.tokenId, row.tokenId),
        ))
      if (permissions.length > 0) {
        await tx.insert(mcpPermissionGrants).values(permissions.map((permissionKey) => ({
          appHandle,
          shop,
          tokenId: row.tokenId,
          permissionKey,
          granted: true,
        })))
      }
      await tx.update(mcpTokens).set({ updatedAt: new Date() }).where(eq(mcpTokens.id, row.id))
    })

    return c.json({ ok: true })
  })

  api.post('/mcp/tokens/:id/rotate', async (c) => {
    const appHandle = getShopifyApp(c)
    const shop = getShop(c)
    const id = c.req.param('id')
    const [existing] = await getDb().select({ tokenId: mcpTokens.tokenId, status: mcpTokens.status, revokedAt: mcpTokens.revokedAt }).from(mcpTokens)
      .where(and(eq(mcpTokens.id, id), eq(mcpTokens.appHandle, appHandle), eq(mcpTokens.shop, shop)))
      .limit(1)
    if (!existing) return c.json({ error: 'Token not found' }, 404)
    if (existing.status === 'revoked' || existing.revokedAt) return c.json({ error: 'Cannot rotate a revoked token' }, 409)
    const generated = createMcpTokenForId(existing.tokenId)

    const updated = await getDb().update(mcpTokens)
      .set({
        tokenHash: generated.tokenHash,
        tokenFingerprint: generated.tokenFingerprint,
        status: 'active',
        revokedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(mcpTokens.id, id), eq(mcpTokens.appHandle, appHandle), eq(mcpTokens.shop, shop)))
      .returning()
    if (!updated[0]) return c.json({ error: 'Token not found' }, 404)

    return c.json({ ok: true, token: generated.token })
  })

  api.post('/mcp/tokens/:id/revoke', async (c) => {
    const appHandle = getShopifyApp(c)
    const shop = getShop(c)
    const id = c.req.param('id')
    const updated = await getDb().update(mcpTokens)
      .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(mcpTokens.id, id), eq(mcpTokens.appHandle, appHandle), eq(mcpTokens.shop, shop)))
      .returning()
    if (!updated[0]) return c.json({ error: 'Token not found' }, 404)
    return c.json({ ok: true })
  })
}
