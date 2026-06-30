---
title: MCP
description: Expose OpenShop tools and resources to MCP clients with scoped tokens.
---

OpenShop can expose MCP tools and resources for operational workflows such as listing flows, searching logs, and reading documentation resources.

MCP access is separate from Shopify OAuth scopes. Shopify scopes control what OpenShop can do with Shopify. MCP permissions control what an external MCP token can do inside OpenShop.

## Tokens

Create tokens from the embedded admin page at `/mcp`.

- Tokens are shown once.
- OpenShop stores only a hash and a fingerprint.
- Tokens are scoped to the current `(appHandle, shop)`.
- Tokens can be disabled, revoked, rotated, and optionally expired.

Use the token as a Bearer credential:

```http
POST /mcp
Authorization: Bearer oshp_mcp_...
Content-Type: application/json
```

## Permissions

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
  },
})
```

## Security model

OpenShop's first MCP version uses admin-created Bearer tokens. Keep these constraints:

- no wildcard permissions;
- no super-token by default;
- no token passthrough from Shopify or third-party services;
- no trusted `appHandle` parameter from the MCP client;
- client-provided shops must resolve to installed shops for the token's app handle;
- audit each tool and resource call.
