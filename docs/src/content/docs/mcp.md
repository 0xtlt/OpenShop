---
title: MCP
description: Expose OpenShop tools and resources to MCP clients with scoped tokens.
---

OpenShop can expose a small MCP surface for operational workflows such as listing flows, searching logs, and reading documentation resources.

MCP access is separate from Shopify OAuth scopes. Shopify scopes control what OpenShop can do with Shopify. MCP permissions control what an external MCP token can do inside OpenShop.

## Tokens

Create tokens from the embedded admin page at `/mcp`.

- Tokens are shown once.
- OpenShop stores only a hash and a fingerprint.
- Tokens are scoped to the current `(appHandle, shop)`.
- Tokens can be disabled, revoked, rotated, and optionally expired.
- The UI preselects a 90 day expiration, with 30 day, 1 year, and no-expiration options.

Use the token as a Bearer credential when calling the MCP endpoint:

```http
POST /mcp
Authorization: Bearer oshp_mcp_...
Content-Type: application/json
```

## Permissions

Core permissions include:

- `read_logs`
- `read_flows`
- `run_flows`
- `read_crons`
- `manage_crons`
- `read_providers`
- `write_providers`
- `read_functions`
- `manage_mcp_tokens`
- `shopify_admin_graphql`

Custom permissions are declared in `openshop.config.ts` and must use `namespace:action_resource`:

```ts
export default app.defineConfig({
  flows: {},
  mcp: {
    permissions: {
      custom: {
        'warehouse:read_inventory': {
          label: 'Read warehouse inventory',
          group: 'Warehouse',
          riskLevel: 'low',
        },
      },
    },
  },
})
```

The database stores grants only. Permissions available in the admin always come from code, which prevents stale typo-driven permissions from becoming executable.

## Tools and resources

Tools and resources declare `requiredPermissions`. Calls fail closed when a token is missing a required permission.

```ts
export default app.defineConfig({
  flows: {},
  mcp: {
    tools: {
      'warehouse.inventory.list': {
        description: 'List warehouse inventory.',
        requiredPermissions: ['warehouse:read_inventory'],
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        async run(ctx) {
          return {
            content: [{ type: 'text', text: `Inventory for ${ctx.shop}` }],
            structuredContent: { ok: true },
          }
        },
      },
    },
    resources: {
      'openshop://warehouse/inventory-help': {
        name: 'Inventory tool help',
        mimeType: 'text/markdown',
        requiredPermissions: ['warehouse:read_inventory'],
        read: () => 'Use `warehouse.inventory.list` to inspect warehouse inventory.',
      },
    },
  },
})
```

## Log search

Grant `read_logs`, then call `openshop.logs.search`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "openshop.logs.search",
    "arguments": {
      "runId": "550e8400-e29b-41d4-a716-446655440000",
      "q": "level:error",
      "levels": "info,warn,error",
      "limit": 50
    }
  }
}
```

The tool checks that the run belongs to the token's `(appHandle, shop)` before reading logs.

## Shops and Admin GraphQL

`openshop.shops.list` is always available to valid MCP tokens. It lists installed shops for the token's OpenShop app handle so clients can choose an explicit shop target.

Grant `shopify_admin_graphql` to expose `openshop.admin.graphql`. This is intentionally high-risk: it runs arbitrary Shopify Admin GraphQL queries and mutations against an installed shop using the stored offline Admin API access token.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "openshop.admin.graphql",
    "arguments": {
      "shop": "example.myshopify.com",
      "apiVersion": "2026-04",
      "query": "query { shop { name } }"
    }
  }
}
```

`apiVersion` is optional. When omitted, or when set to `"latest"`, OpenShop uses the latest stable Shopify Admin API version based on Shopify's quarterly release schedule.

## Security model

OpenShop's first MCP version intentionally does not implement OAuth. It uses admin-created Bearer tokens to avoid a partial OAuth flow. Keep these constraints:

- no wildcard permissions;
- no super-token by default;
- no token passthrough from Shopify or third-party services;
- no trusted `appHandle` parameter from the MCP client;
- any client-provided `shop` must resolve to an installed shop for the token's app handle;
- audit each tool/resource call with token, capability, status, timing, and target shop when applicable.
