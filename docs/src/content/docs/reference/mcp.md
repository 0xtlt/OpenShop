---
title: MCP
description: JSON-RPC endpoint, tokens, permissions, tools, resources, and errors.
---

OpenShop exposes a streamable HTTP-style JSON-RPC endpoint at `POST /mcp`.
MCP access is separate from Shopify OAuth: OAuth scopes limit Shopify access,
while MCP grants limit capabilities inside OpenShop.

## Connect a client

Configure an MCP client with:

```txt
URL: https://your-app.example.com/mcp
Authorization: Bearer oshp_mcp_...
```

The endpoint implements protocol version `2025-11-25` and the methods
`initialize`, `tools/list`, `tools/call`, `resources/list`, and
`resources/read`. It does not advertise resource subscriptions or list-change
notifications.

Example request:

```http
POST /mcp
Authorization: Bearer oshp_mcp_...
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

Every response carries `MCP-Protocol-Version: 2025-11-25`. Notification methods
whose name starts with `notifications/` and have no `id` receive HTTP 202 with
an empty body.

## Tokens

Create and manage tokens from the embedded `/mcp` page. Set `pages.mcp` to
`hidden` or `disabled` to remove that screen from the admin UI; `mcp.enabled:
false` disables the JSON-RPC endpoint instead.

- The plaintext token is returned only on create or rotate.
- OpenShop stores a hash, stable token ID, and display fingerprint.
- Tokens are scoped to the current `(appHandle, shop)`.
- New tokens expire after 90 days unless `expiresAt`, `expiresInDays`, or no
  expiry is selected.
- Status is `active`, `disabled`, or `revoked`; revocation cannot be undone.
- Rotation preserves the token ID and grants but invalidates the old secret.

Missing, malformed, unknown, or cryptographically invalid tokens return HTTP
401. Disabled, revoked, and expired tokens return HTTP 403. Successful
authentication updates `lastUsedAt`.

## Permissions

Core permissions are:

| Permission | Purpose |
| --- | --- |
| `read_logs` | Search visible flow-run logs. |
| `read_flows` / `run_flows` | List or dispatch flows. |
| `read_crons` / `manage_crons` | List or change cron enabled state. |
| `read_providers` / `write_providers` | Provider access reserved by the capability registry. |
| `read_functions` | Function access reserved by the capability registry. |
| `manage_mcp_tokens` | Token management reserved by the capability registry. |
| `shopify_admin_graphql` | Run arbitrary Admin GraphQL documents for installed shops. |

Custom keys must match `namespace:action_resource`. Wildcard-style names such as
`*`, `all`, `admin`, `root`, and `full_access` are forbidden.

```ts
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
}
```

Custom permissions default to medium risk and to the namespace as their group.
Unknown permissions, conflicts with core names, and malformed config fail
application config validation.

## Custom tools

```ts
mcp: {
  tools: {
    'warehouse.inventory.list': {
      description: 'List warehouse inventory.',
      requiredPermissions: ['warehouse:read_inventory'],
      riskLevel: 'low',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      async run(ctx, input) {
        return {
          content: [{ type: 'text', text: `Inventory for ${ctx.shop}` }],
          structuredContent: { ok: true },
        }
      },
    },
  },
}
```

Tool names use lower-case alphanumeric segments separated by `.`, `_`, or `-`.
`description`, `requiredPermissions`, and `run` are required. Calls receive:

| Context field | Meaning |
| --- | --- |
| `appHandle`, `shop`, `tokenId` | Immutable token scope. |
| `permissions` | Current grants. |
| `signal` | Aborts on client disconnect or after 30 seconds. |
| `db` | Drizzle client. |

The built-in JSON Schema validator supports object, array, string, number,
integer, boolean, null, `required`, `properties`, `additionalProperties`,
`items`, numeric min/max, and `enum`. It is intentionally not a complete JSON
Schema implementation.

A string result becomes text content. A plain object becomes formatted text plus
`structuredContent`. Objects already containing `content` or
`structuredContent` pass through.

## Custom resources

```ts
mcp: {
  resources: {
    'openshop://warehouse/guide': {
      name: 'Warehouse guide',
      description: 'How inventory sync works.',
      mimeType: 'text/markdown',
      requiredPermissions: ['warehouse:read_inventory'],
      read: () => '# Warehouse sync',
    },
  },
}
```

Resource keys must be URIs. `name`, `requiredPermissions`, and `read` are
required. `read` returns a string or `{ text, mimeType? }`; MIME type defaults to
the definition and then `text/plain`.

Built-in resources are:

- `openshop://docs/log-search`
- `openshop://permissions`
- `openshop://tools/openshop.logs.search`
- `openshop://runs/recent`

## Core tools

| Tool | Permission | Important inputs/defaults |
| --- | --- | --- |
| `openshop.shops.list` | None | Lists installed shops for the token app. |
| `openshop.admin.graphql` | `shopify_admin_graphql` | `shop` and `query` required; `variables` defaults `{}`; API version defaults to latest stable. |
| `openshop.logs.search` | `read_logs` | `runId` required; levels `info,warn,error`; context true; limit 50, max 200. |
| `openshop.flows.list` | `read_flows` | Includes input schemas and configured crons. |
| `openshop.flows.run` | `run_flows` | `flow` required; `input` defaults `{}`; runs only for token shop. |
| `openshop.crons.list` | `read_crons` | Includes per-token-shop override state. |
| `openshop.crons.set_enabled` | `manage_crons` | Requires `key` and boolean `enabled`. |

The GraphQL tool accepts only shops installed for the token's app handle. Its
result includes HTTP status and Shopify's parsed response; unlike the regular
Shopify client, it returns GraphQL error payloads to the MCP caller.

## Visibility and audit

`tools/list` and `resources/list` omit capabilities whose permissions are not
fully granted. Calling a known but unauthorized capability still fails closed.
Tool and resource calls are audited with token, capability, permissions, status,
duration, request ID, and target shop where applicable.

## Limits and JSON-RPC errors

Requests are limited to 1,000,000 bytes. Tool and resource executions time out
after 30,000 ms and receive an abort signal.

| Error | Meaning |
| --- | --- |
| HTTP `400`, JSON-RPC `-32600` | Invalid JSON-RPC request. |
| HTTP `413` | Payload exceeds 1 MB. |
| `-32601` | Unsupported method. |
| `-32602` | Unknown capability or invalid arguments. |
| `-32003` | Permission denied. |
| `-32000` | Tool/resource exception, timeout, or abort. |

Application-level JSON-RPC errors normally use HTTP 200. Authentication and
payload errors use their explicit HTTP status.
