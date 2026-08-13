---
title: Admin API
description: Authentication and endpoint contracts for the embedded OpenShop admin UI.
---

The Admin API is mounted at `/api` and is intended for OpenShop's embedded admin UI.

:::caution[Stability]
These HTTP routes are **internal and unversioned**. They are documented to help with
debugging and controlled integrations, but they are not currently a stable public
API. Pin the OpenShop version and test response contracts before depending on them.
The TypeScript exports documented in [Public SDK](/reference/sdk/) are the supported
application API.
:::

## Authentication

Every `/api/*` request requires a Shopify session token:

```http
Authorization: Bearer <shopify-session-token>
```

In an embedded app, obtain a fresh token with Shopify App Bridge and send it on
every request:

```ts
const response = await fetch('/api/runs?limit=20', {
  headers: {
    Authorization: `Bearer ${await shopify.idToken()}`,
  },
})

if (!response.ok) {
  throw new Error(`Admin API returned ${response.status}`)
}

const runs = await response.json()
```

OpenShop validates the HS256 signature, `aud`, `exp`, `nbf`, and matching `iss` /
`dest` shop domains. The audience selects the Shopify app in multi-app deployments.
The authenticated app handle and shop scope every database query.

A missing or invalid token returns `401`. Do not use a Shopify Admin API access
token or an OpenShop MCP token here.

## Admin pages

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/pages` | — | Resolved visibility for `flows`, `providers`, `crons`, `functions`, and `mcp`. |

Each value is `visible`, `hidden`, or `disabled`. Omitted config keys resolve to `visible`. This endpoint stays available even when every page is `disabled`.

When a page is `disabled`, its admin API group returns `404` with `{ "error": "Not found" }`:

- `flows` also covers `/api/runs`
- `providers` covers `/api/providers`
- `crons` covers `/api/crons`
- `functions` covers `/api/functions`
- `mcp` covers `/api/mcp`

`hidden` only removes the Shopify sidebar link; the URL and admin API still work. Runtime endpoints such as `POST /mcp`, webhooks, and the worker are not gated by `pages`.

## Flows and runs

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/flows` | — | Flow names, cron entries, and input JSON schemas. |
| `GET /api/runs` | Query filters below | Run rows for the authenticated app and shop. |
| `GET /api/flows/:name/runs` | Same filters | Run rows restricted to one flow. |
| `GET /api/runs/:id` | — | Run row plus `steps`. |
| `POST /api/flows/:name/run` | `{ "input": { ... } }` | `202` with `{ runId, status: "pending" }`. |
| `POST /api/runs/:id/retry?mode=resume` | — | Requeues a finished run. |
| `POST /api/runs/:id/retry?mode=reset` | — | Deletes every step result, then requeues. |
| `POST /api/runs/:id/cancel` | — | Cancels a pending, running, or sleeping run. |
| `DELETE /api/runs/:id` | — | Deletes an inactive run, its steps, and logs. |
| `POST /api/runs/bulk-delete` | `{ "ids": ["uuid"] }` | `{ deleted, skipped }`, maximum 100 IDs. |

Run list query parameters:

- `limit`: `1`–`200`, default `50`.
- `offset`: non-negative, default `0`.
- `search`: case-insensitive flow name, status, or run-ID search.
- `status`: `pending`, `running`, `sleeping`, `completed`, `failed`, or `canceled`.
- `from`, `to`: date strings parsed by JavaScript and applied to `createdAt`.

Retry `mode=resume` keeps completed step results and deletes the others. Any value
other than `reset` currently behaves as `resume`. Retry accepts only `failed`,
`completed`, or `canceled` runs. Active runs cannot be deleted.

`409` reports invalid lifecycle transitions or a flow concurrency conflict. A
concurrency conflict includes `existingRunId`.

