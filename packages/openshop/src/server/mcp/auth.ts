import { and, eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { mcpPermissionGrants, mcpTokens } from '#db/schema'
import type { McpTokenStatus } from '#types'
import { extractBearerToken, parseMcpToken, verifyMcpToken } from './tokens.ts'

export interface ResolvedMcpToken {
  appHandle: string
  shop: string
  tokenId: string
  name: string
  permissions: string[]
}

export type McpAuthResult =
  | { ok: true; token: ResolvedMcpToken }
  | { ok: false; status: 401 | 403; error: string; tokenId?: string }

function isUsableStatus(status: McpTokenStatus): boolean {
  return status === 'active'
}

export async function resolveMcpBearerToken(authorizationHeader: string | undefined | null): Promise<McpAuthResult> {
  const bearer = extractBearerToken(authorizationHeader)
  if (!bearer) return { ok: false, status: 401, error: 'Unauthorized: missing MCP bearer token' }

  const parsed = parseMcpToken(bearer)
  if (!parsed) return { ok: false, status: 401, error: 'Unauthorized: invalid MCP token format' }

  const db = getDb()
  const [stored] = await db.select()
    .from(mcpTokens)
    .where(eq(mcpTokens.tokenId, parsed.tokenId))
    .limit(1)

  if (!stored) return { ok: false, status: 401, error: 'Unauthorized: unknown MCP token', tokenId: parsed.tokenId }
  if (!verifyMcpToken(parsed.token, stored.tokenHash)) {
    return { ok: false, status: 401, error: 'Unauthorized: invalid MCP token', tokenId: parsed.tokenId }
  }
  if (!isUsableStatus(stored.status) || stored.revokedAt) {
    return { ok: false, status: 403, error: 'Forbidden: MCP token is not active', tokenId: stored.tokenId }
  }
  if (stored.expiresAt && stored.expiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 403, error: 'Forbidden: MCP token has expired', tokenId: stored.tokenId }
  }

  const grants = await db.select({ permissionKey: mcpPermissionGrants.permissionKey })
    .from(mcpPermissionGrants)
    .where(and(
      eq(mcpPermissionGrants.appHandle, stored.appHandle),
      eq(mcpPermissionGrants.shop, stored.shop),
      eq(mcpPermissionGrants.tokenId, stored.tokenId),
      eq(mcpPermissionGrants.granted, true),
    ))

  await db.update(mcpTokens)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(mcpTokens.id, stored.id))

  return {
    ok: true,
    token: {
      appHandle: stored.appHandle,
      shop: stored.shop,
      tokenId: stored.tokenId,
      name: stored.name,
      permissions: grants.map((grant) => grant.permissionKey),
    },
  }
}
