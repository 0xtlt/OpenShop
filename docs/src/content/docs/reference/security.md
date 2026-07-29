---
title: Security
description: Secret storage, authentication boundaries, tenancy, CORS, database access, and deployment hardening.
---

## Required production controls

1. Set a random 64-character hexadecimal `ENCRYPTION_KEY` and keep it stable.
2. Terminate HTTPS before OpenShop and set `HOST` to the public HTTPS origin.
3. Use a dedicated PostgreSQL role with access only to the OpenShop database.
4. Run committed migrations before web and workers; do not grant runtime
   processes schema-generation privileges.
5. Restrict logs, backups, and admin access because they may contain merchant
   and operational data.

Generate an encryption key once:

```bash
openssl rand -hex 32
```

Provider passwords and Shopify access tokens are encrypted at rest when the key
is present. In production, a missing or malformed key is an error. Rotating the
key requires decrypting and re-encrypting existing values; replacing it without
a migration makes stored secrets unreadable.

## Authentication boundaries

- `/api/*` trusts only a verified Shopify session token.
- `/webhooks/*` verifies the raw body with a matching Shopify app secret.
- `/proxy/*` accepts App Proxy HMAC or a Customer Account JWT.
- `/ext/*` accepts only a Customer Account JWT.
- `/mcp` accepts only OpenShop-issued MCP tokens and applies explicit grants.

See [Authentication](/reference/authentication/) for request formats.

## Multi-app isolation

Framework state is scoped by `(appHandle, shop)`. Every application query against
custom tables must still apply its own tenant filter. `defineModel()` adds
`shop`, but it does not automatically add a `WHERE shop = …` clause.

## MCP permissions

Give tokens the smallest required permission set, use expirations, and revoke
unused tokens. High-risk custom tools should declare their risk level and a
confirmation hint. Audit logs record capability, token, target shop, outcome,
and duration; they do not replace external security monitoring.

## Proxy and webhook handlers

- Treat request bodies and Shopify payloads as untrusted input.
- Validate input before provider or database writes.
- Make webhook and retryable flow side effects idempotent.
- Trust the verified context identity, not duplicated query/body fields.
- Do not return secrets or raw upstream error bodies to clients.

## Embedded admin exposure

The production UI shell requires a valid installed shop launch. Responses carry
`X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`; the app host is not a
public website. Keep the documentation deployment separate from the application
deployment.