## Run logs

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/runs/:id/logs` | `q`, `levels` | `{ logs, total }`, newest first, with matching context markers. |
| `GET /api/runs/:id/logs/export` | `format`, `q`, `levels` | Downloadable JSON or CSV. |

`levels` is a comma-separated subset of `info,warn,error`; all three are enabled by
default. `q` supports the admin log query syntax, including text/field filters,
time bounds, and context expansion. Export uses only matching rows and omits context
expansion. `format=csv` selects CSV; every other value returns JSON.

## Cron overrides

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/crons` | — | Configured crons plus their per-shop enabled state. |
| `POST /api/crons/toggle` | `{ "key": "flow:schedule", "enabled": false }` | `{ ok, key, enabled }`. |

The key returned by the list endpoint is `${flow}:${schedule}`. A toggle stores a
per-app, per-shop override; it does not edit `openshop.config.ts`.

## Providers

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/providers` | — | Definitions, public config, field metadata, and last health check. |
| `PUT /api/providers/:name` | `{ "config": { ... } }` | Validates, merges masked secrets where applicable, encrypts, and stores config. |
| `POST /api/providers/:name/check` | — | `{ ok }`, or `{ ok: false, error }` with `500`. |

Password values are not returned in plaintext. A checker must be defined by the
provider; otherwise the check endpoint returns `400`.

## Shopify Functions

These routes query or mutate Shopify live; they do not represent local database
instances.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/functions` | — | Local function definitions and editable fields. |
| `GET /api/functions/:handle/instances` | — | Up to 50 live Shopify instances. |
| `POST /api/functions/:handle/instances` | Function config and owner fields | `201` with mutation payload. |
| `PUT /api/functions/:handle/instances/:id` | Function config and owner fields | `{ ok: true }`. |
| `DELETE /api/functions/:handle/instances/:id` | Optional `mode` query | `{ ok: true }`. |

Create and update bodies always accept `config`. Additional owner fields depend on
the type, including discount mode, code, dates, usage limit, combination flags, or
enabled state. Invalid Shopify mutation input returns `400` with `error` and
`userErrors`.

Cart transforms and fulfillment constraints cannot be updated: delete and recreate
them. Function types without a supported Shopify GraphQL mutation return `400`.
For discount functions configured with both modes, delete requires
`?mode=automatic` or `?mode=code`.

## MCP token administration

These `/api/mcp/*` routes use a **Shopify session token**. The separate `/mcp`
protocol endpoint uses the OpenShop-issued token created here.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/mcp/capabilities` | — | Permissions, tools, resources, risks, and expiry options. |
| `GET /api/mcp/tokens` | — | Public token metadata; never the secret token. |
| `POST /api/mcp/tokens` | `{ name, permissions?, expiresAt? }` or `expiresInDays` | `201`; returns the secret token once. |
| `GET /api/mcp/tokens/:id` | — | Token metadata and 10 latest audits. |
| `PATCH /api/mcp/tokens/:id` | `name`, `status`, and/or expiry | `{ ok: true }`. |
| `PUT /api/mcp/tokens/:id/permissions` | `{ "permissions": ["key"] }` | Replaces the complete permission set. |
| `POST /api/mcp/tokens/:id/rotate` | — | Returns a replacement secret token once. |
| `POST /api/mcp/tokens/:id/revoke` | — | Permanently revokes the token. |

`expiresAt` accepts an ISO-compatible date string or `null`. `expiresInDays` accepts
a positive integer or `null`; omitted expiry defaults to 90 days. Unknown
permissions return `400`. Disabled tokens can be re-enabled; revoked tokens cannot
be edited or rotated.

Store the `token` returned by create or rotate immediately. Later reads expose only
its ID and fingerprint.

## Common status codes

| Status | Meaning |
| --- | --- |
| `200` | Read or mutation completed. |
| `201` | Function instance or MCP token created. |
| `202` | Flow accepted for asynchronous execution. |
| `400` | Invalid request, provider config, function config, or MCP permission. |
| `401` | Missing, expired, malformed, or invalid Shopify session token. |
| `404` | Resource not found within the authenticated app and shop, or the admin page is `disabled`. |
| `409` | Lifecycle or concurrency conflict. |
| `500` | Provider checker or unexpected server failure. |

